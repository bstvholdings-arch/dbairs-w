import { Prisma } from "@prisma/client";

import { prisma } from "./prisma";

/**
 * 充值入账（上分）的唯一实现。
 *
 * 旧的 /api/deposit/callback 与新的 /api/deposit/callback/[gatewayCode]
 * 都调用这里，避免两套回调各写一份「加余额」逻辑而出现口径不一致。
 *
 * 防重放 / 防双花的三道锁：
 * 1. 条件更新（compare-and-swap）：`updateMany({ where: { id, status: "pending" } })`，
 *    数据库行锁保证只有一个并发请求能把 pending 改成 success，只有它才继续加余额；
 * 2. 幂等短路：订单已是 success 时直接返回 already-success，绝不第二次 increment；
 * 3. 唯一约束：DepositOrder 的 @@unique([gatewayId, txHash]) 挡住「同一笔第三方
 *    交易号刷不同订单」的重放（P2002 由上层映射成 409）。
 *
 * 原子性：状态迁移、余额增加、流水写入、推广返佣都在同一个 $transaction 内，
 * 任一步失败整体回滚 —— 不会出现「订单成功但没加钱」或「加了钱但没流水」。
 */

/** 事务超时：回调链路要经过支付商网关，默认 5s 偏紧，这里放宽。 */
const SETTLE_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 15_000,
} as const;

const orderSelect = {
  id: true,
  tenantId: true,
  playerId: true,
  amount: true,
  currency: true,
  status: true,
  txHash: true,
  player: {
    select: {
      referredById: true,
      referredBy: { select: { id: true, status: true } },
    },
  },
} satisfies Prisma.DepositOrderSelect;

export type DepositOrderSnapshot = Prisma.DepositOrderGetPayload<{
  select: typeof orderSelect;
}>;

export type DepositSettlementOutcome =
  | {
      kind: "credited";
      transactionId: string;
      balance: string;
      referralRewarded: boolean;
    }
  | { kind: "already-success"; transactionId: string | null }
  | { kind: "already-failed" }
  | { kind: "unknown-status"; status: string }
  | { kind: "not-found" };

export type DepositFailureOutcome =
  | { kind: "failed" }
  | { kind: "already-failed" }
  | { kind: "already-success" }
  | { kind: "unknown-status"; status: string }
  | { kind: "not-found" };

/** 返佣比例读环境变量，越界值直接视为「不返佣」，避免配置错误放大资金风险。 */
function readReferralRewardRate() {
  try {
    const rate = new Prisma.Decimal(process.env.REFERRAL_REWARD_RATE ?? "0.05");

    if (rate.lessThanOrEqualTo(0) || rate.greaterThan(0.5)) {
      return null;
    }

    return rate;
  } catch {
    return null;
  }
}

/**
 * 推广返佣：仅对「被邀请人的首笔成功充值」发放，防止刷返佣。
 * - 必须在写入本笔 deposit 流水之前统计历史成功充值；
 * - depositOrderId 唯一 + 事务回滚，保证回调重试不会重复返佣；
 * - 邀请人余额与返佣流水、奖励记录在同一个事务里落库。
 */
async function applyReferralReward(
  tx: Prisma.TransactionClient,
  order: DepositOrderSnapshot,
) {
  const inviter = order.player.referredBy;
  const rewardRate = readReferralRewardRate();

  if (!inviter || inviter.status !== "active" || !rewardRate) {
    return false;
  }

  const previousDeposits = await tx.transaction.count({
    where: {
      playerId: order.playerId,
      type: "deposit",
      status: "success",
    },
  });

  if (previousDeposits > 0) {
    return false;
  }

  const rewardAmount = order.amount
    .mul(rewardRate)
    .toDecimalPlaces(6, Prisma.Decimal.ROUND_DOWN);

  if (!rewardAmount.greaterThan(0)) {
    return false;
  }

  await tx.player.update({
    where: { id: inviter.id },
    data: { balance: { increment: rewardAmount } },
  });

  await tx.transaction.create({
    data: {
      tenantId: order.tenantId,
      playerId: inviter.id,
      type: "referral",
      amount: rewardAmount,
      currency: order.currency,
      status: "success",
      txHash: `referral-${order.id}`,
    },
  });

  await tx.referralReward.create({
    data: {
      tenantId: order.tenantId,
      inviterId: inviter.id,
      referredPlayerId: order.playerId,
      depositOrderId: order.id,
      depositAmount: order.amount,
      rewardRate,
      rewardAmount,
      currency: order.currency,
    },
  });

  return true;
}

/** 订单已 success 时，回查原始入账流水 id，方便支付商后台做对账跳转。 */
async function findDepositTransactionId(
  tx: Prisma.TransactionClient,
  order: DepositOrderSnapshot,
  fallbackTxHash: string,
) {
  const existed = await tx.transaction.findFirst({
    where: {
      playerId: order.playerId,
      type: "deposit",
      txHash: order.txHash ?? fallbackTxHash,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  return existed?.id ?? null;
}

/**
 * 成功回调上分。
 * `txHash` 是第三方交易号 / 链上哈希，必须由调用方校验过格式。
 */
export async function settleDepositOrder(input: {
  orderId: string;
  txHash: string;
}): Promise<DepositSettlementOutcome> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.depositOrder.findUnique({
      where: { id: input.orderId },
      select: orderSelect,
    });

    if (!order) {
      return { kind: "not-found" };
    }

    // 幂等短路：已入账的订单直接返回，绝不重复加余额。
    if (order.status === "success") {
      return {
        kind: "already-success",
        transactionId: await findDepositTransactionId(tx, order, input.txHash),
      };
    }

    if (order.status !== "pending") {
      return { kind: "unknown-status", status: order.status };
    }

    const claimed = await tx.depositOrder.updateMany({
      where: { id: order.id, status: "pending" },
      data: { status: "success", txHash: input.txHash },
    });

    if (claimed.count === 0) {
      // 并发请求已经先一步迁移了状态：按最新状态返回，不做任何资金变动。
      const current = await tx.depositOrder.findUnique({
        where: { id: order.id },
        select: { status: true },
      });

      if (current?.status === "success") {
        return { kind: "already-success", transactionId: null };
      }

      if (current?.status === "failed") {
        return { kind: "already-failed" };
      }

      return { kind: "unknown-status", status: current?.status ?? "unknown" };
    }

    // 只加余额，不做「先读余额再写回」，避免并发充值互相覆盖。
    const player = await tx.player.update({
      where: { id: order.playerId },
      data: { balance: { increment: order.amount } },
      select: { balance: true },
    });

    const referralRewarded = await applyReferralReward(tx, order);

    const transaction = await tx.transaction.create({
      data: {
        tenantId: order.tenantId,
        playerId: order.playerId,
        type: "deposit",
        amount: order.amount,
        currency: order.currency,
        status: "success",
        txHash: input.txHash,
      },
      select: { id: true },
    });

    return {
      kind: "credited",
      transactionId: transaction.id,
      balance: player.balance.toFixed(6),
      referralRewarded,
    };
  }, SETTLE_TRANSACTION_OPTIONS);
}

/** 失败回调：只把 pending 置为 failed，永远不碰余额。 */
export async function failDepositOrder(input: {
  orderId: string;
  /** 失败回调可能没有交易号，允许为空（DepositOrder.txHash 本身可空） */
  txHash: string | null;
}): Promise<DepositFailureOutcome> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.depositOrder.findUnique({
      where: { id: input.orderId },
      select: { id: true, status: true },
    });

    if (!order) {
      return { kind: "not-found" };
    }

    if (order.status === "failed") {
      return { kind: "already-failed" };
    }

    if (order.status === "success") {
      return { kind: "already-success" };
    }

    const claimed = await tx.depositOrder.updateMany({
      where: { id: order.id, status: "pending" },
      data: { status: "failed", txHash: input.txHash },
    });

    if (claimed.count === 0) {
      const current = await tx.depositOrder.findUnique({
        where: { id: order.id },
        select: { status: true },
      });

      if (current?.status === "failed") {
        return { kind: "already-failed" };
      }

      if (current?.status === "success") {
        return { kind: "already-success" };
      }

      return { kind: "unknown-status", status: current?.status ?? "unknown" };
    }

    return { kind: "failed" };
  }, SETTLE_TRANSACTION_OPTIONS);
}
