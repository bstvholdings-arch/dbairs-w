import { redirect } from "next/navigation";
import { connection } from "next/server";

import { formatAmount, toNumber } from "@/lib/format";
import { calculateGgr } from "@/lib/ggr-settlement";
import { prisma } from "@/lib/prisma";
import { getSessionUserFromCookies } from "@/lib/session";

import { TenantDashboardView } from "./tenant-dashboard-client";

export const metadata = {
  title: "My Dashboard | DBAIRS Tenant Console",
  description:
    "Overview of players, agents, GGR, and withdrawals for the current tenant.",
};

export const instant = false;

export default async function TenantDashboardPage() {
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user || user.role !== "tenant_admin" || !user.tenantId) {
    redirect("/login?next=/tenant");
  }

  const tenantId = user.tenantId;

  const [
    playerCount,
    agentCount,
    betAggregate,
    pendingCount,
    pendingAggregate,
    recentBets,
  ] = await Promise.all([
    prisma.player.count({ where: { tenantId } }),
    prisma.agent.count({ where: { tenantId } }),
    prisma.betRecord.aggregate({
      where: { tenantId, status: "settled" },
      _sum: { betAmount: true, payoutAmount: true },
    }),
    prisma.withdrawal.count({ where: { tenantId, status: "pending" } }),
    prisma.withdrawal.aggregate({
      where: { tenantId, status: "pending" },
      _sum: { amount: true },
    }),
    prisma.betRecord.findMany({
      where: { tenantId, status: "settled" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        betAmount: true,
        payoutAmount: true,
        ggrAmount: true,
        createdAt: true,
        provider: { select: { name: true } },
      },
    }),
  ]);

  const totalBets = toNumber(betAggregate._sum.betAmount);
  const totalPayouts = toNumber(betAggregate._sum.payoutAmount);
  const ggr = calculateGgr(totalBets, totalPayouts);
  const ggrValue = ggr.isNegative()
    ? `-$${formatAmount(ggr.abs())}`
    : `$${formatAmount(ggr)}`;

  return (
    <TenantDashboardView
      tenantName={user.tenant?.name ?? ""}
      playerCount={playerCount}
      agentCount={agentCount}
      totalBets={totalBets}
      totalPayouts={totalPayouts}
      ggrValue={ggrValue}
      pendingCount={pendingCount}
      pendingTotal={toNumber(pendingAggregate._sum.amount)}
      recentBets={recentBets.map((bet) => ({
        id: bet.id,
        providerName: bet.provider.name,
        betAmount: toNumber(bet.betAmount),
        payoutAmount: toNumber(bet.payoutAmount),
        ggrAmount: toNumber(bet.ggrAmount),
        createdAt: bet.createdAt.toISOString(),
      }))}
    />
  );
}
