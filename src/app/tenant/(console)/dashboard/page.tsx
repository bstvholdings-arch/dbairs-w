import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  getTenantScopeFromCookies,
  loadTenantOverview,
} from "@/lib/tenant-console";

import { TenantOverviewView } from "./tenant-overview-client";

export const metadata = {
  title: "Tenant Overview | DBAIRS Tenant Console",
  description:
    "Players, deposits, withdrawals, GGR and platform service fees for the current tenant only.",
};

export const instant = false;

/**
 * 商户后台首页（数据概览）。
 *
 * 任何查询都必须带 where: { tenantId }：tenantId 只来自会话
 * （AdminUser.tenantId → session.tenantId），不接受 URL / 表单参数。
 */
export default async function TenantDashboardPage() {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/dashboard");
  }

  const overview = await loadTenantOverview(scope.tenantId);

  return (
    <TenantOverviewView
      tenantName={scope.tenant.name}
      overview={overview}
    />
  );
}
