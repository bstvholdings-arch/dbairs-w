import { Prisma } from "@prisma/client";

import { prisma } from "./prisma";

/**
 * 支付利润 = 总代收流水 × 差价率 + 总代付流水 × 差价率。
 *
 * 当前业务统一按 0.3% 差价展示（如成本 0.5%、售价 0.8%）。
 * 这里只做 Transaction 聚合计算，不创建平台内部资金账户，也不做资金划转。
 */
export const PAYMENT_SPREAD_RATE = new Prisma.Decimal("0.003");

export type MonthlyFinanceTotals = {
  deposit: Prisma.Decimal;
  withdraw: Prisma.Decimal;
  payinProfit: Prisma.Decimal;
  payoutProfit: Prisma.Decimal;
  paymentProfit: Prisma.Decimal;
  ggr: Prisma.Decimal;
  platformFee: Prisma.Decimal;
};

export type MonthlyTenantFinanceRow = MonthlyFinanceTotals & {
  tenantId: string;
  tenantName: string;
};

export type MonthlyDepositRow = {
  id: string;
  amount: Prisma.Decimal;
  currency: string;
  createdAt: Date;
  txHash: string | null;
  tenantName: string;
  playerUsername: string;
  gatewayName: string;
};

export type MonthlyFinanceSummary = {
  monthLabel: string;
  monthStart: Date;
  monthEnd: Date;
  paymentSpreadRate: string;
  totals: MonthlyFinanceTotals;
  tenantRows: MonthlyTenantFinanceRow[];
  recentDeposits: MonthlyDepositRow[];
};

function zero() {
  return new Prisma.Decimal(0);
}

export function calculatePaymentProfit(volume: Prisma.Decimal) {
  return volume.mul(PAYMENT_SPREAD_RATE).toDecimalPlaces(6);
}

function emptyTotals(): MonthlyFinanceTotals {
  return {
    deposit: zero(),
    withdraw: zero(),
    payinProfit: zero(),
    payoutProfit: zero(),
    paymentProfit: zero(),
    ggr: zero(),
    platformFee: zero(),
  };
}

function addTo(
  map: Map<string, MonthlyFinanceTotals>,
  tenantId: string,
  field: keyof MonthlyFinanceTotals,
  value: Prisma.Decimal,
) {
  const current = map.get(tenantId) ?? emptyTotals();

  current[field] = current[field].plus(value);
  map.set(tenantId, current);
}

/**
 * 本月对账口径：
 * - 充值 / 出金：Transaction 中 status=success 的 deposit / withdraw。
 * - 支付利润：代收流水 × 0.3% + 代付流水 × 0.3%，仅做展示，不生成内部转账。
 * - GGR：BetRecord.ggrAmount 的月度合计。
 * - 平台应收 GGR 技术费：逐条注单使用下注瞬间快照的 snapshotPlatformMarkup 计算，
 *   即 Σ(ggrAmount × snapshotPlatformMarkup)。这样后台后续调整点数不会污染历史账单。
 */
export async function getMonthlyFinanceSummary({
  tenantId,
  now = new Date(),
}: {
  tenantId?: string;
  now?: Date;
}): Promise<MonthlyFinanceSummary> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  const tenantFilter = tenantId ? { tenantId } : {};
  const createdAtFilter = { gte: monthStart, lt: monthEnd };

  const [depositGroups, withdrawGroups, bets, tenants, recentDeposits] =
    await Promise.all([
      prisma.transaction.groupBy({
        by: ["tenantId"],
        where: {
          ...tenantFilter,
          type: "deposit",
          status: "success",
          createdAt: createdAtFilter,
        },
        _sum: { amount: true },
      }),
      prisma.transaction.groupBy({
        by: ["tenantId"],
        where: {
          ...tenantFilter,
          type: "withdraw",
          status: "success",
          createdAt: createdAtFilter,
        },
        _sum: { amount: true },
      }),
      prisma.betRecord.findMany({
        where: {
          ...tenantFilter,
          status: "settled",
          createdAt: createdAtFilter,
        },
        select: {
          tenantId: true,
          ggrAmount: true,
          snapshotPlatformMarkup: true,
        },
      }),
      prisma.tenant.findMany({
        where: tenantId ? { id: tenantId } : {},
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.depositOrder.findMany({
        where: {
          ...tenantFilter,
          status: "success",
          createdAt: createdAtFilter,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          amount: true,
          currency: true,
          createdAt: true,
          txHash: true,
          tenant: { select: { name: true } },
          player: { select: { username: true } },
          gateway: { select: { name: true } },
        },
      }),
    ]);

  const byTenant = new Map<string, MonthlyFinanceTotals>();

  for (const group of depositGroups) {
    const amount = group._sum.amount ?? zero();

    addTo(byTenant, group.tenantId, "deposit", amount);
    addTo(
      byTenant,
      group.tenantId,
      "payinProfit",
      calculatePaymentProfit(amount),
    );
  }

  for (const group of withdrawGroups) {
    const amount = group._sum.amount ?? zero();

    addTo(byTenant, group.tenantId, "withdraw", amount);
    addTo(
      byTenant,
      group.tenantId,
      "payoutProfit",
      calculatePaymentProfit(amount),
    );
  }

  for (const bet of bets) {
    addTo(byTenant, bet.tenantId, "ggr", bet.ggrAmount);
    addTo(
      byTenant,
      bet.tenantId,
      "platformFee",
      bet.ggrAmount.mul(bet.snapshotPlatformMarkup),
    );
  }

  const totals = emptyTotals();

  const tenantRows: MonthlyTenantFinanceRow[] = tenants.map((tenant) => {
    const row = byTenant.get(tenant.id) ?? emptyTotals();
    const paymentProfit = row.payinProfit
      .plus(row.payoutProfit)
      .toDecimalPlaces(6);

    totals.deposit = totals.deposit.plus(row.deposit);
    totals.withdraw = totals.withdraw.plus(row.withdraw);
    totals.payinProfit = totals.payinProfit.plus(row.payinProfit);
    totals.payoutProfit = totals.payoutProfit.plus(row.payoutProfit);
    totals.paymentProfit = totals.paymentProfit.plus(paymentProfit);
    totals.ggr = totals.ggr.plus(row.ggr);
    totals.platformFee = totals.platformFee.plus(row.platformFee);

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      ...row,
      paymentProfit,
    };
  });

  const monthLabel = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(monthStart);

  return {
    monthLabel,
    monthStart,
    monthEnd,
    paymentSpreadRate: PAYMENT_SPREAD_RATE.toFixed(6),
    totals,
    tenantRows,
    recentDeposits: recentDeposits.map((deposit) => ({
      id: deposit.id,
      amount: deposit.amount,
      currency: deposit.currency,
      createdAt: deposit.createdAt,
      txHash: deposit.txHash,
      tenantName: deposit.tenant.name,
      playerUsername: deposit.player.username,
      gatewayName: deposit.gateway.name,
    })),
  };
}
