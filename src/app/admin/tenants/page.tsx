import { connection } from "next/server";

import { prisma } from "@/lib/prisma";
import { tenantSelect } from "@/lib/tenant-api";
import { listTenantAdminAccounts } from "@/lib/tenant-admin-account";

import { TenantsClient } from "./tenants-client";
import type { TenantRow } from "./types";

export const metadata = {
  title: "Tenants | DBAIRS Super Admin",
  description:
    "Manage DBAIRS tenants, brand domains, withdrawal approval requirements and tenant admin accounts.",
};

export const instant = false;

export default async function AdminTenantsPage() {
  await connection();

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: tenantSelect,
  });

  // 每个租户的管理员账号（tenant_admin）：列表里直接显示「是否已分配」，
  // 避免老板要点进编辑弹窗才知道谁在管这个站。
  const adminsByTenant = await listTenantAdminAccounts(
    tenants.map((tenant) => tenant.id),
  );

  const rows: TenantRow[] = tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    domain: tenant.domain,
    subdomain: tenant.subdomain,
    status: tenant.status,
    withdrawalRequiredApprovals: tenant.withdrawalRequiredApprovals,
    createdAt: tenant.createdAt.toISOString(),
    admins: adminsByTenant.get(tenant.id) ?? [],
  }));

  return <TenantsClient initialTenants={rows} />;
}
