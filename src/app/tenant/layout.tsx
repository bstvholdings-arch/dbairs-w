import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console-shell";
import { getSessionUserFromCookies } from "@/lib/session";

export const instant = false;

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

  if (user.role !== "tenant_admin" || !user.tenant) {
    redirect("/admin");
  }

  return (
    <ConsoleShell
      role="tenant_admin"
      username={user.username}
      tenantName={user.tenant.name}
    >
      {children}
    </ConsoleShell>
  );
}
