import { connection } from "next/server";

import { prisma } from "@/lib/prisma";
import { providerSelect, serializeProvider } from "@/lib/provider-api";

import { ProvidersClient } from "./providers-client";
import type { ProviderRow } from "./types";

export const metadata = {
  title: "Game Providers | DBAIRS Super Admin",
  description:
    "Manage provider upstream points, platform markup, and tenant settlement points. All revenue shares apply to GGR only.",
};

export const instant = false;

export default async function AdminProvidersPage() {
  await connection();

  const providers = await prisma.gameProvider.findMany({
    orderBy: [{ sortOrder: "desc" }, { status: "asc" }, { name: "asc" }],
    select: providerSelect,
  });

  const rows: ProviderRow[] = providers.map((provider) => {
    const serialized = serializeProvider(provider);

    return {
      id: serialized.id,
      name: serialized.name,
      upstreamPoint: serialized.upstreamPoint,
      platformMarkup: serialized.platformMarkup,
      downstreamPoint: serialized.downstreamPoint,
      status: serialized.status,
      sortOrder: serialized.sortOrder,
      isActive: serialized.isActive,
      gameCount: serialized.gameCount,
      tenantOverrideCount: serialized.tenantOverrideCount,
      betRecordCount: serialized.betRecordCount,
      updatedAt: serialized.updatedAt,
    };
  });

  return <ProvidersClient initialProviders={rows} />;
}
