import type { KycStatus, Prisma } from "@prisma/client";

import type { PlayerSessionInfo } from "./player-session";
import { availableBalanceToString } from "./player-balance";
import { listPlayerWithdrawalAccounts } from "./player-withdrawal-accounts";
import { prisma } from "./prisma";
import type { PlayerWithdrawalAccountView } from "./withdrawal-accounts";
import { inFlightWithdrawalStatusList } from "./withdrawal-status";

const REFERRAL_REWARD_RATE = Number(process.env.REFERRAL_REWARD_RATE ?? "0.05");
const DAILY_BONUS_AMOUNT = Number(process.env.DAILY_BONUS_AMOUNT ?? "0.5");

export type PlayerProfileTransaction = {
  id: string;
  type: string;
  amount: string;
  currency: string;
  status: string;
  txHash: string | null;
  createdAt: string;
};

export type PlayerProfileDeposit = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  gatewayName: string;
  createdAt: string;
};

export type PlayerProfileWithdrawal = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  walletAddress: string;
  createdAt: string;
};

export type PlayerProfileBet = {
  id: string;
  providerName: string;
  betAmount: string;
  payoutAmount: string;
  ggrAmount: string;
  currency: string;
  status: string;
  createdAt: string;
  settledAt: string | null;
};

export type PlayerProfileData = {
  player: {
    id: string;
    username: string;
    email: string | null;
    phone: string | null;
    walletAddress: string | null;
    referralCode: string;
    createdAt: string;
    lastLoginAt: string | null;
    tenant: PlayerSessionInfo["tenant"];
  };
  summary: {
    balance: string;
    totalDeposits: string;
    totalWithdrawals: string;
    totalRewards: string;
    totalBetAmount: string;
    totalPayout: string;
    /**
     * 今日（UTC 零点起、剔除 void 作废单）的下注额 / 派彩额。
     * 玩家中心「今日输赢」= todayPayout - todayBetAmount，
     * 页面只展示正向净盈利，亏损 / 打平一律按 $0.00 处理。
     */
    todayBetAmount: string;
    todayPayout: string;
    pendingDeposits: number;
    pendingWithdrawals: number;
    /**
     * 处理中提现单的金额合计。pending 阶段不扣余额，
     * 提现弹窗用「balance - pendingWithdrawalAmount」展示真正的可用余额。
     */
    pendingWithdrawalAmount: string;
    /** 可用余额 = balance - pendingWithdrawalAmount（大厅顶栏 / 玩家中心同口径） */
    availableBalance: string;
  };
  transactions: PlayerProfileTransaction[];
  deposits: PlayerProfileDeposit[];
  withdrawals: PlayerProfileWithdrawal[];
  bets: PlayerProfileBet[];
  /** 安全 Tab 的「提现账号」列表：加密货币 + 全球法币收款账号 */
  withdrawalAccounts: PlayerWithdrawalAccountView[];
  referral: {
    code: string;
    invitedCount: number;
    rewardTotal: string;
    ratePercent: number;
    rewardCount: number;
  };
  dailyBonus: {
    amount: string;
    claimedToday: boolean;
  };
  /** 实名认证状态：NONE 表示从未提交过 */
  kyc: PlayerProfileKyc;
};

export type PlayerProfileKyc = {
  status: "NONE" | KycStatus;
  rejectReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
};

function safeRate() {
  if (!Number.isFinite(REFERRAL_REWARD_RATE)) {
    return 0.05;
  }

  return Math.min(Math.max(REFERRAL_REWARD_RATE, 0), 0.5);
}

function safeBonus() {
  if (!Number.isFinite(DAILY_BONUS_AMOUNT) || DAILY_BONUS_AMOUNT <= 0) {
    return "0.5";
  }

  return DAILY_BONUS_AMOUNT.toFixed(6);
}

function utcStartOfToday() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function decimalSum(value: Prisma.Decimal | null | undefined) {
  return value?.toString() ?? "0";
}

/**
 * 玩家中心一次读齐四个 Tab 所需数据：
 * - Wallet：余额、累计充值 / 提现 / 奖励、最近流水与充值 / 提现订单；
 * - History：最近注单；
 * - Security：邮箱与绑定钱包；
 * - Referral：邀请人数、返佣总额、推广码。
 */
export async function getPlayerProfileData(
  session: PlayerSessionInfo,
): Promise<PlayerProfileData> {
  const [
    depositAggregate,
    withdrawalAggregate,
    rewardAggregate,
    betAggregate,
    payoutAggregate,
    todayBetAggregate,
    todayPayoutAggregate,
    pendingDeposits,
    pendingWithdrawals,
    pendingWithdrawalAggregate,
    transactions,
    deposits,
    withdrawals,
    bets,
    invitedCount,
    referralRewardAggregate,
    dailyBonusClaim,
    kycRecord,
    withdrawalAccounts,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: { playerId: session.id, type: "deposit", status: "success" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { playerId: session.id, type: "withdraw", status: "success" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        playerId: session.id,
        type: { in: ["referral", "daily_bonus"] },
        status: "success",
      },
      _sum: { amount: true },
    }),
    prisma.betRecord.aggregate({
      where: { playerId: session.id },
      _sum: { betAmount: true },
    }),
    prisma.betRecord.aggregate({
      where: { playerId: session.id },
      _sum: { payoutAmount: true },
    }),
    // 今日输赢：和「每日奖励」一样按 UTC 零点切分，只统计有效注单
    // （void 作废单派彩为 0，计入会凭空放大玩家的“亏损”）。
    prisma.betRecord.aggregate({
      where: {
        playerId: session.id,
        status: { not: "void" },
        createdAt: { gte: utcStartOfToday() },
      },
      _sum: { betAmount: true },
    }),
    prisma.betRecord.aggregate({
      where: {
        playerId: session.id,
        status: { not: "void" },
        createdAt: { gte: utcStartOfToday() },
      },
      _sum: { payoutAmount: true },
    }),
    prisma.depositOrder.count({
      where: { playerId: session.id, status: "pending" },
    }),
    prisma.withdrawal.count({
      where: { playerId: session.id, status: { in: inFlightWithdrawalStatusList() } },
    }),
    // 处理中提现单的金额合计：可用余额 = balance - 这笔钱（见提现弹窗）
    prisma.withdrawal.aggregate({
      where: { playerId: session.id, status: { in: inFlightWithdrawalStatusList() } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { playerId: session.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        status: true,
        txHash: true,
        createdAt: true,
      },
    }),
    prisma.depositOrder.findMany({
      where: { playerId: session.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
        gateway: { select: { name: true } },
      },
    }),
    prisma.withdrawal.findMany({
      where: { playerId: session.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        walletAddress: true,
        createdAt: true,
      },
    }),
    prisma.betRecord.findMany({
      where: { playerId: session.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        betAmount: true,
        payoutAmount: true,
        ggrAmount: true,
        currency: true,
        status: true,
        createdAt: true,
        settledAt: true,
        provider: { select: { name: true } },
      },
    }),
    prisma.player.count({ where: { referredById: session.id } }),
    prisma.referralReward.aggregate({
      where: { inviterId: session.id },
      _sum: { rewardAmount: true },
      _count: { _all: true },
    }),
    prisma.dailyBonusClaim.findUnique({
      where: {
        playerId_claimDate: {
          playerId: session.id,
          claimDate: utcStartOfToday(),
        },
      },
      select: { id: true },
    }),
    // 实名认证：玩家中心要显示「请完成实名认证以解锁提现」，必须带上 tenantId 双条件
    prisma.playerKyc.findFirst({
      where: { playerId: session.id, tenantId: session.tenantId },
      select: {
        status: true,
        rejectReason: true,
        createdAt: true,
        reviewedAt: true,
      },
    }),
    // 提现账号（加密货币 + 全球法币）：安全 Tab 的列表与动态表单都用这份数据
    listPlayerWithdrawalAccounts(session.id, session.tenantId),
  ]);

  return {
    player: {
      id: session.id,
      username: session.username,
      email: session.email,
      phone: session.phone,
      walletAddress: session.walletAddress,
      referralCode: session.referralCode,
      createdAt: session.createdAt,
      lastLoginAt: session.lastLoginAt,
      tenant: session.tenant,
    },
    summary: {
      balance: session.balance,
      totalDeposits: decimalSum(depositAggregate._sum.amount),
      totalWithdrawals: decimalSum(withdrawalAggregate._sum.amount),
      totalRewards: decimalSum(rewardAggregate._sum.amount),
      totalBetAmount: decimalSum(betAggregate._sum.betAmount),
      totalPayout: decimalSum(payoutAggregate._sum.payoutAmount),
      todayBetAmount: decimalSum(todayBetAggregate._sum.betAmount),
      todayPayout: decimalSum(todayPayoutAggregate._sum.payoutAmount),
      pendingDeposits,
      pendingWithdrawals,
      pendingWithdrawalAmount: decimalSum(pendingWithdrawalAggregate._sum.amount),
      availableBalance: availableBalanceToString(
        session.balance,
        decimalSum(pendingWithdrawalAggregate._sum.amount),
      ),
    },
    transactions: transactions.map((item) => ({
      id: item.id,
      type: item.type,
      amount: item.amount.toString(),
      currency: item.currency,
      status: item.status,
      txHash: item.txHash,
      createdAt: item.createdAt.toISOString(),
    })),
    deposits: deposits.map((item) => ({
      id: item.id,
      amount: item.amount.toString(),
      currency: item.currency,
      status: item.status,
      gatewayName: item.gateway.name,
      createdAt: item.createdAt.toISOString(),
    })),
    withdrawals: withdrawals.map((item) => ({
      id: item.id,
      amount: item.amount.toString(),
      currency: item.currency,
      status: item.status,
      walletAddress: item.walletAddress,
      createdAt: item.createdAt.toISOString(),
    })),
    bets: bets.map((item) => ({
      id: item.id,
      providerName: item.provider.name,
      betAmount: item.betAmount.toString(),
      payoutAmount: item.payoutAmount.toString(),
      ggrAmount: item.ggrAmount.toString(),
      currency: item.currency,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      settledAt: item.settledAt?.toISOString() ?? null,
    })),
    withdrawalAccounts,
    referral: {
      code: session.referralCode,
      invitedCount,
      rewardTotal: decimalSum(referralRewardAggregate._sum.rewardAmount),
      rewardCount: referralRewardAggregate._count._all,
      ratePercent: Math.round(safeRate() * 10000) / 100,
    },
    dailyBonus: {
      amount: safeBonus(),
      claimedToday: Boolean(dailyBonusClaim),
    },
    kyc: {
      status: kycRecord?.status ?? "NONE",
      rejectReason: kycRecord?.rejectReason ?? null,
      submittedAt: kycRecord?.createdAt.toISOString() ?? null,
      reviewedAt: kycRecord?.reviewedAt?.toISOString() ?? null,
    },
  };
}

