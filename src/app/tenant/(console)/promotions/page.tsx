import { redirect } from "next/navigation";
import { connection } from "next/server";

import { loadTenantPromotionData } from "@/lib/promotions";
import { getTenantScopeFromCookies } from "@/lib/tenant-console";

import { TenantPromotionsClient } from "./tenant-promotions-client";

export const metadata = {
  title: "Promotions | DBAIRS Tenant Console",
  description:
    "Manage promotion categories and banner creatives shown on the player promotions hall.",
};

export const instant = false;

/**
 * 商户后台【活动管理】。
 *
 * - 数据范围只有当前租户（query 一律带 tenantId，见 lib/promotions.ts）；
 * - 玩家前台的 /promotions 读的是同一批数据（只读启用中的），
 *   这里保存后玩家刷新即可看到，无需额外发布流程；
 * - 活动图片上传走 POST /api/tenant/promotions/upload（guardTenantApi 校验商户身份）。
 */
export default async function TenantPromotionsPage() {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/promotions");
  }

  const data = await loadTenantPromotionData(scope.tenantId);

  return (
    <TenantPromotionsClient
      initialData={data}
      tenantName={scope.tenant.name}
    />
  );
}
