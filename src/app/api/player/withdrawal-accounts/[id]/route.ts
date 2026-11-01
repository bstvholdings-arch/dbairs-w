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

/**
 * 单条提现账号操作（只能操作自己的账号，tenantId 取自玩家 JWT）。
 *
 * PATCH  /api/player/withdrawal-accounts/[id]  Body: { isDefault: true }  设为默认
 * DELETE /api/player/withdrawal-accounts/[id]                            删除
 *
 * 两个动作都会在事务里重新维护不变量：
 * - 默认账号永远唯一（删除默认账号后自动把最早绑定的那条顶上）；
 * - 默认加密货币账号同步回写 Player.walletAddress。
 */

type RouteContext = { params: Promise<{ id: string }> };

function noStoreJson(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function jsonError(code: string, message: string, status: number) {
  return noStoreJson({ error: message, code }, status);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("unauthorized", "未登录或登录已过期", 401);
  }

  const { id } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_request", "请求体格式错误", 400);
  }

  const input = (body ?? {}) as Record<string, unknown>;

  if (input.isDefault !== true) {
    return jsonError("invalid_request", "目前只支持设为默认账号", 400);
  }

  try {
    const accounts = await prisma.$transaction(async (tx) => {
      const account = await tx.playerWithdrawalAccount.findFirst({
        where: { id, playerId: session.id, tenantId: session.tenantId },
        select: { id: true },
      });

      if (!account) {
        return null;
      }

      await tx.playerWithdrawalAccount.updateMany({
        where: { playerId: session.id, tenantId: session.tenantId },
        data: { isDefault: false },
      });

      await tx.playerWithdrawalAccount.update({
        where: { id: account.id },
        data: { isDefault: true },
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

    if (!accounts) {
      return jsonError("account_not_found", "未找到该提现账号", 404);
    }

    return noStoreJson({ success: true, accounts });
  } catch (error) {
    console.error("设置默认提现账号失败:", error);
    return jsonError("account_update_failed", "设置默认账号失败，请稍后重试", 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("unauthorized", "未登录或登录已过期", 401);
  }

  const { id } = await context.params;

  try {
    const accounts = await prisma.$transaction(async (tx) => {
      const account = await tx.playerWithdrawalAccount.findFirst({
        where: { id, playerId: session.id, tenantId: session.tenantId },
        select: { id: true },
      });

      if (!account) {
        return null;
      }

      await tx.playerWithdrawalAccount.delete({
        where: { id: account.id },
        select: { id: true },
      });

      await ensureDefaultWithdrawalAccount(tx, session.id, session.tenantId);
      await syncPlayerDefaultWalletAddress(tx, session.id);

      const rows = await tx.playerWithdrawalAccount.findMany({
        where: { playerId: session.id, tenantId: session.tenantId },
        orderBy: PLAYER_WITHDRAWAL_ACCOUNT_ORDER,
        select: PLAYER_WITHDRAWAL_ACCOUNT_SELECT,
      });

      return rows.map(serializePlayerWithdrawalAccount);
    });

    if (!accounts) {
      return jsonError("account_not_found", "未找到该提现账号", 404);
    }

    return noStoreJson({ success: true, accounts });
  } catch (error) {
    console.error("删除提现账号失败:", error);
    return jsonError("account_delete_failed", "删除失败，请稍后重试", 500);
  }
}
