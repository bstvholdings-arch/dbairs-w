import { Prisma } from "@prisma/client";

import { prisma } from "./prisma";
import {
  WITHDRAWAL_STATUS_FAILED,
  WITHDRAWAL_STATUS_PENDING,
  WITHDRAWAL_STATUS_PROCESSING,
  WITHDRAWAL_STATUS_SUCCESS,
} from "./withdrawal-status";

/**
 * 提现「出款成功 / 失败 / 退回人工队列」的唯一结算实现。
 *
 * 为什么集中一份：同一笔出款有三条触发路径 ——
 *   1. 代付商回调 POST /api/withdrawal/callback
 *   2. 商户人工审批 PATCH /api/tenant/withdrawals/[id]（approve）
 *   3. 自动出款引擎 src/lib/auto-payout.ts（processing → success）
 * 三者必须是**完全一样**的记账口径，否则「自动打款成功」和「回调成功」会写出
 * 两套不同的流水，对账立刻炸。以前 1 和 2 各写了一份几乎相同的代码，这里收口。
 *
 * 防重复扣款的核心：`updateMany({ where: { id, status: { in: [...] } } })` 是数据库层
 * compare-and-swap —— 并发到达的请求里只有一个能把状态迁走，其余 count=0，
 * 直接返回 replay / not_claimable，一分钱都不会多扣。
 */

/** 余额不足：事务内抛出 → 整笔回滚，提现单保持原状态 */
class WithdrawalBalanceError extends Error {}

export type WithdrawalSettleOutcome =
  | {
      settled: true;
      /** true = 这一笔之前已经结算过（回调重放 / 并发请求后到），本次没有动钱 */
      replay: boolean;
      currentStatus: string;
      balance: string | null;
      transactionId: string | null;
    }
  | {
      settled: false;
      reason:
        | "not_found"
        | "not_claimable"
        | "insufficient_balance"
        | "duplicate_reference";
      currentStatus: string | null;
    };

export type SettleWithdrawalSuccessInput = {
  withdrawalId: string;
  /** 商户范围：传了就只认这一家的单，别家的单号等价于「不存在」 */
  tenantId?: string;
  /** 允许从哪些状态迁到 success（人工审批 = pending；回调 / 自动出款 = pending + processing） */
  fromStatuses: readonly string[];
  /** 出款流水号 / 代付商单号；没有就写 null（不要写空字符串） */
  txHash: string | null;
  /** 人工审批留痕：approvals + 1 */
  incrementApprovals?: boolean;
  /** 结算后的路由原因快照（auto_paid / null 表示不改） */
  riskStatus?: string | null;
};

/**
 * 出款成功：`fromStatuses → success` + 扣 Player.balance + 写 Transaction(type=withdraw)。
 * 三步在同一个事务里，绝不会「扣了钱没记账」或「记了账没扣钱」。
 */
export async function settleWithdrawalSuccess(
  input: SettleWithdrawalSuccessInput,
): Promise<WithdrawalSettleOutcome> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: {
          id: input.withdrawalId,
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          status: { in: [...input.fromStatuses] },
        },
        data: {
          status: WITHDRAWAL_STATUS_SUCCESS,
          txHash: input.txHash,
          processedAt: new Date(),
          ...(input.riskStatus !== undefined
            ? { riskStatus: input.riskStatus }
            : {}),
          ...(input.incrementApprovals
            ? { approvals: { increment: 1 } }
            : {}),
        },
      });

      if (claimed.count === 0) {
        const current = await tx.withdrawal.findUnique({
          where: { id: input.withdrawalId },
          select: { status: true },
        });

        return {
          kind: current ? ("blocked" as const) : ("missing" as const),
          currentStatus: current?.status ?? null,
          balance: null,
          transactionId: null,
        };
      }

      const row = await tx.withdrawal.findUnique({
        where: { id: input.withdrawalId },
        select: {
          tenantId: true,
          playerId: true,
          amount: true,
          currency: true,
        },
      });

      if (!row?.playerId) {
        // 没有玩家的提现单（历史脏数据 / 后台代提）不扣余额，但状态已经迁走。
        return {
          kind: "settled" as const,
          balance: null,
          transactionId: null,
          currentStatus: WITHDRAWAL_STATUS_SUCCESS,
        };
      }

      // 条件扣减：余额不足时更新 0 行 → 抛错回滚，提现单回到迁移前的状态。
      const player = await tx.player.updateMany({
        where: { id: row.playerId, balance: { gte: row.amount } },
        data: { balance: { decrement: row.amount } },
      });

      if (player.count === 0) {
        throw new WithdrawalBalanceError();
      }

      const transaction = await tx.transaction.create({
        data: {
          tenantId: row.tenantId,
          playerId: row.playerId,
          type: "withdraw",
          amount: row.amount,
          currency: row.currency,
          status: "success",
          txHash: input.txHash,
        },
        select: { id: true },
      });

      const updatedPlayer = await tx.player.findUnique({
        where: { id: row.playerId },
        select: { balance: true },
      });

      return {
        kind: "settled" as const,
        balance: updatedPlayer?.balance.toFixed(6) ?? null,
        transactionId: transaction.id,
        currentStatus: WITHDRAWAL_STATUS_SUCCESS,
      };
    });

    if (result.kind === "missing") {
      return { settled: false, reason: "not_found", currentStatus: null };
    }

    if (result.kind === "blocked") {
      if (result.currentStatus === WITHDRAWAL_STATUS_SUCCESS) {
        return {
          settled: true,
          replay: true,
          currentStatus: WITHDRAWAL_STATUS_SUCCESS,
          balance: null,
          transactionId: null,
        };
      }

      return {
        settled: false,
        reason: "not_claimable",
        currentStatus: result.currentStatus,
      };
    }

    return {
      settled: true,
      replay: false,
      currentStatus: result.currentStatus ?? WITHDRAWAL_STATUS_SUCCESS,
      balance: result.balance ?? null,
      transactionId: result.transactionId ?? null,
    };
  } catch (error) {
    if (error instanceof WithdrawalBalanceError) {
      return {
        settled: false,
        reason: "insufficient_balance",
        currentStatus: null,
      };
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        settled: false,
        reason: "duplicate_reference",
        currentStatus: null,
      };
    }

    throw error;
  }
}

export type WithdrawalFailOutcome =
  | { changed: true; currentStatus: string }
  | { changed: false; currentStatus: string | null };

/**
 * 出款失败 / 人工驳回：`fromStatuses → failed`，**不动余额、不写流水**
 * （钱没出去，玩家可以重新提单）。
 */
export async function markWithdrawalFailed(input: {
  withdrawalId: string;
  tenantId?: string;
  fromStatuses: readonly string[];
  riskStatus?: string | null;
  /** 失败回调里带回来的代付单号 / 失败凭证（可选） */
  txHash?: string | null;
}): Promise<WithdrawalFailOutcome> {
  const updated = await prisma.withdrawal.updateMany({
    where: {
      id: input.withdrawalId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      status: { in: [...input.fromStatuses] },
    },
    data: {
      status: WITHDRAWAL_STATUS_FAILED,
      processedAt: new Date(),
      ...(input.riskStatus !== undefined ? { riskStatus: input.riskStatus } : {}),
      ...(input.txHash !== undefined ? { txHash: input.txHash } : {}),
    },
  });

  if (updated.count > 0) {
    return { changed: true, currentStatus: WITHDRAWAL_STATUS_FAILED };
  }

  const current = await prisma.withdrawal.findUnique({
    where: { id: input.withdrawalId },
    select: { status: true },
  });

  return { changed: false, currentStatus: current?.status ?? null };
}

/**
 * 自动出款失败兜底：`processing → pending`，把单子**退回人工审核队列**。
 *
 * 为什么不直接置 failed：代付 API 挂了 / 超时不代表这笔钱不该给玩家，
 * 直接 failed 会让玩家的提现申请凭空消失（钱没出去，单子却没了）。
 * 退回 pending 后商户在审批台点一次 Approve 就能人工出款；
 * riskStatus 记成 auto_payout_failed，商户一眼能看出「这单是自动打款没成功」。
 */
export async function returnWithdrawalToManualReview(input: {
  withdrawalId: string;
  tenantId?: string;
  riskStatus: string;
}): Promise<WithdrawalFailOutcome> {
  const updated = await prisma.withdrawal.updateMany({
    where: {
      id: input.withdrawalId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      status: WITHDRAWAL_STATUS_PROCESSING,
    },
    data: {
      status: WITHDRAWAL_STATUS_PENDING,
      riskStatus: input.riskStatus,
      processedAt: null,
    },
  });

  if (updated.count > 0) {
    return { changed: true, currentStatus: WITHDRAWAL_STATUS_PENDING };
  }

  const current = await prisma.withdrawal.findUnique({
    where: { id: input.withdrawalId },
    select: { status: true },
  });

  return { changed: false, currentStatus: current?.status ?? null };
}
