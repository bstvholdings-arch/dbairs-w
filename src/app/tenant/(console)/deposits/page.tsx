import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  getTenantScopeFromCookies,
  loadTenantDepositReviewBoard,
} from "@/lib/tenant-console";

import { TenantDepositsView } from "./tenant-deposits-client";

export const metadata = {
  title: "Deposit Review | DBAIRS Tenant Console",
  description:
    "Manually confirm or reject static-QR and bank-transfer deposits: money that arrives in the merchant's own bank account never auto-credits.",
};

export const instant = false;

/**
 * 充值人工审核台（静态码 / 银行转账专用）。
 *
 * 第一屏就是「还有多少钱等着我核对」：待审单全部返回（只受 200 条上限保护），
 * 不让商户翻页才看到 —— 积压的直接原因就是入口太深 / 列表要翻页。
 * 已处理的单单独一张只读表，留给对账与追责。
 */
export default async function TenantDepositsPage() {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/deposits");
  }

  const board = await loadTenantDepositReviewBoard({
    tenantId: scope.tenantId,
  });

  return <TenantDepositsView tenantName={scope.tenant.name} board={board} />;
}
