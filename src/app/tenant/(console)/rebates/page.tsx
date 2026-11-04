import { redirect } from "next/navigation";
import { connection } from "next/server";

import { normalizeCurrency } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { normalizeRebateConfig } from "@/lib/rebate-config";
import { loadTenantRebateOverview } from "@/lib/rebate-settlement";
import { getTenantScopeFromCookies } from "@/lib/tenant-console";

import { TenantRebatesClient } from "./tenant-rebates-client";

export const metadata = {
  title: "Daily Rebate | DBAIRS Tenant Console",
  description:
    "Configure per-category daily rebate rates and review settled payouts.",
};

export const instant = false;

/**
 * 商户后台【洗码返水】。
 *
 * - 配置存在 `Tenant.rebateConfig`（JSON 列），读侧统一过
 *   normalizeRebateConfig（脏数据 / 老租户 = 全品类关闭，fail-closed）；
 * - 结算记录来自 RebatePayout（每人每品类每天一条，唯一索引兜住重复发放）；
 * - currency 取 Tenant.currency，前端渲染一律走 formatCurrency。
 */
export default async function TenantRebatesPage() {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/rebates");
  }

  const [tenant, overview] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: scope.tenantId },
      select: { currency: true, rebateConfig: true },
    }),
    loadTenantRebateOverview(scope.tenantId),
  ]);

  return (
    <TenantRebatesClient
      initialConfig={normalizeRebateConfig(tenant?.rebateConfig)}
      initialOverview={overview}
      currency={normalizeCurrency(tenant?.currency)}
    />
  );
}
