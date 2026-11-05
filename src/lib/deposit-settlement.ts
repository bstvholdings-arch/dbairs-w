import { Prisma } from "@prisma/client";

import {
  DEPOSIT_MANUAL_REVIEW_APPROVED,
  DEPOSIT_MANUAL_REVIEW_PENDING,
  DEPOSIT_MANUAL_REVIEW_REJECTED,
} from "./payment-gateway-constants";
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
 *
 * 第四条防线（资金安全红线）：静态码 / 银行转账通道（见 gatewayRequiresManualReview）
 * **永不自动上分**，回调只调 recordManualDepositCallback 把订单挂进人工审核队列；
 * 真正加钱必须由商户在 /tenant/deposits 点【确认到账】→ settleDepositOrder(requireManualReview)。
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
  manualReviewStatus: true,
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
  | { kind: "not-awaiting-review" }
  | { kind: "unknown-status"; status: string }
  | { kind: "not-found" };

export type DepositFailureOutcome =
  | { kind: "failed" }
  | { kind: "already-failed" }
  | { kind: "already-success" }
  | { kind: "not-awaiting-review" }
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
 *
 * 人工审核通道（STATIC_QR / BANK_TRANSFER）由商户在后台点【确认到账】时调用，
 * 此时必须传 `tenantId` + `expectManualReviewStatus`：
 * - `expectManualReviewStatus: "pending"` = 只接受「已收到付款信号」的订单；
 * - `expectManualReviewStatus: null` = 只接受「还没收到任何付款信号」的订单
 *   （玩家扫码付了钱却没点「我已付款」就关掉页面，商户核对银行流水后主动确认）。
 * 该字段参与 CAS，所以「商户连点两次」或「商户点了 + 支付商又回调一次」都只加一次钱；
 * tenantId 参与 where：别家商户的单号等价于「不存在」，不泄露任何信息。
 */
export async function settleDepositOrder(input: {
  orderId: string;
  txHash: string;
  /** 人工审核路径必须带：订单必须属于这家商户 */
  tenantId?: string;
  /**
   * 人工审核路径必须带：CAS 期望的 `manualReviewStatus` 当前值。
   * 不传 = 不做人工审核 CAS（支付商回调自动上分的口径）。
   */
  expectManualReviewStatus?: "pending" | null;
}): Promise<DepositSettlementOutcome> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.depositOrder.findUnique({
      where: { id: input.orderId },
      select: orderSelect,
    });

    if (!order) {
      return { kind: "not-found" };
    }

    // 人工审核路径：别家商户的单号一律当「不存在」，不泄露任何信息。
    if (input.tenantId && order.tenantId !== input.tenantId) {
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

    // 人工审核路径：订单必须还在「等人工确认」，否则说明已被处理过（商户连点 / 并发审批）。
    const manualReviewCas = input.expectManualReviewStatus !== undefined;

    if (
      manualReviewCas &&
      order.manualReviewStatus !== input.expectManualReviewStatus
    ) {
      return { kind: "not-awaiting-review" };
    }

    const claimed = await tx.depositOrder.updateMany({
      // 人工审核路径把 manualReviewStatus 也放进 CAS：
      // 两个并发的「确认到账」只有一个能把期望值改成 approved，另一个 count=0 不加钱。
      where: {
        id: order.id,
        status: "pending",
        ...(manualReviewCas
          ? { manualReviewStatus: input.expectManualReviewStatus }
          : {}),
      },
      data: {
        status: "success",
        txHash: input.txHash,
        ...(manualReviewCas
          ? { manualReviewStatus: DEPOSIT_MANUAL_REVIEW_APPROVED }
          : {}),
      },
    });

    if (claimed.count === 0) {
      // 并发请求已经先一步迁移了状态：按最新状态返回，不做任何资金变动。
      const current = await tx.depositOrder.findUnique({
        where: { id: order.id },
        select: { status: true, manualReviewStatus: true },
      });

      if (current?.status === "success") {
        return { kind: "already-success", transactionId: null };
      }

      if (current?.status === "failed") {
        return { kind: "already-failed" };
      }

      if (
        manualReviewCas &&
        current?.manualReviewStatus !== input.expectManualReviewStatus
      ) {
        return { kind: "not-awaiting-review" };
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

/**
 * 失败回调 / 商户驳回：只把 pending 置为 failed，永远不碰余额。
 *
 * 人工审核通道（STATIC_QR / BANK_TRANSFER）由商户点【驳回】时调用，
 * 必须传 `tenantId` + `expectManualReviewStatus`：只接受 CAS 期望值匹配的订单，
 * 避免把一个已经在走别的分支的订单误判为失败。
 */
export async function failDepositOrder(input: {
  orderId: string;
  /** 失败回调可能没有交易号，允许为空（DepositOrder.txHash 本身可空） */
  txHash: string | null;
  /** 人工审核路径必须带：订单必须属于这家商户 */
  tenantId?: string;
  /** 人工审核路径必须带：CAS 期望的 `manualReviewStatus` 当前值 */
  expectManualReviewStatus?: "pending" | null;
}): Promise<DepositFailureOutcome> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.depositOrder.findUnique({
      where: { id: input.orderId },
      select: { id: true, tenantId: true, status: true, manualReviewStatus: true },
    });

    if (!order) {
      return { kind: "not-found" };
    }

    // 人工审核路径：别家商户的单号一律当「不存在」。
    if (input.tenantId && order.tenantId !== input.tenantId) {
      return { kind: "not-found" };
    }

    if (order.status === "failed") {
      return { kind: "already-failed" };
    }

    if (order.status === "success") {
      return { kind: "already-success" };
    }

    if (
      input.expectManualReviewStatus !== undefined &&
      order.manualReviewStatus !== input.expectManualReviewStatus
    ) {
      return { kind: "not-awaiting-review" };
    }

    const claimed = await tx.depositOrder.updateMany({
      where: {
        id: order.id,
        status: "pending",
        ...(input.expectManualReviewStatus !== undefined
          ? { manualReviewStatus: input.expectManualReviewStatus }
          : {}),
      },
      data: {
        status: "failed",
        txHash: input.txHash,
        ...(input.expectManualReviewStatus !== undefined
          ? { manualReviewStatus: DEPOSIT_MANUAL_REVIEW_REJECTED }
          : {}),
      },
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

/**
 * 人工审核通道收到「已付款」信号：**绝不加钱**，只把订单挂进商户的待审队列。
 *
 * 触发来源有两种：
 * 1. 支付商回调 `/api/deposit/callback[...]`（静态码接的是聚合支付商时会有）；
 * 2. 玩家点「我已完成支付」（走 /api/deposit/test-callback → 旧回调入口）。
 *
 * 幂等：CAS 条件是 `status=pending + manualReviewStatus=null`，
 * 同一个订单回调 10 次只有第 1 次写得进去（count=1），其余返回 `already-awaiting`
 * —— 队列里永远只有一条，也不会因为「重复回调」产生任何资金变动。
 *
 * 金额不写入 `txHash`（那是唯一索引字段，只给真正入账用），
 * 支付商交易号单独存 `callbackTxHash`，人工确认时再落到 `txHash` 上接受唯一约束检查。
 */
export async function recordManualDepositCallback(input: {
  orderId: string;
  /** 回调带回的金额；拿不到就传 null（静态码常见） */
  amount: Prisma.Decimal | null;
  txHash: string | null;
}): Promise<
  | { kind: "awaiting-review" }
  | { kind: "already-awaiting" }
  | { kind: "already-success" }
  | { kind: "already-failed" }
  | { kind: "not-found" }
> {
  const order = await prisma.depositOrder.findUnique({
    where: { id: input.orderId },
    select: { id: true, status: true, manualReviewStatus: true },
  });

  if (!order) {
    return { kind: "not-found" };
  }

  if (order.status === "success") {
    return { kind: "already-success" };
  }

  if (order.status === "failed") {
    return { kind: "already-failed" };
  }

  const claimed = await prisma.depositOrder.updateMany({
    where: {
      id: order.id,
      status: "pending",
      manualReviewStatus: null,
    },
    data: {
      manualReviewStatus: DEPOSIT_MANUAL_REVIEW_PENDING,
      callbackAmount: input.amount,
      callbackTxHash: input.txHash,
      callbackReceivedAt: new Date(),
    },
  });

  if (claimed.count === 0) {
    return { kind: "already-awaiting" };
  }

  console.info("[deposit-manual-review] 已转入人工审核（未加钱）", {
    orderId: order.id,
    callbackAmount: input.amount?.toFixed(6) ?? null,
    hasCallbackTxHash: Boolean(input.txHash),
  });

  return { kind: "awaiting-review" };
}
