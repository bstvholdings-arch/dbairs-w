import { createHmac, timingSafeEqual } from "node:crypto";

import { Prisma } from "@prisma/client";

import {
  GATEWAY_PROVIDER_TYPES,
  isGatewayType,
  type GatewayProviderType,
  type GatewayReviewStatusValue,
  type GatewayTypeValue,
} from "./payment-gateway-constants";
import {
  serializeGatewayBankDetails,
  validateGatewayBankDetails,
  type GatewayBankDetails,
} from "./payment-gateway-bank";
import { validateGatewayQrCodeImageUrl } from "./payment-gateway-qr";
import {
  GATEWAY_RATE_FIELD_KEYS,
  GATEWAY_RATE_FIELD_LABELS,
  GATEWAY_RATE_SERVICES,
  type GatewayRateFieldKey,
} from "./payment-gateway-rates";

export const gatewaySelect = {
  id: true,
  name: true,
  providerType: true,
  gatewayType: true,
  currency: true,
  walletAddress: true,
  qrCodeImageUrl: true,
  bankDetails: true,
  endpoint: true,
  apiKey: true,
  payinCostRate: true,
  payinSellRate: true,
  payoutCostRate: true,
  payoutSellRate: true,
  settlementCostRate: true,
  settlementSellRate: true,
  isPlatformGateway: true,
  reviewStatus: true,
  reviewNote: true,
  reviewedAt: true,
  isActive: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true } },
  _count: { select: { depositOrders: true } },
} satisfies Prisma.PaymentGatewaySelect;

export type GatewayRecord = Prisma.PaymentGatewayGetPayload<{
  select: typeof gatewaySelect;
}>;

export type SerializedGateway = {
  id: string;
  name: string;
  providerType: string;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string | null;
  qrCodeImageUrl: string | null;
  bankDetails: GatewayBankDetails | null;
  endpoint: string;
  apiKeyPreview: string;
  payinCostRate: string;
  payinSellRate: string;
  payoutCostRate: string;
  payoutSellRate: string;
  settlementCostRate: string;
  settlementSellRate: string;
  payinProfitRate: string;
  payoutProfitRate: string;
  settlementProfitRate: string;
  isPlatformGateway: boolean;
  reviewStatus: GatewayReviewStatusValue;
  reviewNote: string | null;
  reviewedAt: string | null;
  isActive: boolean;
  ownerId: string | null;
  ownerName: string | null;
  depositOrderCount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * API 永远不返回完整 apiKey。后台只展示末 4 位，编辑时留空表示沿用旧密钥。
 * Decimal 统一转字符串，避免前端 Number 精度丢失；利润点差也在服务端算好。
 */
export function serializeGateway(gateway: GatewayRecord): SerializedGateway {
  return {
    id: gateway.id,
    name: gateway.name,
    providerType: gateway.providerType,
    gatewayType: gateway.gatewayType,
    currency: gateway.currency,
    walletAddress: gateway.walletAddress,
    qrCodeImageUrl: gateway.qrCodeImageUrl,
    bankDetails: serializeGatewayBankDetails(gateway.bankDetails),
    endpoint: gateway.endpoint,
    apiKeyPreview: gateway.apiKey
      ? `••••${gateway.apiKey.slice(-4)}`
      : "未配置",
    payinCostRate: gateway.payinCostRate.toFixed(6),
    payinSellRate: gateway.payinSellRate.toFixed(6),
    payoutCostRate: gateway.payoutCostRate.toFixed(6),
    payoutSellRate: gateway.payoutSellRate.toFixed(6),
    settlementCostRate: gateway.settlementCostRate.toFixed(6),
    settlementSellRate: gateway.settlementSellRate.toFixed(6),
    payinProfitRate: gateway.payinSellRate
      .minus(gateway.payinCostRate)
      .toFixed(6),
    payoutProfitRate: gateway.payoutSellRate
      .minus(gateway.payoutCostRate)
      .toFixed(6),
    settlementProfitRate: gateway.settlementSellRate
      .minus(gateway.settlementCostRate)
      .toFixed(6),
    isPlatformGateway: gateway.isPlatformGateway,
    reviewStatus: gateway.reviewStatus,
    reviewNote: gateway.reviewNote,
    reviewedAt: gateway.reviewedAt?.toISOString() ?? null,
    isActive: gateway.isActive,
    ownerId: gateway.ownerId,
    ownerName: gateway.owner?.name ?? null,
    depositOrderCount: gateway._count.depositOrders,
    createdAt: gateway.createdAt.toISOString(),
    updatedAt: gateway.updatedAt.toISOString(),
  };
}


export function normalizeGatewayName(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

export function isGatewayProviderType(
  value: unknown,
): value is GatewayProviderType {
  return (
    typeof value === "string" &&
    (GATEWAY_PROVIDER_TYPES as readonly string[]).includes(value)
  );
}

export function normalizeGatewayCurrency(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function validateGatewayCurrency(currency: string) {
  if (!currency) {
    return "币种不能为空";
  }

  if (!/^[A-Z]{2,10}$/.test(currency)) {
    return "币种需为 2-10 位大写字母，例如 MYR / EUR / AUD / USDT";
  }

  return "";
}

export type GatewayCheckoutConfiguration = {
  providerType: string;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string;
  qrCodeImageUrl: string;
  endpoint: string;
  apiKey: string;
  bankDetails: GatewayBankDetails;
};

/**
 * 收银台可用性校验：只判断玩家是否能完成支付，不校验后台密钥。
 * 后台列表 / 玩家网关列表共用，避免把不完整配置展示给玩家。
 */
export function validateGatewayCheckoutAvailability(
  config: GatewayCheckoutConfiguration,
) {
  if (!isGatewayProviderType(config.providerType)) {
    return "网关类型配置异常";
  }

  if (!isGatewayType(config.gatewayType)) {
    return "支付形态配置异常";
  }

  const currencyError = validateGatewayCurrency(config.currency);

  if (currencyError) {
    return currencyError;
  }

  const isUsdt = isUsdtProviderType(config.providerType);

  if (isUsdt) {
    if (config.gatewayType !== "DYNAMIC_QR") {
      return "USDT 网关必须使用动态二维码";
    }

    if (config.currency !== "USDT") {
      return "USDT 网关币种必须为 USDT";
    }

    const walletError = validateGatewayWalletAddress(
      config.providerType,
      config.walletAddress,
    );

    if (walletError) {
      return walletError;
    }
  }

  if (
    (config.gatewayType === "REDIRECT_URL" ||
      config.gatewayType === "DYNAMIC_QR") &&
    !config.apiKey
  ) {
    return "未配置回调密钥";
  }

  switch (config.gatewayType) {
    case "STATIC_QR": {
      if (!config.qrCodeImageUrl) {
        return "未配置静态收款图";
      }

      return validateGatewayQrCodeImageUrl(config.qrCodeImageUrl);
    }
    case "REDIRECT_URL": {
      if (!config.endpoint || !normalizeGatewayEndpoint(config.endpoint)) {
        return "未配置有效的跳转支付地址";
      }

      return "";
    }
    case "DYNAMIC_QR": {
      if (
        !isUsdt &&
        (!config.endpoint || !normalizeGatewayEndpoint(config.endpoint))
      ) {
        return "未配置有效的动态二维码接口";
      }

      return "";
    }
    case "BANK_TRANSFER": {
      return validateGatewayBankDetails(config.bankDetails);
    }
  }
}

export type GatewayConfiguration = GatewayCheckoutConfiguration;
/**
 * 服务端统一校验网关配置。
 * 后台创建 / 编辑使用同一套规则，避免两端出现“前端能保存、玩家却无法支付”的配置。
 */
export function validateGatewayConfiguration(config: GatewayConfiguration) {
  if (!isGatewayProviderType(config.providerType)) {
    return "请选择有效的网关类型";
  }

  if (!isGatewayType(config.gatewayType)) {
    return "请选择有效的支付形态";
  }

  const currencyError = validateGatewayCurrency(config.currency);

  if (currencyError) {
    return currencyError;
  }

  const isUsdt = isUsdtProviderType(config.providerType);

  if (isUsdt) {
    if (config.gatewayType !== "DYNAMIC_QR") {
      return "USDT 网关的支付形态必须是 DYNAMIC_QR";
    }

    if (config.currency !== "USDT") {
      return "USDT 网关的币种必须为 USDT";
    }

    const walletError = validateGatewayWalletAddress(
      config.providerType,
      config.walletAddress,
    );

    if (walletError) {
      return walletError;
    }
  }

  if (config.apiKey.length > 512) {
    return "API Key 不能超过 512 个字符";
  }

  switch (config.gatewayType) {
    case "STATIC_QR": {
      if (!config.qrCodeImageUrl) {
        return "静态收款图必须上传二维码图片或填写图片 URL";
      }

      const qrCodeImageError = validateGatewayQrCodeImageUrl(
        config.qrCodeImageUrl,
      );

      if (qrCodeImageError) {
        return qrCodeImageError;
      }

      break;
    }
    case "REDIRECT_URL": {
      if (!config.endpoint) {
        return "跳转支付必须填写有效的接口地址";
      }

      break;
    }
    case "DYNAMIC_QR": {
      if (!isUsdt && !config.endpoint) {
        return "非 USDT 动态二维码必须填写有效的接口地址";
      }

      break;
    }
    case "BANK_TRANSFER": {
      const bankDetailsError = validateGatewayBankDetails(config.bankDetails);

      if (bankDetailsError) {
        return bankDetailsError;
      }

      break;
    }
  }

  if (
    (config.gatewayType === "REDIRECT_URL" ||
      config.gatewayType === "DYNAMIC_QR") &&
    config.endpoint &&
    !normalizeGatewayEndpoint(config.endpoint)
  ) {
    return "接口地址必须是有效的 http/https URL";
  }

  if (
    (config.gatewayType === "REDIRECT_URL" ||
      config.gatewayType === "DYNAMIC_QR") &&
    !config.apiKey
  ) {
    return "跳转支付 / 动态二维码必须配置回调 API Key";
  }

  return "";
}

export const USDT_PROVIDER_TYPES = ["usdt_trc20", "usdt_erc20"] as const;
const TRC20_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const ERC20_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function isUsdtProviderType(providerType: string) {
  return (USDT_PROVIDER_TYPES as readonly string[]).includes(providerType);
}

export function normalizeWalletAddress(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * USDT 网关必须配置可识别的收款地址；银行/其他通道允许留空。
 * 这里同时做格式校验，避免把拼错的地址展示给付款玩家。
 */
export function validateGatewayWalletAddress(
  providerType: string,
  walletAddress: string,
) {
  if (!isUsdtProviderType(providerType)) {
    return walletAddress.length > 200 ? "钱包地址不能超过 200 个字符" : "";
  }

  if (!walletAddress) {
    return "USDT 网关必须填写收款钱包地址";
  }

  if (
    providerType === "usdt_trc20" &&
    !TRC20_ADDRESS_PATTERN.test(walletAddress)
  ) {
    return "TRC20 地址格式不正确（应为 T 开头的 34 位地址）";
  }

  if (
    providerType === "usdt_erc20" &&
    !ERC20_ADDRESS_PATTERN.test(walletAddress)
  ) {
    return "ERC20 地址格式不正确（应为 0x 开头的 42 位地址）";
  }

  return "";
}

/**
 * 二维码默认只编码钱包地址，兼容绝大多数 USDT 钱包扫码。
 * qrCodeDataWithAmount 是可选增强内容，部分钱包不支持 ?amount 参数，
 * 前端必须提示用户扫码后核对地址与金额。
 */
export function buildUsdtQrPayload(
  walletAddress: string,
  amount: string,
  currency = "USDT",
) {
  const address = walletAddress.trim();

  return {
    qrCodeData: address,
    qrCodeDataWithAmount: `${address}?amount=${encodeURIComponent(amount)}&currency=${encodeURIComponent(currency)}`,
  };
}

/**
 * “我已完成支付”测试按钮只在非生产环境开放。
 * 如确需在预发环境联调，可显式设置 DEPOSIT_ALLOW_TEST_CALLBACK=true。
 */
export function depositTestCallbackAllowed() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.DEPOSIT_ALLOW_TEST_CALLBACK === "true"
  );
}

export function normalizeGatewayEndpoint(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const text = value.trim();

  if (!text || text.length > 2048) {
    return "";
  }

  try {
    const url = new URL(text);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function normalizeGatewayApiKey(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export type GatewayRateValues = Record<GatewayRateFieldKey, Prisma.Decimal>;

const ZERO_RATE = new Prisma.Decimal(0);
const MAX_GATEWAY_RATE = new Prisma.Decimal(1);
const GATEWAY_RATE_PATTERN = /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/;

export function emptyGatewayRateValues(): GatewayRateValues {
  return {
    payinCostRate: ZERO_RATE,
    payinSellRate: ZERO_RATE,
    payoutCostRate: ZERO_RATE,
    payoutSellRate: ZERO_RATE,
    settlementCostRate: ZERO_RATE,
    settlementSellRate: ZERO_RATE,
  };
}

export function gatewayRateValuesFromRecord(record: {
  payinCostRate: Prisma.Decimal;
  payinSellRate: Prisma.Decimal;
  payoutCostRate: Prisma.Decimal;
  payoutSellRate: Prisma.Decimal;
  settlementCostRate: Prisma.Decimal;
  settlementSellRate: Prisma.Decimal;
}): GatewayRateValues {
  return {
    payinCostRate: record.payinCostRate,
    payinSellRate: record.payinSellRate,
    payoutCostRate: record.payoutCostRate,
    payoutSellRate: record.payoutSellRate,
    settlementCostRate: record.settlementCostRate,
    settlementSellRate: record.settlementSellRate,
  };
}

/**
 * 费率以字符串提交，避免 Number 精度丢失。
 * 允许 0 ~ 1，最多 6 位小数，例如 0.005 / 0.008 / 1。
 */
export function parseGatewayRate(
  value: unknown,
  label: string,
): { value: Prisma.Decimal | null; error: string } {
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";

  if (!GATEWAY_RATE_PATTERN.test(text)) {
    return {
      value: null,
      error: `${label}必须是 0 ~ 1 之间的小数，最多 6 位，例如 0.005`,
    };
  }

  const rate = new Prisma.Decimal(text);

  if (rate.lessThan(0) || rate.greaterThan(MAX_GATEWAY_RATE)) {
    return {
      value: null,
      error: `${label}必须在 0 ~ 1 之间`,
    };
  }

  return { value: rate, error: "" };
}

/**
 * 解析 6 个费率字段；字段缺失时沿用 fallback（编辑场景）或 0（新建场景）。
 */
export function parseGatewayRates(
  input: Record<string, unknown>,
  fallback: GatewayRateValues = emptyGatewayRateValues(),
): { rates: GatewayRateValues | null; error: string } {
  const rates = { ...fallback };

  for (const key of GATEWAY_RATE_FIELD_KEYS) {
    const raw = input[key];

    if (raw === undefined || raw === null || raw === "") {
      continue;
    }

    const parsed = parseGatewayRate(raw, GATEWAY_RATE_FIELD_LABELS[key]);

    if (parsed.error || !parsed.value) {
      return { rates: null, error: parsed.error };
    }

    rates[key] = parsed.value;
  }

  return { rates, error: "" };
}

/**
 * 平台吃差价：任何一条业务线的售价不得低于成本。
 * 0 费率（例如暂不开放代付）视为未启用，允许成本与售价同为 0。
 */
export function validateGatewayRateHierarchy(rates: GatewayRateValues) {
  for (const service of GATEWAY_RATE_SERVICES) {
    const cost = rates[service.costKey];
    const sell = rates[service.sellKey];

    if (sell.lessThan(cost)) {
      return `${service.label}售价不能低于成本价，否则平台会产生负毛利`;
    }
  }

  return "";
}

export function normalizeGatewayReviewNote(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 500);
}

export function readOptionalOwnerId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const ownerId = value.trim();
  return ownerId.length > 0 ? ownerId : null;
}

const MAX_PAYMENT_AMOUNT = new Prisma.Decimal("1000000");
const PAYMENT_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const CURRENCY_PATTERN = /^[A-Z]{2,10}$/;

/**
 * 金额必须以字符串提交，避免 JSON number 在进入服务端前丢失小数精度。
 * 为了兼容简单调用方，也接受 number，但会先转成十进制字符串再校验。
 */
function parsePaymentAmount(value: unknown, label: string): Prisma.Decimal {
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";

  if (!PAYMENT_AMOUNT_PATTERN.test(text)) {
    throw new Error(`${label}金额格式不正确，最多 6 位小数`);
  }

  const amount = new Prisma.Decimal(text);

  if (!amount.isPositive()) {
    throw new Error(`${label}金额必须大于 0`);
  }

  if (amount.greaterThan(MAX_PAYMENT_AMOUNT)) {
    throw new Error(`单笔${label}金额不能超过 1,000,000`);
  }

  if (amount.decimalPlaces() > 6) {
    throw new Error(`${label}金额最多支持 6 位小数`);
  }

  return amount;
}

export function parseDepositAmount(value: unknown): Prisma.Decimal {
  return parsePaymentAmount(value, "充值");
}

export function parseWithdrawalAmount(value: unknown): Prisma.Decimal {
  return parsePaymentAmount(value, "提现");
}

export function parseDepositCurrency(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "USDT";
  }

  if (typeof value !== "string") {
    return "";
  }

  const currency = value.trim().toUpperCase();
  return CURRENCY_PATTERN.test(currency) ? currency : "";
}

/**
 * 生产环境默认强制回调验签；本地开发默认关闭，方便用 Postman / 测试脚本模拟回调。
 * 可通过 PAYMENT_CALLBACK_REQUIRE_SIGNATURE=true|false 显式覆盖。
 */
export function callbackSignatureRequired() {
  const configured = process.env.PAYMENT_CALLBACK_REQUIRE_SIGNATURE
    ?.trim()
    .toLowerCase();

  if (configured === "true") {
    return true;
  }

  if (configured === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

/**
 * 支付商回调签名：hex(HMAC-SHA256(rawBody, gateway.apiKey))。
 * header 支持原始 hex，也兼容 `sha256=<hex>`。
 */
export function verifyCallbackSignature(
  rawBody: string,
  signatureHeader: string | null,
  apiKey: string,
) {
  if (!signatureHeader || !apiKey) {
    return false;
  }

  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  const expectedHex = createHmac("sha256", apiKey)
    .update(rawBody, "utf8")
    .digest("hex");

  const providedBuffer = Buffer.from(provided.trim().toLowerCase(), "hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

/** 供支付商侧 / 测试脚本生成签名使用。 */
export function createCallbackSignature(rawBody: string, apiKey: string) {
  return createHmac("sha256", apiKey).update(rawBody, "utf8").digest("hex");
}
