import { redirect } from "next/navigation";
import { connection } from "next/server";

import { resolveEffectivePoints } from "@/lib/ggr-settlement";
import { prisma } from "@/lib/prisma";
import { getSessionUserFromCookies } from "@/lib/session";

import { TenantProvidersView } from "./tenant-providers-client";

export const metadata = {
  title: "My Game Rates | DBAIRS Tenant Console",
  description:
    "View the game providers available to the current tenant and the final GGR settlement points.",
};

export const instant = false;

export default async function TenantProvidersPage() {
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user || user.role !== "tenant_admin" || !user.tenantId) {
    redirect("/login?next=/tenant/providers");
  }

  const tenantId = user.tenantId;

  const providers = await prisma.gameProvider.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      upstreamPoint: true,
      platformMarkup: true,
      tenantPoints: {
        where: { tenantId },
        select: { customPoint: true },
        take: 1,
      },
    },
  });

  // Only expose the final settlement point to tenants.
  const rows = providers.map((provider) => {
    const points = resolveEffectivePoints(
      provider.upstreamPoint,
      provider.platformMarkup,
      provider.tenantPoints[0]?.customPoint ?? null,
    );

    return {
      id: provider.id,
      name: provider.name,
      effectivePoint: points.effectivePoint.toString(),
    };
  });

  return (
    <TenantProvidersView
      tenantName={user.tenant?.name ?? ""}
      rows={rows}
    />
  );
}
