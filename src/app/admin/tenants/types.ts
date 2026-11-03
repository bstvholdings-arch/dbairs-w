import type { TenantLogoPosition } from "@/lib/storefront";
import type { ThemeBackgroundId } from "@/lib/theme-backgrounds";

export const WITHDRAWAL_APPROVAL_OPTIONS = [1, 2, 3] as const;

/**
 * Logo 显示位置的可选项（大厅顶栏）。
 *
 * 用「单选卡片」而不是原生 <select>：卡片里能直接画出该位置的 Header 示意，
 * 超管一眼就知道选完长什么样；原生下拉还依赖浏览器弹层，容易「点了没反应」。
 */
export const LOGO_POSITION_OPTIONS = [
  {
    value: "left",
    labelKey: "tenants.form.logoPositionLeft",
    hintKey: "tenants.form.logoPositionLeftHint",
  },
  {
    value: "center",
    labelKey: "tenants.form.logoPositionCenter",
    hintKey: "tenants.form.logoPositionCenterHint",
  },
] as const satisfies ReadonlyArray<{
  value: TenantLogoPosition;
  labelKey: "tenants.form.logoPositionLeft" | "tenants.form.logoPositionCenter";
  hintKey:
    | "tenants.form.logoPositionLeftHint"
    | "tenants.form.logoPositionCenterHint";
}>;

export const TENANT_STATUS_OPTIONS = [
  { value: "active", labelKey: "tenant.status.active" },
  { value: "trial", labelKey: "tenant.status.trial" },
  { value: "suspended", labelKey: "tenant.status.suspended" },
] as const;
/** 租户管理员账号（tenant_admin）的只读摘要，用于列表展示。 */
export type TenantAdminBadge = {
  id: string;
  username: string;
  email: string | null;
};

export type TenantRow = {
  id: string;
  name: string;
  domain: string;
  subdomain: string;
  /** 多域名防封：备用域名池（0-5 条，管理员可在编辑弹窗里维护） */
  backupDomains: string[];
  /**
   * 品牌 Logo（Tenant.logoUrl，已校验）：玩家前台大厅 / 登录注册 / 玩家中心
   * 都渲染它，null = 未配置，前台自动用商户名首字母占位。
   * **只有超管能写** —— 上传入口就在本目录的租户弹窗里。
   */
  logoUrl: string | null;
  /**
   * Logo 在玩家大厅顶栏的位置（Tenant.logoPosition，已归一化）：
   * left = 左侧品牌区（默认）/ center = 屏幕正中央。
   * 与 logoUrl 同一权限口径：只有超管能在本弹窗里改。
   */
  logoPosition: TenantLogoPosition;
  status: string;
  withdrawalRequiredApprovals: number;
  /** 主题背景色（存在 Tenant.layoutConfig 里，前台大厅与品牌展馆共用） */
  themeBackground: ThemeBackgroundId;
  createdAt: string;
  admins: TenantAdminBadge[];
};

/**
 * 保存租户时顺带分配管理员账号的结果。
 * status = created 时 temporaryPassword 只返回这一次，页面必须提示「仅显示一次」。
 * emailSent / emailError 表示开通邮件是否投递成功（发信失败不影响账号创建）。
 */
export type TenantAdminProvisionInfo = {
  status: "created" | "exists" | "conflict" | "failed";
  username?: string;
  email?: string;
  temporaryPassword?: string;
  emailSent?: boolean;
  emailError?: string;
  message?: string;
};

export type TenantMutationResponse = {
  success?: boolean;
  tenant?: TenantRow;
  tenantAdmin?: TenantAdminProvisionInfo;
  error?: string;
};

export type TenantFormValues = {
  name: string;
  domain: string;
  subdomain: string;
  /**
   * 品牌 Logo（Tenant.logoUrl）。
   *
   * 超管在弹窗里点【上传 Logo】→ POST /api/admin/tenant-logos/upload →
   * 拿到 /api/tenant-logos/<uuid>.png 后回填到这里，提交时随租户一起落库。
   * 空字符串 = 不配 / 清空，玩家前台自动用商户名首字母占位。
   * **这是全系统唯一写入口**：商户后台没有任何上传或修改控件。
   */
  logoUrl: string;
  /**
   * Logo 显示位置（left / center）。
   *
   * 与 logoUrl 同一口径：只有超管在【新建 / 编辑租户】弹窗里能选，
   * 决定玩家大厅顶栏把**同一个** Logo 放在左侧还是屏幕正中央
   * （居中时左侧让位给菜单按钮、右侧放搜索 / 语言 / 余额）。
   */
  logoPosition: TenantLogoPosition;
  /**
   * 备用域名池（多域名防封自动切换），输入框里一行一个 / 逗号分隔。
   * 编辑器里保持字符串原样，提交时再走 readBackupDomainsInput 归一化成数组。
   */
  backupDomains: string;
  status: string;
  withdrawalRequiredApprovals: number;
  /**
   * 主题背景色（Theme Background Color，15 选 1）。
   * 只有超管在开站 / 编辑租户时能配：商户后台不提供自助切换，
   * 它决定大厅环境光与所有游戏卡片的外框 / 文字底板描边，
   * 永远是深色底（见 src/lib/theme-backgrounds.ts）。
   */
  themeBackground: ThemeBackgroundId;
  /**
   * 商户管理员邮箱（AdminUser.email，同时是登录账号）。
   * 新增租户时必填：后端用它创建 tenant_admin 账号并发送开通邮件；
   * 编辑时为「可选补建」，留空表示本次不创建账号。
   */
  adminEmail: string;
};
