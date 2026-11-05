import { connection } from "next/server";

import { formatAmount, toNumber } from "@/lib/format";
import { calculateGgr } from "@/lib/ggr-settlement";
import { prisma } from "@/lib/prisma";
import { inFlightWithdrawalStatusList } from "@/lib/withdrawal-status";

import { AdminDashboardView } from "./dashboard-client";

export const metadata = {
  title: "Dashboard | DBAIRS Super Admin",
  description:
    "Platform-wide overview of tenants, game providers, GGR, and withdrawal approvals.",
};

export const instant = false;

export default async function AdminDashboardPage() {
  await connection();

  const [
    tenantTotal,
    tenantActive,
    providerTotal,
    providerActive,
    betAggregate,
    winAggregate,
    pendingCount,
    pendingAggregate,
    recentTenants,
    pendingWithdrawals,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: "active" } }),
    prisma.gameProvider.count(),
    prisma.gameProvider.count({ where: { status: "active" } }),
    prisma.transaction.aggregate({
      where: { type: "bet", status: "success" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "win", status: "success" },
      _sum: { amount: true },
    }),
    prisma.withdrawal.count({
      where: { status: { in: inFlightWithdrawalStatusList() } },
    }),
    prisma.withdrawal.aggregate({
      where: { status: { in: inFlightWithdrawalStatusList() } },
      _sum: { amount: true },
    }),
    prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        domain: true,
        status: true,
        createdAt: true,
        _count: { select: { players: true } },
      },
    }),
    prisma.withdrawal.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        amount: true,
        walletAddress: true,
        approvals: true,
        requiredApprovals: true,
        createdAt: true,
        tenant: { select: { name: true } },
      },
    }),
  ]);

  const totalBets = toNumber(betAggregate._sum.amount);
  const totalPayouts = toNumber(winAggregate._sum.amount);
  const ggr = calculateGgr(totalBets, totalPayouts);
  const ggrValue = ggr.isNegative()
    ? `-$${formatAmount(ggr.abs())}`
    : `$${formatAmount(ggr)}`;

  return (
    <AdminDashboardView
      tenantTotal={tenantTotal}
      tenantActive={tenantActive}
      providerTotal={providerTotal}
      providerActive={providerActive}
      totalBets={totalBets}
      totalPayouts={totalPayouts}
      ggrValue={ggrValue}
      pendingCount={pendingCount}
      pendingTotal={toNumber(pendingAggregate._sum.amount)}
      recentTenants={recentTenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        status: tenant.status,
        players: tenant._count.players,
        createdAt: tenant.createdAt.toISOString(),
      }))}
      pendingWithdrawals={pendingWithdrawals.map((withdrawal) => ({
        id: withdrawal.id,
        amount: toNumber(withdrawal.amount),
        walletAddress: withdrawal.walletAddress,
        approvals: withdrawal.approvals,
        requiredApprovals: withdrawal.requiredApprovals,
        createdAt: withdrawal.createdAt.toISOString(),
        tenantName: withdrawal.tenant.name,
      }))}
    />
  );
}
