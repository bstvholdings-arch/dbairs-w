import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console-shell";
import { isStaffRole } from "@/lib/rbac";
import { getSessionUserFromCookies } from "@/lib/session";

export const instant = false;

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user) {
    redirect("/login?next=/admin");
  }

  // 平台后台只给平台员工（super_admin / finance / tech / support），
  // 租户老板走 /tenant；具体页面权限由 proxy + 页面内二次校验控制。
  if (!isStaffRole(user.role)) {
    redirect("/tenant");
  }

  return (
    <ConsoleShell role={user.role} username={user.username}>
      {children}
    </ConsoleShell>
  );
}

