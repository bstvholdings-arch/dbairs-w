import { Prisma } from "@prisma/client";

import { normalizeCurrency } from "./currency";
import { prisma } from "./prisma";
import {
  activeRebateCategories,
  calculateRebateAmount,
  isRebateCategoryId,
  normalizeRebateConfig,
  rebateRateOf,
  REBATE_MIN_PAYOUT,
  type RebateCategoryId,
} from "./rebate-config";

/**
 * 每日洗码结算引擎。
 *
 * 口径（改之前先想清楚这四条）：
 * 1. **按 UTC 日界切账**：periodStart 是某一天 00:00 UTC，窗口是 [periodStart, +1 day)，
 *    与每日签到 (DailyBonusClaim.claimDate) 同一口径，财务对账只认这一种切法。
 * 2. **流水 = BetRecord.betAmount 合计**（已作废 void 的注单不算），
 *    不是 GGR、也不是派彩额 —— 洗码返的是「打过的流水」。
 * 3. **费率与开关都读当次结算瞬间的 Tenant.rebateConfig**：
 *    品类关闭就整类跳过；费率快照写进 RebatePayout.ratePercent，事后改费率不重算历史。
 * 4. **幂等靠数据库唯一键** @@unique([tenantId, playerId, category, periodStart])：
 *    定时任务被重跑 / 补跑时命中 P2002 直接算「已结过」，绝不重复发钱。
 *
 * 调用入口：
 * - `POST /api/cron/rebate-settlement`（生产定时任务，带 REBATE_CRON_SECRET）
 * - `npm run rebate:settle -- --date=2026-11-03 --tenant=<id>`（本地 / 补发）
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ZERO = new Prisma.Decimal(0);

/** 取某一时刻所在 UTC 日的 00:00:00.000 */
export function utcStartOfDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

/** 默认结算「昨天」（UTC） */
export function previousUtcDayStart(now: Date = new Date()): Date {
  return new Date(utcStartOfDay(now).getTime() - ONE_DAY_MS);
}

/**
 * 解析命令行 / 查询串里的日期（YYYY-MM-DD）。
 * 非法值返回 null（调用方决定是 400 还是回落昨天）。
 */
export function parseSettlementDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type RebateSettlementOptions = {
  /** 结算哪一天的流水（UTC 日界），默认昨天 */
  periodStart?: Date;
  /** 只结算指定商户（排障 / 补发），默认全平台 */
  tenantId?: string;
  /** 只算不写（先看金额对不对，再真发） */
  dryRun?: boolean;
};

export type RebateSettlementTenantSummary = {
  tenantId: string;
  tenantName: string;
  categories: RebateCategoryId[];
  payouts: number;
  amount: string;
  /** 命中幂等键（已结过）/ 金额不足起付额的条数 */
  skipped: number;
};

export type RebateSettlementResult = {
  periodStart: string;
  periodEnd: string;
  dryRun: boolean;
  tenants: RebateSettlementTenantSummary[];
  totals: { payouts: number; amount: string; skipped: number };
};

/**
 * 跑一次结算。
 *
 * 单个玩家失败不影响其他人（try/catch 内聚到「跳过」），
 * 但整批结果会原样返回，方便定时任务日志里核对发了多少钱。
 */
export async function settleDailyRebates(
  options: RebateSettlementOptions = {},
): Promise<RebateSettlementResult> {
  const periodStart = utcStartOfDay(options.periodStart ?? previousUtcDayStart());
  const periodEnd = new Date(periodStart.getTime() + ONE_DAY_MS);
  const dryRun = options.dryRun === true;

  const tenants = await prisma.tenant.findMany({
    where: options.tenantId ? { id: options.tenantId } : {},
    select: {
      id: true,
      name: true,
      currency: true,
      rebateConfig: true,
    },
  });

  const summaries: RebateSettlementTenantSummary[] = [];
  let totalPayouts = 0;
  let totalAmount = ZERO;
  let totalSkipped = 0;

  for (const tenant of tenants) {
    const config = normalizeRebateConfig(tenant.rebateConfig);
    const categories = activeRebateCategories(config);

    // 一个品类都没开 → 这家商户今天没有洗码可发，直接跳过（连聚合都不跑）
    if (categories.length === 0) {
      continue;
    }

    const currency = normalizeCurrency(tenant.currency);
    const groups = await prisma.betRecord.groupBy({
      by: ["playerId", "gameCategory"],
      where: {
        tenantId: tenant.id,
        playerId: { not: null },
        gameCategory: { in: categories },
        status: { not: "void" },
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      _sum: { betAmount: true },
    });

    let payouts = 0;
    let skipped = 0;
    let amount = ZERO;

    for (const group of groups) {
      const playerId = group.playerId;

      if (!playerId || !isRebateCategoryId(group.gameCategory)) {
        continue;
      }

      const category = group.gameCategory;
      const turnover = group._sum.betAmount ?? ZERO;

      if (turnover.lte(0)) {
        continue;
      }

      const ratePercent = rebateRateOf(config, category);

      if (ratePercent <= 0) {
        continue;
      }

      const rebateAmount = calculateRebateAmount(turnover, ratePercent);

      // 零头不发（0.01 以下）：避免给几十万个玩家各发 0.001 元把流水表撑爆
      if (rebateAmount.lt(REBATE_MIN_PAYOUT)) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        payouts += 1;
        amount = amount.plus(rebateAmount);
        continue;
      }

      const written = await writeRebatePayout({
        tenantId: tenant.id,
        playerId,
        category,
        periodStart,
        turnover,
        ratePercent,
        rebateAmount,
        currency,
      });

      if (written) {
        payouts += 1;
        amount = amount.plus(rebateAmount);
      } else {
        skipped += 1;
      }
    }

    if (payouts === 0 && skipped === 0) {
      continue;
    }

    summaries.push({
      tenantId: tenant.id,
      tenantName: tenant.name,
      categories,
      payouts,
      amount: amount.toFixed(2),
      skipped,
    });

    totalPayouts += payouts;
    totalAmount = totalAmount.plus(amount);
    totalSkipped += skipped;
  }

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    dryRun,
    tenants: summaries,
    totals: {
      payouts: totalPayouts,
      amount: totalAmount.toFixed(2),
      skipped: totalSkipped,
    },
  };
}

type WriteRebatePayoutInput = {
  tenantId: string;
  playerId: string;
  category: RebateCategoryId;
  periodStart: Date;
  turnover: Prisma.Decimal;
  ratePercent: number;
  rebateAmount: Prisma.Decimal;
  currency: string;
};

/**
 * 落一笔洗码：结算单 + 资金流水 + 加余额，同一事务。
 *
 * 返回 false 表示「跳过」：幂等键命中（这一格今天已经结过）或者玩家已被删除。
 * 结算任务不因为单个玩家失败而整体中断。
 */
async function writeRebatePayout(
  input: WriteRebatePayoutInput,
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const payout = await tx.rebatePayout.create({
        data: {
          tenantId: input.tenantId,
          playerId: input.playerId,
          category: input.category,
          periodStart: input.periodStart,
          turnover: input.turnover.toDecimalPlaces(6),
          ratePercent: new Prisma.Decimal(input.ratePercent),
          rebateAmount: input.rebateAmount,
          currency: input.currency,
        },
        select: { id: true },
      });

      const transaction = await tx.transaction.create({
        data: {
          tenantId: input.tenantId,
          playerId: input.playerId,
          type: "rebate",
          amount: input.rebateAmount,
          currency: input.currency,
          status: "success",
          txHash: `rebate:${payout.id}`,
        },
        select: { id: true },
      });

      await tx.rebatePayout.update({
        where: { id: payout.id },
        data: { transactionId: transaction.id },
      });

      await tx.player.update({
        where: { id: input.playerId },
        data: { balance: { increment: input.rebateAmount } },
      });
    });

    return true;
  } catch (error) {
    // P2002 = 这一格（商户 + 玩家 + 品类 + 日期）已经结算过，属于正常跳过
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }

    console.error("写入洗码结算失败:", error);

    return false;
  }
}

export type RebatePayoutRow = {
  id: string;
  playerId: string;
  playerName: string;
  category: string;
  periodStart: string;
  turnover: string;
  rebateAmount: string;
  currency: string;
  createdAt: string;
};

export type TenantRebateOverview = {
  payouts: RebatePayoutRow[];
  /** 历史累计发放（含税前后口径一致：就是玩家到账金额） */
  totalAmount: string;
  payoutCount: number;
  playerCount: number;
};

/**
 * 商户后台【洗码管理】右侧列表：最近结算记录 + 累计发放。
 * 所有查询都带 tenantId（租户隔离），不接受前端传入的租户。
 */
export async function loadTenantRebateOverview(
  tenantId: string,
  take = 20,
): Promise<TenantRebateOverview> {
  const [rows, aggregate, players] = await Promise.all([
    prisma.rebatePayout.findMany({
      where: { tenantId },
      orderBy: [{ periodStart: "desc" }, { rebateAmount: "desc" }],
      take,
      select: {
        id: true,
        playerId: true,
        category: true,
        periodStart: true,
        turnover: true,
        rebateAmount: true,
        currency: true,
        createdAt: true,
        player: { select: { username: true } },
      },
    }),
    prisma.rebatePayout.aggregate({
      where: { tenantId },
      _sum: { rebateAmount: true },
      _count: { _all: true },
    }),
    prisma.rebatePayout.findMany({
      where: { tenantId },
      distinct: ["playerId"],
      select: { playerId: true },
    }),
  ]);

  return {
    payouts: rows.map((row) => ({
      id: row.id,
      playerId: row.playerId,
      playerName: row.player?.username ?? row.playerId.slice(0, 8),
      category: row.category,
      periodStart: row.periodStart.toISOString(),
      turnover: row.turnover.toFixed(2),
      rebateAmount: row.rebateAmount.toFixed(2),
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
    })),
    totalAmount: (aggregate._sum.rebateAmount ?? ZERO).toFixed(2),
    payoutCount: aggregate._count._all,
    playerCount: players.length,
  };
}

