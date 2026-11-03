import { Prisma } from "@prisma/client";

import {
  normalizeThemeBackground,
  type ThemeBackgroundId,
} from "./theme-backgrounds";

export const tenantSelect = {
  id: true,
  name: true,
  domain: true,
  subdomain: true,
  status: true,
  withdrawalRequiredApprovals: true,
  createdAt: true,
} satisfies Prisma.TenantSelect;

/**
 * 开站 / 编辑弹窗要回填「主题背景色」，它存在 Tenant.layoutConfig 里，
 * 所以多读一个 JSON 字段。对外出口必须走 toTenantPayload()，
 * 把 layoutConfig 剥离成单个 themeBackground，避免整份装修配置外泄。
 */
export const tenantSelectWithLayout = {
  ...tenantSelect,
  layoutConfig: true,
} satisfies Prisma.TenantSelect;

export type TenantSelectRow = Prisma.TenantGetPayload<{
  select: typeof tenantSelectWithLayout;
}>;

/** 列表 / 详情统一的租户形状：layoutConfig → themeBackground（已归一化） */
export function toTenantPayload<T extends { layoutConfig: unknown }>(
  tenant: T,
): Omit<T, "layoutConfig"> & { themeBackground: ThemeBackgroundId } {
  const { layoutConfig, ...rest } = tenant;

  return {
    ...rest,
    // 脏数据 / 老租户缺字段 → 回落经典暗黑（= 改造前的大厅观感）
    themeBackground: normalizeThemeBackground(layoutConfig),
  };
}

export const TENANT_STATUSES = ["active", "trial", "suspended"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

// 域名允许用户粘贴完整 URL，入库前统一为小写 host。
export const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeTenantName(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

export function normalizeDomain(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

export function normalizeSubdomain(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\.$/, "")
    : "";
}

export function isTenantStatus(value: unknown): value is TenantStatus {
  return (
    typeof value === "string" &&
    (TENANT_STATUSES as readonly string[]).includes(value)
  );
}

export function parseWithdrawalApprovals(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") {
    return Number.NaN;
  }

  return Number(value);
}

export function isValidWithdrawalApprovals(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 3;
}
