import type { Prisma } from "@prisma/client";

import { prisma } from "./prisma";
import type { PlayerSessionInfo } from "./player-session";

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
    pendingDeposits: number;
    pendingWithdrawals: number;
  };
  transactions: PlayerProfileTransaction[];
  deposits: PlayerProfileDeposit[];
  withdrawals: PlayerProfileWithdrawal[];
  bets: PlayerProfileBet[];
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
    pendingDeposits,
    pendingWithdrawals,
    transactions,
    deposits,
    withdrawals,
    bets,
    invitedCount,
    referralRewardAggregate,
    dailyBonusClaim,
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
    prisma.depositOrder.count({
      where: { playerId: session.id, status: "pending" },
    }),
    prisma.withdrawal.count({
      where: { playerId: session.id, status: "pending" },
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
  ]);

  return {
    player: {
      id: session.id,
      username: session.username,
      email: session.email,
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
      pendingDeposits,
      pendingWithdrawals,
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
  };
}

