import { redirect } from "next/navigation";
import { connection } from "next/server";

import { loadTenantBonusCampaigns } from "@/lib/bonus-campaigns";
import { normalizeCurrency } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { getTenantScopeFromCookies } from "@/lib/tenant-console";

import { TenantBonusesClient } from "./tenant-bonuses-client";

export const metadata = {
  title: "Bonus Campaigns | DBAIRS Tenant Console",
  description:
    "Manage signup, deposit and first-deposit bonuses with claim windows and turnover requirements.",
};

export const instant = false;

/**
 * 商户后台【红利活动】。
 *
 * - 数据范围只有当前租户（loadTenantBonusCampaigns 内部带 tenantId）；
 * - currency 取 Tenant.currency（唯一事实来源），活动落库时快照到
 *   BonusCampaign.currency，事后改币种不重算历史奖励；
 * - 写操作走 /api/tenant/bonuses（POST）与 /api/tenant/bonuses/[id]（PATCH / DELETE），
 *   鉴权统一 guardTenantApi，tenantId 只取会话。
 */
export default async function TenantBonusesPage() {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/bonuses");
  }

  const [campaigns, tenant] = await Promise.all([
    loadTenantBonusCampaigns(scope.tenantId),
    prisma.tenant.findUnique({
      where: { id: scope.tenantId },
      select: { currency: true },
    }),
  ]);

  return (
    <TenantBonusesClient
      initialCampaigns={campaigns}
      tenantName={scope.tenant.name}
      currency={normalizeCurrency(tenant?.currency)}
    />
  );
}
