import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console-shell";
import { getSessionUserFromCookies } from "@/lib/session";
import { getTenantScopeForUser } from "@/lib/tenant-console";

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

  return (
    <ConsoleShell
      role="tenant_admin"
      username={user.username}
      tenantName={scope.tenant.name}
      impersonation={scope.impersonation}
    >
      {children}
    </ConsoleShell>
  );
}
