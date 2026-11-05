import { redirect } from "next/navigation";
import { connection } from "next/server";

import { loadTenantPayoutEngine } from "@/lib/auto-payout";
import {
  getTenantScopeFromCookies,
  loadTenantWithdrawalBoard,
} from "@/lib/tenant-console";

import { TenantWithdrawalsView } from "./tenant-withdrawals-client";

export const metadata = {
  title: "Withdrawals | DBAIRS Tenant Console",
  description:
    "Approve or reject pending withdrawal requests, and configure the auto payout engine for the current tenant.",
};

export const instant = false;

/**
 * 提现审批台 + 自动出款引擎配置。
 *
 * 第一屏就是「还有多少笔钱等着出款」：待审批单全部返回（只受 200 条上限保护），
 * 不让商户翻页才看到 —— 积压的直接原因就是入口太深 / 列表要翻页。
 * 自动出款在途（processing）单独一张表：看得见，但在结果返回前不给人工按钮，
 * 避免「自动打一次 + 人工再打一次」。
 */
export default async function TenantWithdrawalsPage() {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/withdrawals");
  }

  const [board, engine] = await Promise.all([
    loadTenantWithdrawalBoard({ tenantId: scope.tenantId }),
    loadTenantPayoutEngine(scope.tenantId),
  ]);

  return (
    <TenantWithdrawalsView
      tenantName={scope.tenant.name}
      board={board}
      engine={engine}
    />
  );
}
