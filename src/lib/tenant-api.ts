import { Prisma } from "@prisma/client";

import {
  normalizeThemeBackground,
  type ThemeBackgroundId,
} from "./theme-backgrounds";
import {
  normalizeTenantLogoPosition,
  type TenantLogoPosition,
} from "./storefront";
import {
  DOMAIN_PATTERN,
  SUBDOMAIN_PATTERN,
  normalizeDomain,
  normalizeSubdomain,
} from "./tenant-domains";

export {
  DOMAIN_PATTERN,
  SUBDOMAIN_PATTERN,
  normalizeDomain,
  normalizeSubdomain,
};

export const tenantSelect = {
  id: true,
  name: true,
  domain: true,
  subdomain: true,
  // 多域名池：超管编辑弹窗与商户设置页都要回填（见 lib/tenant-domains.ts）
  backupDomains: true,
  /**
   * 品牌 Logo（白标）：前台大厅 / 登录注册 / 玩家中心都渲染它，没配则用商户名
   * 首字母占位。**只有超管能写**（/api/tenants 与 /api/tenants/[id]），
   * 商户后台只读甚至看不到入口（见 AGENTS.md「品牌 Logo」）。
   */
  logoUrl: true,
  /**
   * Logo 在玩家大厅顶栏的位置（left / center）。
   * 与 logoUrl 同一权限口径：只有超管能写，商户后台只读。
   */
  logoPosition: true,
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

/**
 * 列表 / 详情统一的租户形状：layoutConfig → themeBackground（已归一化），
 * logoPosition 同样归一化（脏数据 / 老数据回落 left）。
 */
export function toTenantPayload<
  T extends {
    layoutConfig: unknown;
    logoPosition: string;
  },
>(tenant: T): Omit<T, "layoutConfig" | "logoPosition"> & {
  themeBackground: ThemeBackgroundId;
  logoPosition: TenantLogoPosition;
} {
  const { layoutConfig, logoPosition, ...rest } = tenant;

  return {
    ...rest,
    // 脏数据 / 老租户缺字段 → 回落经典暗黑（= 改造前的大厅观感）
    themeBackground: normalizeThemeBackground(layoutConfig),
    // 认不出来的位置一律当「左侧」（= 改造前的排版）
    logoPosition: normalizeTenantLogoPosition(logoPosition),
  };
}

export const TENANT_STATUSES = ["active", "trial", "suspended"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

// 域名 / 子域名的归一化与合法性统一收在 lib/tenant-domains.ts，
// 这里只做 re-export（后台弹窗、商户设置页、接口校验共用同一份规则）。

export function normalizeTenantName(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
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
