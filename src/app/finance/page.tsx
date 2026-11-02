import { redirect } from "next/navigation";
import { connection } from "next/server";

import { ConsoleShell } from "@/components/console-shell";
import { getMonthlyFinanceSummary } from "@/lib/finance-summary";
import { toNumber } from "@/lib/format";
import { formatGatewayRatePercent } from "@/lib/payment-gateway-rates";
import { can, homePathForRole, TENANT_ROLE } from "@/lib/rbac";
import { getSessionUserFromCookies } from "@/lib/session";

import { FinanceView } from "./finance-client";

export const metadata = {
  title: "Finance Reconciliation | DBAIRS",
  description:
    "Monthly reconciliation for deposits, withdrawals, payment spread profit, GGR, and platform fees.",
};

export const instant = false;

export default async function FinancePage() {
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user) {
    redirect("/login?next=/finance");
  }

  // 第二道防线：proxy 已按权限矩阵拦截，这里再查一次数据库确认角色。
  if (!can(user.role, "finance")) {
    redirect(`${homePathForRole(user.role)}?denied=finance`);
  }

  const isTenantScope = user.role === TENANT_ROLE;

  if (isTenantScope && !user.tenantId) {
    redirect("/login?next=/finance");
  }

  // 平台员工（super_admin / finance）看全平台汇总；租户老板只看自己租户。
  const summary = await getMonthlyFinanceSummary({
    tenantId: isTenantScope ? (user.tenantId ?? undefined) : undefined,
  });
  const paymentSpreadLabel = formatGatewayRatePercent(
    summary.paymentSpreadRate,
    1,
  );

  return (
    <ConsoleShell
      role={user.role}
      username={user.username}
      tenantName={user.tenant?.name}
    >
      <FinanceView
        isPlatformScope={!isTenantScope}
        tenantName={user.tenant?.name}
        paymentSpreadLabel={paymentSpreadLabel}
        monthStart={summary.monthStart.toISOString()}
        monthEnd={summary.monthEnd.toISOString()}
        totals={{
          deposit: toNumber(summary.totals.deposit),
          withdraw: toNumber(summary.totals.withdraw),
          payinProfit: toNumber(summary.totals.payinProfit),
          payoutProfit: toNumber(summary.totals.payoutProfit),
          paymentProfit: toNumber(summary.totals.paymentProfit),
          ggr: toNumber(summary.totals.ggr),
          platformFee: toNumber(summary.totals.platformFee),
        }}
        tenantRows={summary.tenantRows.map((row) => ({
          tenantId: row.tenantId,
          tenantName: row.tenantName,
          deposit: toNumber(row.deposit),
          withdraw: toNumber(row.withdraw),
          payinProfit: toNumber(row.payinProfit),
          payoutProfit: toNumber(row.payoutProfit),
          paymentProfit: toNumber(row.paymentProfit),
          ggr: toNumber(row.ggr),
          platformFee: toNumber(row.platformFee),
        }))}
        recentDeposits={summary.recentDeposits.map((deposit) => ({
          id: deposit.id,
          amount: toNumber(deposit.amount),
          currency: deposit.currency,
          createdAt: deposit.createdAt.toISOString(),
          txHash: deposit.txHash,
          tenantName: deposit.tenantName,
          playerUsername: deposit.playerUsername,
          gatewayName: deposit.gatewayName,
        }))}
      />
    </ConsoleShell>
  );
}
