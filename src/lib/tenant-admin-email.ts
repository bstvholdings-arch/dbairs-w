/**
 * 商户管理员邮箱的共享校验。
 *
 * 刻意不 import prisma / next/*：客户端组件（/admin/tenants 弹窗）与服务端
 * 接口（/api/tenants、/api/tenants/[id]）必须用同一套规则，
 * 否则会出现「前端放行、后端 400」的割裂体验。
 * 真正建号逻辑在 src/lib/tenant-admin-account.ts。
 */

export const TENANT_ADMIN_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const TENANT_ADMIN_EMAIL_MAX_LENGTH = 120;

/**
 * 读取管理员邮箱：返回 ""（未填写）、规范化后的小写邮箱，或 null（格式非法）。
 */
export function readTenantAdminEmail(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  if (!email) {
    return "";
  }

  if (email.length > TENANT_ADMIN_EMAIL_MAX_LENGTH) {
    return null;
  }

  return TENANT_ADMIN_EMAIL_PATTERN.test(email) ? email : null;
}

/** 客户端表单用的布尔校验（空字符串返回 false）。 */
export function isValidTenantAdminEmail(value: string): boolean {
  return readTenantAdminEmail(value) !== null && value.trim().length > 0;
}
