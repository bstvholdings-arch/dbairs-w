import type { Prisma } from "@prisma/client";

import { prisma } from "./prisma";
import {
  maskBankAccountNumber,
  type PlayerWithdrawalAccountType,
  type PlayerWithdrawalAccountView,
} from "./withdrawal-accounts";

/**
 * 玩家提现账号的服务端数据层：
 * - SELECT / ORDER / 序列化只在这里定义，玩家中心 SSR 与两个 API 路由共用；
 * - 任何写操作都要经过 syncPlayerDefaultWalletAddress + ensureDefaultWithdrawalAccount，
 *   保证「默认账号唯一」与「旧 Player.walletAddress 同步」两条不变量。
 */

export const PLAYER_WITHDRAWAL_ACCOUNT_SELECT = {
  id: true,
  currency: true,
  network: true,
  accountType: true,
  walletAddress: true,
  bankName: true,
  accountNumber: true,
  accountName: true,
  isDefault: true,
  createdAt: true,
} satisfies Prisma.PlayerWithdrawalAccountSelect;

/** 默认账号排最前，其余按绑定时间升序：列表顺序稳定，不会因为更新而跳动。 */
export const PLAYER_WITHDRAWAL_ACCOUNT_ORDER = [
  { isDefault: "desc" },
  { createdAt: "asc" },
] satisfies Prisma.PlayerWithdrawalAccountOrderByWithRelationInput[];

export type PlayerWithdrawalAccountRow =
  Prisma.PlayerWithdrawalAccountGetPayload<{
    select: typeof PLAYER_WITHDRAWAL_ACCOUNT_SELECT;
  }>;

/** 落库前统一整形：不相关字段返回 null，银行账号只返回掩码。 */
export function serializePlayerWithdrawalAccount(
  row: PlayerWithdrawalAccountRow,
): PlayerWithdrawalAccountView {
  const accountType: PlayerWithdrawalAccountType =
    row.accountType === "bank" ? "bank" : "crypto";
  const isBank = accountType === "bank";

  return {
    id: row.id,
    currency: row.currency,
    network: row.network,
    accountType,
    walletAddress: isBank ? null : row.walletAddress,
    bankName: isBank ? row.bankName : null,
    accountNumber:
      isBank && row.accountNumber
        ? maskBankAccountNumber(row.accountNumber)
        : null,
    accountName: isBank ? row.accountName : null,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPlayerWithdrawalAccounts(
  playerId: string,
  tenantId: string,
): Promise<PlayerWithdrawalAccountView[]> {
  const rows = await prisma.playerWithdrawalAccount.findMany({
    where: { playerId, tenantId },
    orderBy: PLAYER_WITHDRAWAL_ACCOUNT_ORDER,
    select: PLAYER_WITHDRAWAL_ACCOUNT_SELECT,
  });

  return rows.map(serializePlayerWithdrawalAccount);
}

/**
 * 把默认的加密货币账号同步回 Player.walletAddress，
 * 兼容旧提现流程（/api/withdrawal/create 默认填充）与商户后台的「绑定钱包」展示。
 * 玩家没有任何加密货币账号时保持旧值不动，避免误清空历史数据。
 */
export async function syncPlayerDefaultWalletAddress(
  client: Prisma.TransactionClient,
  playerId: string,
): Promise<void> {
  const preferred =
    (await client.playerWithdrawalAccount.findFirst({
      where: { playerId, accountType: "crypto", isDefault: true },
      select: { walletAddress: true },
    })) ??
    (await client.playerWithdrawalAccount.findFirst({
      where: { playerId, accountType: "crypto", walletAddress: { not: null } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { walletAddress: true },
    }));

  if (!preferred?.walletAddress) {
    return;
  }

  await client.player.update({
    where: { id: playerId },
    data: { walletAddress: preferred.walletAddress },
    select: { id: true },
  });
}

/**
 * 保证「每个玩家至少有一条默认账号」：
 * 删除默认账号或取消默认后调用，优先把最早绑定的那条顶上。
 */
export async function ensureDefaultWithdrawalAccount(
  client: Prisma.TransactionClient,
  playerId: string,
  tenantId: string,
): Promise<string | null> {
  const current = await client.playerWithdrawalAccount.findFirst({
    where: { playerId, tenantId, isDefault: true },
    select: { id: true },
  });

  if (current) {
    return current.id;
  }

  const fallback = await client.playerWithdrawalAccount.findFirst({
    where: { playerId, tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!fallback) {
    return null;
  }

  await client.playerWithdrawalAccount.update({
    where: { id: fallback.id },
    data: { isDefault: true },
    select: { id: true },
  });

  return fallback.id;
}
