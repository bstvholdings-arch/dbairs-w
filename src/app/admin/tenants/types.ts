import type { ThemeBackgroundId } from "@/lib/theme-backgrounds";

export const WITHDRAWAL_APPROVAL_OPTIONS = [1, 2, 3] as const;

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
