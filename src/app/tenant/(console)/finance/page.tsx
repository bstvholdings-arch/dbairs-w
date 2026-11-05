import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  countTenantPendingWithdrawals,
  getTenantScopeFromCookies,
  isTenantFinanceKind,
  loadTenantFinance,
} from "@/lib/tenant-console";

import { TenantFinanceView } from "./tenant-finance-client";

export const metadata = {
  title: "Finance | DBAIRS Tenant Console",
  description:
    "Read-only deposit and withdrawal ledger for the current tenant.",
};

export const instant = false;

/**
 * 商户财务流水（只读）。
 *
 * kind 只决定看「入金」还是「出金」，tenantId 仍取会话；
 * 列表与汇总卡片共用同一条 where，避免「列表隔离了、汇总却是全平台」。
 */
export default async function TenantFinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/finance");
  }

  const params = await searchParams;
  const kind = isTenantFinanceKind(params.kind) ? params.kind : "deposit";
  const page = typeof params.page === "string" ? params.page : "1";

  const data = await loadTenantFinance({
    tenantId: scope.tenantId,
    kind,
    page,
  });
  // 待审批笔数：本页只做提示 + 跳转，真正的审批在 /tenant/withdrawals
  const pendingWithdrawalCount = await countTenantPendingWithdrawals(
    scope.tenantId,
  );

  return (
    <TenantFinanceView
      tenantName={scope.tenant.name}
      data={data}
      pendingWithdrawalCount={pendingWithdrawalCount}
    />
  );
}
