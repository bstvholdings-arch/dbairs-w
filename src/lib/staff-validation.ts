import { isStaffRole, type StaffRole } from "./rbac";

/**
 * 员工账号的纯校验逻辑：不依赖 Prisma / next，前端弹窗与 Route Handler 共用，
 * 保证「前端提示」和「后端拒绝」用的是同一套规则。
 */

/** 3–32 位字母、数字、下划线、点、连字符。 */
export const STAFF_USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

/** 与 bcrypt 的有效长度对齐：超过 72 字节的部分会被静默丢弃，因此直接限制在上限内。 */
export const STAFF_PASSWORD_MIN_LENGTH = 8;
export const STAFF_PASSWORD_MAX_LENGTH = 72;

/** 读取用户名：返回 trim 后的值；格式非法返回空字符串。 */
export function readStaffUsername(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const username = value.trim();

  return STAFF_USERNAME_PATTERN.test(username) ? username : "";
}

/** 读取密码：不符合长度要求返回空字符串（调用方按「必填/可选」决定提示语）。 */
export function readStaffPassword(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  if (
    value.length < STAFF_PASSWORD_MIN_LENGTH ||
    value.length > STAFF_PASSWORD_MAX_LENGTH
  ) {
    return "";
  }

  return value;
}

/** 读取角色：只接受平台员工角色（不允许通过接口创建 tenant_admin）。 */
export function readStaffRole(value: unknown): StaffRole | null {
  if (typeof value !== "string") {
    return null;
  }

  return isStaffRole(value) ? value : null;
}
