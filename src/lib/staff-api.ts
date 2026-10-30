import { Prisma } from "@prisma/client";

import { isStaffRole } from "./rbac";

/**
 * 员工账号接口的统一查询字段与序列化逻辑。
 * 纯校验规则（用户名 / 密码）放在 staff-validation.ts，避免 Prisma 被打进前端包。
 */
export const staffSelect = {
  id: true,
  username: true,
  role: true,
  createdAt: true,
} satisfies Prisma.AdminUserSelect;

export type StaffRecord = Prisma.AdminUserGetPayload<{
  select: typeof staffSelect;
}>;

export function serializeStaff(member: StaffRecord) {
  return {
    id: member.id,
    username: member.username,
    // 查询都是按 STAFF_ROLES 过滤的；这里再兜一层，避免 tenant_admin 混进员工列表。
    role: isStaffRole(member.role) ? member.role : ("support" as const),
    createdAt: member.createdAt.toISOString(),
  };
}
