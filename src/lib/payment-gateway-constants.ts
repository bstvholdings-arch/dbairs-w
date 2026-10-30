export const GATEWAY_PROVIDER_TYPES = [
  "usdt_trc20",
  "usdt_erc20",
  "tng",
  "duitnow",
  "sepa",
  "payid",
  "swift",
  "bank_transfer",
  "other",
] as const;

export type GatewayProviderType = (typeof GATEWAY_PROVIDER_TYPES)[number];

export const GATEWAY_PROVIDER_TYPE_LABELS: Record<GatewayProviderType, string> = {
  usdt_trc20: "USDT-TRC20",
  usdt_erc20: "USDT-ERC20",
  tng: "Touch'n Go eWallet",
  sepa: "SEPA 欧元转账",
  payid: "PayID（澳洲）",
  swift: "SWIFT 国际电汇",

  duitnow: "DuitNow QR",
  bank_transfer: "银行转账（通用）",
  other: "其他通道",
};


/**
 * 支付形态与支付商解耦：
 * - REDIRECT_URL: 跳转支付商 / 网银；
 * - DYNAMIC_QR: 前端生成二维码（USDT 钱包地址或支付链接）；
 * - STATIC_QR: 直接展示商户上传的收款图片；
 * - BANK_TRANSFER: 展示银行账号、SWIFT、IBAN、PayID 等文本。
 */
export const GATEWAY_TYPES = [
  "REDIRECT_URL",
  "DYNAMIC_QR",
  "STATIC_QR",
  "BANK_TRANSFER",
] as const;

export type GatewayTypeValue = (typeof GATEWAY_TYPES)[number];

export const GATEWAY_TYPE_LABELS: Record<GatewayTypeValue, string> = {
  REDIRECT_URL: "跳转网银 / 托管支付",
  DYNAMIC_QR: "动态二维码",
  STATIC_QR: "静态收款图",
  BANK_TRANSFER: "银行转账（显示账户信息）",
};

export const GATEWAY_TYPE_HINTS: Record<GatewayTypeValue, string> = {
  REDIRECT_URL: "玩家创建订单后自动跳转到支付商收银台。",
  DYNAMIC_QR: "前端根据钱包地址或支付链接实时生成二维码。",
  STATIC_QR: "玩家直接扫码付款，适合 TNG / DuitNow 等静态收款码。",
  BANK_TRANSFER: "玩家复制银行账号、户名、SWIFT/BIC、IBAN 或 PayID 后线下转账。",
};

export function isGatewayType(value: unknown): value is GatewayTypeValue {
  return (
    typeof value === "string" &&
    (GATEWAY_TYPES as readonly string[]).includes(value)
  );
}

export function defaultGatewayTypeForProvider(
  providerType: string,
): GatewayTypeValue {
  if (providerType.startsWith("usdt_")) {
    return "DYNAMIC_QR";
  }

  if (providerType === "tng" || providerType === "duitnow") {
    return "STATIC_QR";
  }

  if (
    providerType === "sepa" ||
    providerType === "payid" ||
    providerType === "swift" ||
    providerType === "bank_transfer"
  ) {
    return "BANK_TRANSFER";
  }

  return "DYNAMIC_QR";
}

export function defaultGatewayCurrencyForProvider(providerType: string) {
  if (providerType.startsWith("usdt_")) {
    return "USDT";
  }

  switch (providerType) {
    case "tng":
    case "duitnow":
      return "MYR";
    case "sepa":
      return "EUR";
    case "payid":
      return "AUD";
    case "swift":
    case "bank_transfer":
      return "USD";
    default:
      return "USD";
  }
}

/**
 * 平台网关直接由超管维护，默认已通过；租户自有网关必须先审核。
 */
export const GATEWAY_REVIEW_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

export type GatewayReviewStatusValue =
  (typeof GATEWAY_REVIEW_STATUSES)[number];

export const GATEWAY_REVIEW_STATUS_LABELS: Record<
  GatewayReviewStatusValue,
  string
> = {
  PENDING: "待审核",
  APPROVED: "已通过",
  REJECTED: "已驳回",
};

export function isGatewayReviewStatus(
  value: unknown,
): value is GatewayReviewStatusValue {
  return (
    typeof value === "string" &&
    (GATEWAY_REVIEW_STATUSES as readonly string[]).includes(value)
  );
}

/** 平台网关来源标签。 */
export const GATEWAY_SOURCE_LABELS = {
  platform: "平台网关",
  tenant: "租户自有",
} as const;

export function gatewaySourceLabel(isPlatformGateway: boolean) {
  return isPlatformGateway
    ? GATEWAY_SOURCE_LABELS.platform
    : GATEWAY_SOURCE_LABELS.tenant;
}
