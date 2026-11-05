import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console-shell";
import { getSessionUserFromCookies } from "@/lib/session";
import {
  getTenantScopeForUser,
  countTenantPendingDepositReviews,
  countTenantPendingWithdrawals,
} from "@/lib/tenant-console";

export const instant = false;

/**
 * 商户后台外壳。
 *
 * 进入方式只有两种（都不接受 URL 传入的 tenantId）：
 * 1. 商户账号本人：AdminUser.tenantId → 会话里的租户；
 * 2. 超管代登录：/api/admin/impersonation/start 下发 2 小时票据，
 *    此时页面顶部会显示醒目的「代登录模式」横幅与退出按钮。
 */
export default async function TenantLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user) {
    redirect("/login?next=/tenant");
  }

  const scope = await getTenantScopeForUser(user);

  if (!scope) {
    redirect("/admin");
  }

  // 侧边栏「提现审批」角标：真实待审批笔数，一次走索引的 count。
  const pendingWithdrawalCount = await countTenantPendingWithdrawals(
    scope.tenantId,
  );

  // 侧边栏「充值审核」角标：静态码 / 银行转账的待人工确认笔数。
  const pendingDepositCount = await countTenantPendingDepositReviews(
    scope.tenantId,
  );

  return (
    <ConsoleShell
      role="tenant_admin"
      username={user.username}
      tenantName={scope.tenant.name}
      // 【预览前台】跳 /?tenant=... 用的就是它：子域名优先，没配则用 id，
      // 这样无论本地还是线上都能精确锁定「当前这家」的前台。
      previewTenantKey={scope.tenant.subdomain || scope.tenant.id}
      impersonation={scope.impersonation}
      pendingWithdrawalCount={pendingWithdrawalCount}
      pendingDepositCount={pendingDepositCount}
    >
      {children}
    </ConsoleShell>
  );
}
