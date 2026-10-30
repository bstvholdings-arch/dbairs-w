import type { TranslationKey } from "./i18n-types";
import type { AdminRole, Permission, StaffRole } from "./rbac";
import type { GatewayBankDetails } from "./payment-gateway-bank";
import type {
  GatewayProviderType,
  GatewayReviewStatusValue,
  GatewayTypeValue,
} from "./payment-gateway-constants";
import type { LobbyCategoryFilter } from "./lobby-games";
import type { GatewayRateService } from "./payment-gateway-rates";

/**
 * 常量层只保存业务值，展示文案统一从这里映射到词典，
 * 避免把某一种语言写死进共享校验 / 选项定义。
 */
export const GATEWAY_PROVIDER_LABEL_KEYS = {
  usdt_trc20: "gateway.provider.usdt_trc20",
  usdt_erc20: "gateway.provider.usdt_erc20",
  tng: "gateway.provider.tng",
  duitnow: "gateway.provider.duitnow",
  sepa: "gateway.provider.sepa",
  payid: "gateway.provider.payid",
  swift: "gateway.provider.swift",
  bank_transfer: "gateway.provider.bank_transfer",
  other: "gateway.provider.other",
} as const satisfies Record<GatewayProviderType, TranslationKey>;

export const GATEWAY_PAYMENT_TYPE_LABEL_KEYS = {
  REDIRECT_URL: "gateway.type.REDIRECT_URL",
  DYNAMIC_QR: "gateway.type.DYNAMIC_QR",
  STATIC_QR: "gateway.type.STATIC_QR",
  BANK_TRANSFER: "gateway.type.BANK_TRANSFER",
} as const satisfies Record<GatewayTypeValue, TranslationKey>;

export const GATEWAY_PAYMENT_TYPE_HINT_KEYS = {
  REDIRECT_URL: "gateway.typeHint.REDIRECT_URL",
  DYNAMIC_QR: "gateway.typeHint.DYNAMIC_QR",
  STATIC_QR: "gateway.typeHint.STATIC_QR",
  BANK_TRANSFER: "gateway.typeHint.BANK_TRANSFER",
} as const satisfies Record<GatewayTypeValue, TranslationKey>;

export const GATEWAY_REVIEW_STATUS_KEYS = {
  PENDING: "gateway.review.PENDING",
  APPROVED: "gateway.review.APPROVED",
  REJECTED: "gateway.review.REJECTED",
} as const satisfies Record<GatewayReviewStatusValue, TranslationKey>;

export const GATEWAY_SOURCE_KEYS = {
  platform: "gateway.source.platform",
  tenant: "gateway.source.tenant",
} as const satisfies Record<"platform" | "tenant", TranslationKey>;

export const TENANT_STATUS_LABEL_KEYS = {
  active: "tenant.status.active",
  trial: "tenant.status.trial",
  suspended: "tenant.status.suspended",
} as const satisfies Record<string, TranslationKey>;

export const GATEWAY_RATE_SERVICE_LABEL_KEYS = {
  payin: "gateway.rateService.payin.label",
  payout: "gateway.rateService.payout.label",
  settlement: "gateway.rateService.settlement.label",
} as const satisfies Record<GatewayRateService["key"], TranslationKey>;

export const GATEWAY_RATE_SERVICE_DESCRIPTION_KEYS = {
  payin: "gateway.rateService.payin.description",
  payout: "gateway.rateService.payout.description",
  settlement: "gateway.rateService.settlement.description",
} as const satisfies Record<GatewayRateService["key"], TranslationKey>;

export const GATEWAY_BANK_FIELD_LABEL_KEYS = {
  accountName: "gateway.bank.accountName",
  accountNumber: "gateway.bank.accountNumber",
  bankName: "gateway.bank.bankName",
  swiftCode: "gateway.bank.swiftCode",
  iban: "gateway.bank.iban",
  payId: "gateway.bank.payId",
  routingNumber: "gateway.bank.routingNumber",
  reference: "gateway.bank.reference",
  instructions: "gateway.bank.instructions",
} as const satisfies Record<keyof GatewayBankDetails, TranslationKey>;

export const GATEWAY_BANK_FIELD_PLACEHOLDER_KEYS = {
  accountName: "gateway.bank.accountNamePlaceholder",
  accountNumber: "gateway.bank.accountNumberPlaceholder",
  bankName: "gateway.bank.bankNamePlaceholder",
  swiftCode: "gateway.bank.swiftCodePlaceholder",
  iban: "gateway.bank.ibanPlaceholder",
  payId: "gateway.bank.payIdPlaceholder",
  routingNumber: "gateway.bank.routingNumberPlaceholder",
  reference: "gateway.bank.referencePlaceholder",
  instructions: "gateway.bank.instructionsPlaceholder",
} as const satisfies Record<keyof GatewayBankDetails, TranslationKey>;

/** 共享校验函数目前返回中文；展示前映射为词典 key。 */
export const GATEWAY_QR_ERROR_KEYS = {
  "二维码图片过大，请上传小于 1.2MB 的图片": "gateway.validation.qrTooLarge",
  "图片 Data URL 格式不正确，仅支持 PNG / JPG / WebP / GIF":
    "gateway.validation.qrDataInvalid",
  "二维码图片链接不能超过 2048 个字符": "gateway.validation.qrUrlTooLong",
  "二维码图片链接只支持 http / https": "gateway.validation.qrProtocol",
  "二维码图片必须是有效的 http/https 链接，或直接上传图片":
    "gateway.validation.qrInvalid",
} as const satisfies Record<string, TranslationKey>;

export const LOGIN_ERROR_KEYS = {
  "账号和密码不能为空": "login.error.empty",
  "账号或密码错误": "login.error.invalidCredentials",
  "服务器内部错误": "login.error.server",
  "请求体格式错误": "login.error.fallback",
} as const satisfies Record<string, TranslationKey>;

/** 玩家大厅分类文案，值域与 lobby-games.ts 的 LobbyCategoryFilter 保持一致。 */
export const LOBBY_CATEGORY_LABEL_KEYS = {
  all: "lobby.category.all",
  hot: "lobby.category.hot",
  slot: "lobby.category.slot",
  live: "lobby.category.live",
  sport: "lobby.category.sport",
  poker: "lobby.category.poker",
  fish: "lobby.category.fish",
  esport: "lobby.category.esport",
  cockfight: "lobby.category.cockfight",
} as const satisfies Record<LobbyCategoryFilter, TranslationKey>;

/** 后台外壳里显示在左上角的角色标识（SUPER ADMIN / FINANCE …）。 */
export const ADMIN_ROLE_LABEL_KEYS = {
  super_admin: "shell.role.superAdmin",
  finance: "shell.role.finance",
  tech: "shell.role.tech",
  support: "shell.role.support",
  tenant_admin: "shell.role.tenant",
} as const satisfies Record<AdminRole, TranslationKey>;

/** 员工管理页里选择角色用的名称。 */
export const STAFF_ROLE_LABEL_KEYS = {
  super_admin: "rbac.role.super_admin",
  finance: "rbac.role.finance",
  tech: "rbac.role.tech",
  support: "rbac.role.support",
} as const satisfies Record<StaffRole, TranslationKey>;

/** 员工管理页里每个角色的一句话说明。 */
export const STAFF_ROLE_HINT_KEYS = {
  super_admin: "rbac.roleHint.super_admin",
  finance: "rbac.roleHint.finance",
  tech: "rbac.roleHint.tech",
  support: "rbac.roleHint.support",
} as const satisfies Record<StaffRole, TranslationKey>;

/** 权限点 → 文案，用于「无权限」提示与权限矩阵展示。 */
export const PERMISSION_LABEL_KEYS = {
  dashboard: "rbac.permission.dashboard",
  tenants: "rbac.permission.tenants",
  providers: "rbac.permission.providers",
  games: "rbac.permission.games",
  storefront: "rbac.permission.storefront",
  payments: "rbac.permission.payments",
  finance: "rbac.permission.finance",
  withdrawals: "rbac.permission.withdrawals",
  aiSettings: "rbac.permission.aiSettings",
  aiLogs: "rbac.permission.aiLogs",
  staff: "rbac.permission.staff",
} as const satisfies Record<Permission, TranslationKey>;


/** 角色全称（含租户老板），用于提示条里说明「当前角色」。 */
export const RBAC_ROLE_NAME_KEYS = {
  super_admin: "rbac.role.super_admin",
  finance: "rbac.role.finance",
  tech: "rbac.role.tech",
  support: "rbac.role.support",
  tenant_admin: "rbac.role.tenant_admin",
} as const satisfies Record<AdminRole, TranslationKey>;

