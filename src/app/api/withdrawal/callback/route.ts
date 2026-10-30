import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import {
  callbackSignatureRequired,
  verifyCallbackSignature,
} from "@/lib/payment-gateway";
import { prisma } from "@/lib/prisma";

type CallbackStatus = "success" | "failed";

class InsufficientBalanceError extends Error {}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readTxHash(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return "";
  }

  const txHash = value.trim();

  if (!txHash || txHash.length > 200) {
    return "";
  }

  return txHash;
}

/**
 * 代付商回调。
 * POST /api/withdrawal/callback
 *
 * Body: { withdrawalId, status: "success" | "failed", txHash? }
 *
 * 纯电子记账：
 * - success：条件更新 pending -> success，扣减 Player.balance，写一条
 *   Transaction(type=withdraw)；三步在同一事务内，不会只扣钱不记账。
 * - failed：只改提现单状态，不动余额、不写流水。
 * - 不扣减/不增加任何平台内部资金账户。
 *
 * 防重复扣款：`updateMany({ where: { id, status: "pending" } })` 是数据库层
 * compare-and-swap，只有抢到状态迁移的请求才会扣余额。
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
  const withdrawalId =
    typeof input.withdrawalId === "string" ? input.withdrawalId.trim() : "";
  const rawStatus =
    typeof input.status === "string"
      ? input.status.trim().toLowerCase()
      : "";

  if (!withdrawalId) {
    return jsonError("缺少提现单号 withdrawalId", 400);
  }

  if (rawStatus !== "success" && rawStatus !== "failed") {
    return jsonError("status 只支持 success 或 failed", 400);
  }

  const status = rawStatus as CallbackStatus;
  const txHash = readTxHash(input.txHash);

  if (txHash === "") {
    return jsonError("txHash 格式不正确", 400);
  }

  if (status === "success" && !txHash) {
    return jsonError("成功回调必须提供 txHash", 400);
  }

  try {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      select: {
        id: true,
        tenantId: true,
        playerId: true,
        amount: true,
        currency: true,
        status: true,
        gateway: { select: { name: true, apiKey: true } },
      },
    });

    if (!withdrawal) {
      return jsonError("提现单不存在", 404);
    }

    if (callbackSignatureRequired()) {
      const signature =
        request.headers.get("x-pay-signature") ??
        request.headers.get("x-gateway-signature");

      if (
        !withdrawal.gateway ||
        !verifyCallbackSignature(
          rawBody,
          signature,
          withdrawal.gateway.apiKey,
        )
      ) {
        return jsonError("回调签名校验失败", 401);
      }
    }

    if (!withdrawal.playerId) {
      return jsonError("提现单未绑定玩家，无法扣减余额", 409);
    }

    if (status === "failed") {
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.withdrawal.updateMany({
          where: { id: withdrawal.id, status: "pending" },
          data: {
            status: "failed",
            txHash,
            processedAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          const current = await tx.withdrawal.findUnique({
            where: { id: withdrawal.id },
            select: { status: true },
          });

          return { currentStatus: current?.status ?? "unknown" };
        }

        return { currentStatus: "failed" };
      });

      if (result.currentStatus === "failed") {
        return Response.json({
          success: true,
          replayed: true,
          withdrawalId: withdrawal.id,
          status: "failed",
        });
      }

      if (result.currentStatus === "success") {
        return jsonError("提现单已成功出款，不能回退为失败", 409);
      }

      return jsonError("提现单状态异常，无法处理失败回调", 409);
    }

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawal.id, status: "pending" },
        data: {
          status: "success",
          txHash,
          processedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        const current = await tx.withdrawal.findUnique({
          where: { id: withdrawal.id },
          select: { status: true },
        });

        return {
          credited: false,
          currentStatus: current?.status ?? "unknown",
          transactionId: null as string | null,
          balance: null as string | null,
        };
      }

      // 条件扣减：余额不足时更新 0 行，整个事务回滚，提现单仍是 pending。
      const player = await tx.player.updateMany({
        where: {
          id: withdrawal.playerId!,
          balance: { gte: withdrawal.amount },
        },
        data: { balance: { decrement: withdrawal.amount } },
      });

      if (player.count === 0) {
        throw new InsufficientBalanceError();
      }

      const transaction = await tx.transaction.create({
        data: {
          tenantId: withdrawal.tenantId,
          playerId: withdrawal.playerId,
          type: "withdraw",
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          status: "success",
          txHash,
        },
        select: { id: true },
      });

      const updatedPlayer = await tx.player.findUnique({
        where: { id: withdrawal.playerId! },
        select: { balance: true },
      });

      return {
        credited: true,
        currentStatus: "success",
        transactionId: transaction.id,
        balance: updatedPlayer?.balance.toFixed(6) ?? null,
      };
    });

    if (result.credited) {
      return Response.json({
        success: true,
        replayed: false,
        withdrawalId: withdrawal.id,
        status: "success",
        transactionId: result.transactionId,
        balance: result.balance,
        gateway: withdrawal.gateway?.name ?? null,
      });
    }

    if (result.currentStatus === "success") {
      return Response.json({
        success: true,
        replayed: true,
        withdrawalId: withdrawal.id,
        status: "success",
      });
    }

    if (result.currentStatus === "failed") {
      return jsonError("提现单已标记失败，不能重新扣款", 409);
    }

    return jsonError("提现单状态异常，无法处理成功回调", 409);
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      return jsonError("玩家余额不足，提现单保持待处理", 409);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("该交易哈希已被其他提现单使用，已拒绝重复扣款", 409);
    }

    console.error("处理代付回调失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

