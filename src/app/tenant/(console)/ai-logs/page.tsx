import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  getTenantScopeFromCookies,
  loadTenantAiLogs,
} from "@/lib/tenant-console";

import { TenantAiLogsView } from "./tenant-ai-logs-client";

export const metadata = {
  title: "AI Support Chats | DBAIRS Tenant Console",
  description:
    "AI support conversations between this tenant's players and the assistant.",
};

export const instant = false;

/**
 * 商户 AI 客服监控（只读）。
 *
 * 查询条件固定包含 agentType=support 与 tenantId，
 * 平台侧（tenantId 为空）的招商 / 技术助手日志永远查不到。
 */
export default async function TenantAiLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/ai-logs");
  }

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const playerId = typeof params.playerId === "string" ? params.playerId : "";
  const page = typeof params.page === "string" ? params.page : "1";

  const data = await loadTenantAiLogs({
    tenantId: scope.tenantId,
    q,
    playerId,
    page,
  });

  return (
    <TenantAiLogsView
      tenantName={scope.tenant.name}
      data={data}
      query={{ q, playerId }}
    />
  );
}
