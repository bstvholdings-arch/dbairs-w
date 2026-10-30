import { connection } from "next/server";

import { prisma } from "@/lib/prisma";
import { tenantSelect } from "@/lib/tenant-api";

import { TenantsClient } from "./tenants-client";
import type { TenantRow } from "./types";

export const metadata = {
  title: "Tenants | DBAIRS Super Admin",
  description:
    "Manage DBAIRS tenants, brand domains, and withdrawal approval requirements.",
};

export const instant = false;

export default async function AdminTenantsPage() {
  await connection();

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: tenantSelect,
  });

  const rows: TenantRow[] = tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    domain: tenant.domain,
    subdomain: tenant.subdomain,
    status: tenant.status,
    withdrawalRequiredApprovals: tenant.withdrawalRequiredApprovals,
    createdAt: tenant.createdAt.toISOString(),
  }));

  return <TenantsClient initialTenants={rows} />;
}
