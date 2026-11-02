import type { GameCardStyleId } from "@/lib/game-card-styles";

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
  status: string;
  withdrawalRequiredApprovals: number;
  /** 游戏封面风格（存在 Tenant.layoutConfig 里，前台大厅与品牌展馆共用） */
  gameCardStyle: GameCardStyleId;
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
  status: string;
  withdrawalRequiredApprovals: number;
  /**
   * 游戏封面风格（Game Card Cover Style）。
   * 只有超管在开站 / 编辑租户时能配：商户后台不提供自助切换，
   * 风格决定大厅与品牌展馆的卡片视觉（见 src/lib/game-card-styles.ts）。
   */
  gameCardStyle: GameCardStyleId;
  /**
   * 商户管理员邮箱（AdminUser.email，同时是登录账号）。
   * 新增租户时必填：后端用它创建 tenant_admin 账号并发送开通邮件；
   * 编辑时为「可选补建」，留空表示本次不创建账号。
   */
  adminEmail: string;
};
