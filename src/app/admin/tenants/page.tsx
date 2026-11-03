import { connection } from "next/server";

import { prisma } from "@/lib/prisma";
import { tenantSelectWithLayout, toTenantPayload } from "@/lib/tenant-api";
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
    select: tenantSelectWithLayout,
  });

  // 每个租户的管理员账号（tenant_admin）：列表里直接显示「是否已分配」，
  // 避免老板要点进编辑弹窗才知道谁在管这个站。
  const adminsByTenant = await listTenantAdminAccounts(
    tenants.map((tenant) => tenant.id),
  );

  const rows: TenantRow[] = tenants.map((tenant) => {
    // toTenantPayload 会把 layoutConfig 收敛成 themeBackground，不整包传进前端
    const payload = toTenantPayload(tenant);

    return {
      id: payload.id,
      name: payload.name,
      domain: payload.domain,
      subdomain: payload.subdomain,
      backupDomains: payload.backupDomains ?? [],
      status: payload.status,
      withdrawalRequiredApprovals: payload.withdrawalRequiredApprovals,
      // 开站 / 编辑弹窗要回填当前主题背景色
      themeBackground: payload.themeBackground,
      createdAt: payload.createdAt.toISOString(),
      admins: adminsByTenant.get(payload.id) ?? [],
    };
  });

  return <TenantsClient initialTenants={rows} />;
}
