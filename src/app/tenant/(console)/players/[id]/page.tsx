import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import {
  getTenantScopeFromCookies,
  loadTenantPlayerDetail,
} from "@/lib/tenant-console";

import { TenantPlayerDetailView } from "./tenant-player-detail-client";

export const metadata = {
  title: "Player Details | DBAIRS Tenant Console",
  description:
    "Player profile, balances and support history for the current tenant.",
};

export const instant = false;

/**
 * 玩家详情。
 *
 * loadTenantPlayerDetail 用 { id, tenantId } 双条件查询：
 * 别的商户的玩家 id 在这里等于「不存在」，直接 404，不泄露任何信息。
 */
export default async function TenantPlayerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/players");
  }

  const { id } = await params;
  const player = await loadTenantPlayerDetail({
    tenantId: scope.tenantId,
    playerId: id,
  });

  if (!player) {
    notFound();
  }

  return <TenantPlayerDetailView player={player} />;
}
