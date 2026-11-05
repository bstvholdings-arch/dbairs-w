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

/**
 * 加密货币（链上）支付商类型 —— **本平台只做法币，永久禁用**（产品 / 合规决策）。
 *
 * 为什么放在这个文件：它是纯常量 + 纯函数（不碰 node:*、不碰 prisma），
 * 服务端（接口守卫）与客户端（商户后台下拉、玩家充值弹窗兜底过滤）共用同一份；
 * `src/lib/payment-gateway.ts` 因为有 node:crypto 不能进浏览器包，
 * 那边的 `USDT_PROVIDER_TYPES` 直接引用这里的列表，不另存一份。
 */
export const CRYPTO_GATEWAY_PROVIDER_TYPES = [
  "usdt_trc20",
  "usdt_erc20",
] as const;

/**
 * 加密货币币种代码：即使 providerType 被改成别的（历史脏数据 / 手工改库），
 * 只要通道币种是这些，就不算法币通道，绝不下发给玩家。
 */
export const CRYPTO_GATEWAY_CURRENCIES = [
  "USDT",
  "USDC",
  "BTC",
  "ETH",
  "TRX",
  "BNB",
  "DAI",
] as const;

export function isCryptoGatewayProviderType(providerType: unknown): boolean {
  return (
    typeof providerType === "string" &&
    (CRYPTO_GATEWAY_PROVIDER_TYPES as readonly string[]).includes(
      providerType.trim(),
    )
  );
}

export function isCryptoGatewayCurrency(currency: unknown): boolean {
  if (typeof currency !== "string") {
    return false;
  }

  return (CRYPTO_GATEWAY_CURRENCIES as readonly string[]).includes(
    currency.trim().toUpperCase(),
  );
}

/**
 * 「法币通道」唯一判定：支付商类型与通道币种都必须不是加密货币。
 *
 * 使用方（必须共用，禁止各写一份 if）：
 *   - POST /api/deposit/create       → 命中即 409，防止绕过前端直接下单；
 *   - GET  /api/deposit/gateways     → 命中即不下发，玩家端根本看不到；
 *   - 玩家充值弹窗                    → 对响应再兜底过滤一次（双保险）。
 */
export function isFiatGatewayChannel(channel: {
  providerType: unknown;
  currency: unknown;
}): boolean {
  return (
    !isCryptoGatewayProviderType(channel.providerType) &&
    !isCryptoGatewayCurrency(channel.currency)
  );
}

/**
 * 商户后台「支付商」下拉的可选项：已剔除加密货币。
 * 商户端只能配法币通道（银行转账 / 静态码 / 网银跳转 / 动态码），
 * 从源头断绝「商户自己接个 USDT 钱包」这条路。
 */
export const FIAT_GATEWAY_PROVIDER_TYPES: readonly GatewayProviderType[] =
  GATEWAY_PROVIDER_TYPES.filter(
    (providerType) => !isCryptoGatewayProviderType(providerType),
  );

/**
 * 必须人工确认到账的通道形态（资金安全红线，不可回退）。
 *
 * `STATIC_QR`（商户自己的收款码）与 `BANK_TRANSFER`（玩家转账到商户银行账户）
 * 这两种形态的钱是直接进商户自己的银行账户的，系统拿不到「支付商已收款」的机器凭证
 * —— 即使收到一个签名合法的回调，也只说明「对端说收到了」，不能作为上分依据。
 *
 * 因此这两种通道的充值订单一律停在 `pending` + `manualReviewStatus=pending`，
 * 由商户在后台 /tenant/deposits 人工核对银行流水后点【确认到账】才加钱。
 * 判定只能走这个函数，禁止在路由 / 页面里各自写 if (gatewayType === "STATIC_QR")。
 */
export const MANUAL_REVIEW_GATEWAY_TYPES = [
  "STATIC_QR",
  "BANK_TRANSFER",
] as const;

export function gatewayRequiresManualReview(
  gatewayType: unknown,
): gatewayType is (typeof MANUAL_REVIEW_GATEWAY_TYPES)[number] {
  return (
    typeof gatewayType === "string" &&
    (MANUAL_REVIEW_GATEWAY_TYPES as readonly string[]).includes(gatewayType)
  );
}

/** 充值订单的人工审核状态（`DepositOrder.manualReviewStatus`）。 */
export const DEPOSIT_MANUAL_REVIEW_PENDING = "pending";
export const DEPOSIT_MANUAL_REVIEW_APPROVED = "approved";
export const DEPOSIT_MANUAL_REVIEW_REJECTED = "rejected";

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
