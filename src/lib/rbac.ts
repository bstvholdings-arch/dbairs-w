/**
 * RBAC（基于角色的权限控制）单点定义。
 *
 * 设计约定：
 * 1. 唯一事实来源：角色 → 权限（ROLE_PERMISSIONS）、权限 → 页面 / 接口（PAGE_ACCESS_RULES / API_ACCESS_RULES）。
 *    左侧菜单、proxy 路由拦截、API 路由复核、页面二次校验全部读这一份矩阵，
 *    避免「三个地方各写一套规则」导致菜单隐藏了但接口还能调。
 * 2. 本文件不 import Prisma / next/*，因此可以被 Edge 运行时的 proxy 直接引用。
 * 3. 权限粒度是「业务域」而不是 HTTP 方法：同一业务域的读写细分放在具体路由里。
 */

/** 平台员工角色（可以在 /admin 后台登录，tenantId 为空）。 */
export const STAFF_ROLES = ["super_admin", "finance", "tech", "support"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** 租户老板角色：只能进 /tenant 控制台，看不到平台后台。 */
export const TENANT_ROLE = "tenant_admin";

export type AdminRole = StaffRole | typeof TENANT_ROLE;

/** 全部权限点。新增后台模块时：先加权限点，再补下面两张路径表。 */
export const PERMISSIONS = [
  "dashboard",
  "tenants",
  "providers",
  "games",
  "storefront",
  "payments",
  "finance",
  "withdrawals",
  "aiSettings",
  "aiLogs",
  "aiConsole",
  "staff",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * 角色 → 权限矩阵。
 *
 * - super_admin：平台全部权限（含员工管理）
 * - finance    ：数据大盘 + 财务对账 + 出金审批
 * - tech       ：游戏商 / 游戏库技术配置 + AI 日志（只读）
 * - support    ：客服，仅数据大盘
 * - tenant_admin：只有租户侧的财务对账，其余平台权限一律没有
 *
 * aiConsole 是「AI 中控台」（含战败分析看板），默认只有 super_admin 拥有；
 * 看板里的线索联系方式属于敏感数据，不要下放给 finance / tech / support。
 */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  finance: ["dashboard", "finance", "withdrawals"],
  tech: ["providers", "aiLogs"],
  support: ["dashboard"],
  tenant_admin: ["finance"],
};

/** 各角色登录后的默认落地页（必须是该角色有权访问的页面，否则会循环重定向）。 */
export const ROLE_HOME_PATH: Record<AdminRole, string> = {
  super_admin: "/admin",
  finance: "/admin",
  tech: "/admin/providers",
  support: "/admin",
  tenant_admin: "/tenant",
};

/** 页面路径 → 权限。命中规则为「最长前缀优先」。 */
export const PAGE_ACCESS_RULES: readonly { path: string; permission: Permission }[] = [
  { path: "/admin", permission: "dashboard" },
  { path: "/admin/tenants", permission: "tenants" },
  { path: "/admin/providers", permission: "providers" },
  { path: "/admin/games", permission: "games" },
  { path: "/admin/storefront", permission: "storefront" },
  { path: "/admin/payments", permission: "payments" },
  { path: "/admin/finance", permission: "finance" },
  { path: "/admin/staff", permission: "staff" },
  { path: "/admin/ai-logs", permission: "aiLogs" },
  { path: "/admin/ai-console", permission: "aiConsole" },
  { path: "/finance", permission: "finance" },
  // 旧路径（proxy 会 301 到 /admin/*，这里同样先做权限判断，避免先跳转再被拦）
  { path: "/providers", permission: "providers" },
  { path: "/tenants", permission: "tenants" },
];

/** 接口路径 → 权限。命中规则为「最长前缀优先」。 */
export const API_ACCESS_RULES: readonly { path: string; permission: Permission }[] = [
  { path: "/api/admin/staff", permission: "staff" },
  { path: "/api/admin/tenants", permission: "tenants" },
  { path: "/api/tenants", permission: "tenants" },
  { path: "/api/admin/providers", permission: "providers" },
  { path: "/api/providers", permission: "providers" },
  { path: "/api/admin/games", permission: "games" },
  { path: "/api/admin/storefront", permission: "storefront" },
  { path: "/api/admin/gateways", permission: "payments" },
  // 出金审批：财务与超管可调用，其它角色一律 403
  { path: "/api/admin/withdrawals", permission: "withdrawals" },
  // AI 设置只有超管能改；AI 日志技术可读
  { path: "/api/admin/ai-settings", permission: "aiSettings" },
  { path: "/api/admin/ai-agents", permission: "aiSettings" },
  { path: "/api/admin/ai-logs", permission: "aiLogs" },
  // AI 中控台（销冠对话 + 战败分析）：/api/ai/log 例外，由 proxy 前置放行并在路由内
  // 校验 AI_LOG_TOKEN / 超管 Cookie（外部销售机器人没有管理员 Cookie）。
  { path: "/api/ai/chat", permission: "aiConsole" },
  { path: "/api/ai/leads", permission: "aiConsole" },
  { path: "/api/ai/tactics", permission: "aiConsole" },
  { path: "/api/ai/prompt", permission: "aiConsole" },
];

/** 租户侧接口前缀：只允许 tenant_admin 调用（在 proxy 里单独判断）。 */
export const TENANT_API_PREFIX = "/api/tenant";

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

export function isAdminRole(value: string): value is AdminRole {
  return value === TENANT_ROLE || isStaffRole(value);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** 角色是否有某个权限。未知角色一律返回 false（默认拒绝）。 */
export function can(role: string, permission: Permission): boolean {
  if (!isAdminRole(role)) {
    return false;
  }

  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: AdminRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function homePathForRole(role: AdminRole): string {
  return ROLE_HOME_PATH[role];
}

/** 路径是否命中某条规则（等于该路径，或在它下面）。 */
function matchesPath(pathname: string, rulePath: string) {
  return pathname === rulePath || pathname.startsWith(`${rulePath}/`);
}

function resolveRule(
  pathname: string,
  rules: readonly { path: string; permission: Permission }[],
): Permission | null {
  let matched: { path: string; permission: Permission } | null = null;

  for (const rule of rules) {
    if (!matchesPath(pathname, rule.path)) {
      continue;
    }

    if (!matched || rule.path.length > matched.path.length) {
      matched = rule;
    }
  }

  return matched?.permission ?? null;
}

/** 页面需要什么权限；未登记的后台路径返回 null（放行，由页面自身决定）。 */
export function permissionForPage(pathname: string): Permission | null {
  return resolveRule(pathname, PAGE_ACCESS_RULES);
}

/** 接口需要什么权限；未登记的接口返回 null。 */
export function permissionForApi(pathname: string): Permission | null {
  return resolveRule(pathname, API_ACCESS_RULES);
}

export function isTenantApiPath(pathname: string): boolean {
  return pathname === TENANT_API_PREFIX || pathname.startsWith(`${TENANT_API_PREFIX}/`);
}

export function isTenantPagePath(pathname: string): boolean {
  return pathname === "/tenant" || pathname.startsWith("/tenant/");
}
