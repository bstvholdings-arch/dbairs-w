import { redirect } from "next/navigation";
import { connection } from "next/server";

import { toNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getSessionUserFromCookies } from "@/lib/session";

import { TenantPlayersView } from "./tenant-players-client";

export const metadata = {
  title: "My Players | DBAIRS Tenant Console",
  description: "View the current tenant's players and balances.",
};

export const instant = false;

export default async function TenantPlayersPage() {
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user || user.role !== "tenant_admin" || !user.tenantId) {
    redirect("/login?next=/tenant/players");
  }

  const tenantId = user.tenantId;

  const [players, total] = await Promise.all([
    prisma.player.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        username: true,
        balance: true,
        status: true,
        createdAt: true,
        _count: { select: { betRecords: true } },
      },
    }),
    prisma.player.count({ where: { tenantId } }),
  ]);

  return (
    <TenantPlayersView
      tenantName={user.tenant?.name ?? ""}
      total={total}
      players={players.map((player) => ({
        id: player.id,
        username: player.username,
        balance: toNumber(player.balance),
        status: player.status,
        betRecords: player._count.betRecords,
        createdAt: player.createdAt.toISOString(),
      }))}
    />
  );
}
