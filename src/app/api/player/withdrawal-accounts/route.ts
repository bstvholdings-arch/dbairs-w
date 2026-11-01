import type { NextRequest } from "next/server";

import {
  ensureDefaultWithdrawalAccount,
  PLAYER_WITHDRAWAL_ACCOUNT_ORDER,
  PLAYER_WITHDRAWAL_ACCOUNT_SELECT,
  serializePlayerWithdrawalAccount,
  syncPlayerDefaultWalletAddress,
} from "@/lib/player-withdrawal-accounts";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";
import { readWithdrawalAccountDraft } from "@/lib/withdrawal-accounts";

/**
 * 玩家提现账号（全球法币 / 加密货币）。
 *
 * GET  /api/player/withdrawal-accounts —— 读取自己的收款账号列表
 * POST /api/player/withdrawal-accounts —— 保存账号（同「币种 + 网络」做覆盖更新）
 *
 * Body: { currency, network?, walletAddress?, bankName?, accountNumber?, accountName?, isDefault? }
 * - 账号类型由服务端币种目录决定，请求体里的 accountType / playerId / tenantId 一律忽略；
 * - 第一条账号自动成为默认；isDefault=true 时其它账号的默认标记会被清空；
 * - 默认的加密货币账号会同步回写 Player.walletAddress（兼容旧提现流程）。
 */

function noStoreJson(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function jsonError(code: string, message: string, status: number) {
  return noStoreJson({ error: message, code }, status);
}

async function findPlayerAccounts(playerId: string, tenantId: string) {
  const rows = await prisma.playerWithdrawalAccount.findMany({
    where: { playerId, tenantId },
    orderBy: PLAYER_WITHDRAWAL_ACCOUNT_ORDER,
    select: PLAYER_WITHDRAWAL_ACCOUNT_SELECT,
  });

  return rows.map(serializePlayerWithdrawalAccount);
}

export async function GET(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("unauthorized", "未登录或登录已过期", 401);
  }

  try {
    return noStoreJson({
      success: true,
      accounts: await findPlayerAccounts(session.id, session.tenantId),
    });
  } catch (error) {
    console.error("读取玩家提现账号失败:", error);
    return jsonError("account_read_failed", "读取提现账号失败，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("unauthorized", "未登录或登录已过期", 401);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_request", "请求体格式错误", 400);
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const parsed = readWithdrawalAccountDraft(input);

  if (!parsed.ok) {
    return jsonError(parsed.code, parsed.message, 400);
  }

  const draft = parsed.value;
  const wantDefault = input.isDefault === true;

  try {
    const accounts = await prisma.$transaction(async (tx) => {
      const existing = await tx.playerWithdrawalAccount.count({
        where: { playerId: session.id, tenantId: session.tenantId },
      });

      // 第一条账号自动设为默认，否则听前端的 isDefault（用户显式勾选）。
      const makeDefault = wantDefault || existing === 0;

      if (makeDefault) {
        await tx.playerWithdrawalAccount.updateMany({
          where: {
            playerId: session.id,
            tenantId: session.tenantId,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      await tx.playerWithdrawalAccount.upsert({
        where: {
          playerId_currency_network: {
            playerId: session.id,
            currency: draft.currency,
            network: draft.network,
          },
        },
        create: {
          tenantId: session.tenantId,
          playerId: session.id,
          currency: draft.currency,
          network: draft.network,
          accountType: draft.accountType,
          walletAddress: draft.walletAddress,
          bankName: draft.bankName,
          accountNumber: draft.accountNumber,
          accountName: draft.accountName,
          isDefault: makeDefault,
        },
        update: {
          accountType: draft.accountType,
          walletAddress: draft.walletAddress,
          bankName: draft.bankName,
          accountNumber: draft.accountNumber,
          accountName: draft.accountName,
          ...(makeDefault ? { isDefault: true } : {}),
        },
        select: { id: true },
      });

      await syncPlayerDefaultWalletAddress(tx, session.id);
      await ensureDefaultWithdrawalAccount(tx, session.id, session.tenantId);

      const rows = await tx.playerWithdrawalAccount.findMany({
        where: { playerId: session.id, tenantId: session.tenantId },
        orderBy: PLAYER_WITHDRAWAL_ACCOUNT_ORDER,
        select: PLAYER_WITHDRAWAL_ACCOUNT_SELECT,
      });

      return rows.map(serializePlayerWithdrawalAccount);
    });

    return noStoreJson({ success: true, accounts }, 201);
  } catch (error) {
    console.error("保存玩家提现账号失败:", error);
    return jsonError("account_save_failed", "保存失败，请稍后重试", 500);
  }
}
