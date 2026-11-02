import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import {
  GameCallbackError,
  applyGameCallback,
  readGameAmount,
  readGameEventType,
} from "@/lib/game-callback";
import {
  providerCallbackSignatureRequired,
  readGameCode,
  readGameCurrency,
  verifyProviderSignature,
} from "@/lib/game-provider";
import { checkIpWhitelist, readClientIp } from "@/lib/ip-whitelist";
import { prisma } from "@/lib/prisma";

/**
 * 游戏商注单 / 派彩回调（扣钱 / 加钱 / 退回）。
 *
 * POST /api/games/callback
 * Body: {
 *   provider?: "PG Soft"          // 游戏商名称（或 providerId / merchantId 三选一）
 *   type: "bet" | "win" | "refund"
 *   transactionId: "上游事件号"    // 幂等键，重试不会重复入账
 *   roundId?: "上游局号"           // 同局事件落到同一条 BetRecord，默认等于 transactionId
 *   playerId: "<玩家 id>"          // 或 tenantId + playerUsername
 *   amount: "10.5"
 *   currency?: "USDT"
 *   gameCode?: "pg-fortune-tiger"
 * }
 *
 * 安全边界（与支付回调同一口径）：
 * 1. 来源 IP 必须在「API 集成中心 → IP 白名单」里；
 * 2. 生产环境默认要求 x-game-signature = HMAC-SHA256(rawBody, provider.apiSecret)；
 * 3. 金额只按上游推送的 amount 入账，但必须 > 0、最多 6 位小数；
 * 4. 扣钱条件更新 balance >= amount，余额不足直接回滚，绝不写出负余额；
 * 5. 幂等：同一 transactionId 无论推送多少次都只入账一次。
 */
export async function POST(request: NextRequest) {
  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return jsonError("读取回调请求失败", 400);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return jsonError("回调请求体不是有效 JSON", 400);
  }

  const input = (parsed ?? {}) as Record<string, unknown>;

  try {
    // ---------------------------------------------------------------- 1. 白名单
    const clientIp = readClientIp(request);
    const whitelist = await checkIpWhitelist(clientIp);

    if (!whitelist.allowed) {
      console.warn("拒绝游戏回调：来源 IP 未通过白名单", {
        ip: whitelist.ip,
        reason: whitelist.reason,
        total: whitelist.total,
      });

      return Response.json(
        {
          error:
            whitelist.reason === "not-configured"
              ? "IP 白名单为空：请先在 API 集成中心添加游戏商回调 IP"
              : "回调来源 IP 不在白名单内",
          ip: whitelist.ip,
          whitelist: {
            required: whitelist.required,
            reason: whitelist.reason,
            total: whitelist.total,
          },
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    // ------------------------------------------------------------- 2. 游戏商
    const providerId = readText(input.providerId);
    const merchantId = readText(input.merchantId);
    const providerName = readText(input.provider) || readText(input.providerName);

    if (!providerId && !merchantId && !providerName) {
      return jsonError("缺少游戏商标识（providerId / merchantId / provider）", 400);
    }

    const provider = providerId
      ? await prisma.gameProvider.findUnique({
          where: { id: providerId },
          select: callbackProviderSelect,
        })
      : merchantId
        ? await prisma.gameProvider.findFirst({
            where: { merchantId },
            select: callbackProviderSelect,
          })
        : await prisma.gameProvider.findFirst({
            where: { name: { equals: providerName, mode: "insensitive" } },
            select: callbackProviderSelect,
          });

    if (!provider) {
      return jsonError("游戏商不存在或尚未在后台配置", 404);
    }

    if (!provider.isActive || provider.status !== "active") {
      // 下架 / 暂停结算只影响新开局，历史注单仍要能正常结算，所以这里只告警不拦截。
      console.warn("游戏商已下架或暂停，仍按历史注单入账", {
        provider: provider.name,
        status: provider.status,
        isActive: provider.isActive,
      });
    }

    // --------------------------------------------------------------- 3. 验签
    const signatureHeader =
      request.headers.get("x-game-signature") ??
      request.headers.get("x-provider-signature") ??
      readText(input.signature);

    if (providerCallbackSignatureRequired()) {
      if (!provider.apiSecret) {
        return jsonError("游戏商未配置签名密钥，无法验签", 409);
      }

      if (!verifyProviderSignature(rawBody, signatureHeader, provider.apiSecret)) {
        return jsonError("回调签名校验失败", 401);
      }
    } else if (
      provider.apiSecret &&
      signatureHeader &&
      !verifyProviderSignature(rawBody, signatureHeader, provider.apiSecret)
    ) {
      // 非强制验签环境里，只要上游带了签名就必须对得上，避免「带错签名还能入账」。
      return jsonError("回调签名校验失败", 401);
    }

    // --------------------------------------------------------------- 4. 玩家
    const rawPlayerId = readText(input.playerId);
    const playerUsername =
      readText(input.playerUsername) || readText(input.username);
    const tenantId = readText(input.tenantId);

    const player = rawPlayerId
      ? await prisma.player.findUnique({
          where: { id: rawPlayerId },
          select: callbackPlayerSelect,
        })
      : playerUsername && tenantId
        ? await prisma.player.findUnique({
            where: { tenantId_username: { tenantId, username: playerUsername } },
            select: callbackPlayerSelect,
          })
        : null;

    if (!rawPlayerId && !(playerUsername && tenantId)) {
      return jsonError(
        "缺少玩家标识（playerId，或 tenantId + playerUsername）",
        400,
      );
    }

    if (!player) {
      return jsonError("玩家不存在", 404);
    }

    if (player.status !== "active") {
      return jsonError("玩家账号已被停用，无法入账", 403);
    }

    if (player.tenant.status === "suspended") {
      return jsonError("当前租户已暂停，无法入账", 403);
    }

    // ----------------------------------------------------------- 5. 事件字段
    const type = readGameEventType(
      input.type ?? input.action ?? input.event ?? input.eventType,
    );

    if (!type) {
      return jsonError(
        "事件类型只支持 bet（扣钱）/ win（加钱）/ refund（退回）",
        400,
      );
    }

    const rawEventId =
      readText(input.transactionId) || readText(input.eventId) || readText(input.id);

    if (!rawEventId) {
      return jsonError("缺少上游事件号 transactionId", 400);
    }

    const eventId = readGameCode(rawEventId);

    if (!eventId) {
      return jsonError("transactionId 格式不正确", 400);
    }

    const roundId = readGameCode(
      readText(input.roundId) ||
        readText(input.round) ||
        readText(input.betId) ||
        eventId,
    );

    if (!roundId) {
      return jsonError("roundId 格式不正确", 400);
    }

    const amount = readGameAmount(
      input.amount ?? input.betAmount ?? input.winAmount ?? input.payoutAmount,
    );

    if (!amount) {
      return jsonError(
        "金额格式不正确：必须是大于 0、最多 6 位小数的数字",
        400,
      );
    }

    const currency = readGameCurrency(input.currency);

    if (!currency) {
      return jsonError("币种格式不正确（2-10 位字母，如 USDT）", 400);
    }

    const gameCode = readGameCode(input.gameCode ?? input.game);

    // --------------------------------------------------------------- 6. 入账
    const result = await applyGameCallback({
      provider: {
        id: provider.id,
        upstreamPoint: provider.upstreamPoint,
        platformMarkup: provider.platformMarkup,
      },
      tenantId: player.tenantId,
      playerId: player.id,
      type,
      eventId,
      roundId,
      amount,
      currency,
      gameCode,
    });

    return Response.json(
      {
        success: true,
        replayed: result.replayed,
        provider: { id: provider.id, name: provider.name },
        playerId: player.id,
        type,
        eventId,
        roundId,
        gameCode,
        amount: amount.toFixed(6),
        currency,
        balance: result.balance,
        transactionId: result.transactionId,
        betRecordId: result.betRecordId || null,
        ip: whitelist.ip,
        whitelist: {
          required: whitelist.required,
          matchedRule: whitelist.matchedRule,
          total: whitelist.total,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GameCallbackError) {
      return jsonError(error.message, error.status);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return jsonError("同一注单正在处理中，请稍后重试", 409);
      }

      if (error.code === "P2034") {
        // Serializable 事务冲突：上游重试即可，返回 5xx 才会触发对方重推。
        return jsonError("并发写入冲突，请重试", 503);
      }
    }

    console.error("处理游戏回调失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** 回调只需要结算相关的游戏商字段；apiSecret 仅用于验签，不会进入响应。 */
const callbackProviderSelect = {
  id: true,
  name: true,
  status: true,
  isActive: true,
  upstreamPoint: true,
  platformMarkup: true,
  merchantId: true,
  apiSecret: true,
} as const;

const callbackPlayerSelect = {
  id: true,
  tenantId: true,
  status: true,
  tenant: { select: { status: true } },
} as const;
