import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  getTenantScopeFromCookies,
  isTenantPlayerStatus,
  searchTenantPlayers,
} from "@/lib/tenant-console";

import { TenantPlayersView } from "./tenant-players-client";

export const metadata = {
  title: "My Players | DBAIRS Tenant Console",
  description:
    "Search, inspect, ban and unban players that belong to the current tenant.",
};

export const instant = false;

/**
 * 商户玩家管理。
 *
 * q / status / page 只影响筛选条件；tenantId 固定取会话，
 * 所以改 URL 参数也无法看到别的商户的玩家。
 */
export default async function TenantPlayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/players");
  }

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const status =
    typeof params.status === "string" && isTenantPlayerStatus(params.status)
      ? params.status
      : "";
  const page = typeof params.page === "string" ? params.page : "1";

  const data = await searchTenantPlayers({
    tenantId: scope.tenantId,
    q,
    status,
    page,
  });

  return (
    <TenantPlayersView
      tenantName={scope.tenant.name}
      data={data}
      query={{ q, status }}
    />
  );
}
