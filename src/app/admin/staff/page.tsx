import { redirect } from "next/navigation";
import { connection } from "next/server";

import { prisma } from "@/lib/prisma";
import { can, homePathForRole, STAFF_ROLES } from "@/lib/rbac";
import { getSessionUserFromCookies } from "@/lib/session";
import { serializeStaff, staffSelect } from "@/lib/staff-api";

import { StaffClient } from "./staff-client";
import type { StaffRow } from "./types";

export const metadata = {
  title: "Staff & Roles | DBAIRS Super Admin",
  description:
    "Create staff accounts and assign RBAC roles (super admin, finance, tech, support).",
};

export const instant = false;

export default async function AdminStaffPage() {
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user) {
    redirect("/login?next=/admin/staff");
  }

  // 第二道防线：proxy 已按权限矩阵拦截，这里再查一次数据库确认角色。
  if (!can(user.role, "staff")) {
    redirect(`${homePathForRole(user.role)}?denied=staff`);
  }

  const staff = await prisma.adminUser.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    // 枚举排序 = 定义顺序（super_admin → finance → tech → support）
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: staffSelect,
  });

  const rows: StaffRow[] = staff.map((member) => {
    const serialized = serializeStaff(member);

    return {
      id: serialized.id,
      username: serialized.username,
      role: serialized.role,
      createdAt: serialized.createdAt,
    };
  });

  return <StaffClient initialStaff={rows} currentUserId={user.id} />;
}
