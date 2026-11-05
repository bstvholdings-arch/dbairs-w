import { Prisma } from "@prisma/client";

import { isUsdtProviderType } from "./payment-gateway";
import {
  normalizeGatewayBankDetails,
  type GatewayBankDetails,
} from "./payment-gateway-bank";
import { normalizeSupportedBanks } from "./payment-gateway-banks";
import type {
  GatewayReviewStatusValue,
  GatewayTypeValue,
} from "./payment-gateway-constants";
import { prisma } from "./prisma";

export const tenantGatewaySelect = {
  id: true,
  name: true,
  providerType: true,
  gatewayType: true,
  currency: true,
  walletAddress: true,
  qrCodeImageUrl: true,
  bankDetails: true,
  endpoint: true,
  payoutEndpoint: true,
  apiKey: true,
  supportedBanks: true,
  payinSellRate: true,
  payoutSellRate: true,
  settlementSellRate: true,
  isPlatformGateway: true,
  reviewStatus: true,
  reviewNote: true,
  reviewedAt: true,
  isActive: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentGatewaySelect;

export type TenantGatewayRecord = Prisma.PaymentGatewayGetPayload<{
  select: typeof tenantGatewaySelect;
}>;

/**
 * 商户自有支付网关（去中心化支付架构）。
 *
 * 平台不再提供统一收款网关，收款通道由商户在本页自行对接支付商；
 * 因此除了展示用的摘要，还下发**商户自己填过的原始配置**
 * （endpoint / 钱包地址 / 二维码 / 银行信息），编辑弹窗才能回填。
 * 这些数据只属于当前商户，接口层强制 where: { ownerId: tenantId }。
 */
export type TenantOwnGateway = {
  id: string;
  name: string;
  providerType: string;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string;
  qrCodeImageUrl: string;
  endpoint: string;
  bankDetails: GatewayBankDetails;
  /** REDIRECT_URL 通道下玩家可选的银行（归一化编码）；空数组 = 不做银行选择 */
  supportedBanks: string[];
  configurationSummary: string;
  configurationSummaryData: TenantGatewayConfigurationSummary;
  apiKeyPreview: string;
  hasApiKey: boolean;
  /** 是否配了代付 API（出金用）。false → 用这条通道的提现只能人工审核 */
  payoutApiConfigured: boolean;
  isActive: boolean;
  reviewStatus: GatewayReviewStatusValue;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TenantPaymentGatewayData = {
  ownGateways: TenantOwnGateway[];
};

export type TenantGatewayConfigurationSummary = {
  kind:
    | "STATIC_QR"
    | "BANK_TRANSFER"
    | "REDIRECT_URL"
    | "USDT_WALLET"
    | "DYNAMIC_QR"
    | "OTHER";
  currency: string;
  bankName: string;
  account: string;
  endpoint: string;
  walletSuffix: string;
};

/**
 * 商户自有网关：包含审核状态与配置摘要，不返回完整密钥（列表只展示末 4 位）。
 */
function maskTail(value: string, visible = 4) {
  const text = value.trim();

  if (!text) {
    return "";
  }

  if (text.length <= visible) {
    return `••••${text}`;
  }

  return `••••${text.slice(-visible)}`;
}

function endpointHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function gatewayConfigurationSummary(gateway: TenantGatewayRecord) {
  switch (gateway.gatewayType) {
    case "STATIC_QR":
      return `静态收款图 · ${gateway.currency}`;
    case "BANK_TRANSFER": {
      const details = normalizeGatewayBankDetails(gateway.bankDetails);
      const account =
        maskTail(details.accountNumber || details.iban || details.payId) ||
        "待补充账号";
      const bank = details.bankName || details.accountName || "银行转账";

      return `${bank} · ${account} · ${gateway.currency}`;
    }
    case "REDIRECT_URL": {
      const host = endpointHost(gateway.endpoint) || "待补充接口";
      const bankCount = normalizeSupportedBanks(gateway.supportedBanks).length;

      // 有银行列表时玩家会先选银行（收银台渲染银行卡片），后台一眼能看出来。
      return bankCount > 0
        ? `跳转支付 · ${host} · ${bankCount} 家银行`
        : `跳转支付 · ${host}`;
    }
    case "DYNAMIC_QR":
      if (isUsdtProviderType(gateway.providerType)) {
        return `USDT 钱包 · ${maskTail(gateway.walletAddress ?? "", 6)}`;
      }

      return `动态二维码 · ${endpointHost(gateway.endpoint) || "待补充接口"}`;
    default:
      return gateway.currency;
  }
}

function gatewayConfigurationSummaryData(
  gateway: TenantGatewayRecord,
): TenantGatewayConfigurationSummary {
  const base: TenantGatewayConfigurationSummary = {
    kind: "OTHER",
    currency: gateway.currency,
    bankName: "",
    account: "",
    endpoint: "",
    walletSuffix: "",
  };

  switch (gateway.gatewayType) {
    case "STATIC_QR":
      return { ...base, kind: "STATIC_QR" };
    case "BANK_TRANSFER": {
      const details = normalizeGatewayBankDetails(gateway.bankDetails);

      return {
        ...base,
        kind: "BANK_TRANSFER",
        bankName: details.bankName || details.accountName,
        account:
          maskTail(details.accountNumber || details.iban || details.payId) || "",
      };
    }
    case "REDIRECT_URL":
      return {
        ...base,
        kind: "REDIRECT_URL",
        endpoint: endpointHost(gateway.endpoint),
      };
    case "DYNAMIC_QR":
      if (isUsdtProviderType(gateway.providerType)) {
        return {
          ...base,
          kind: "USDT_WALLET",
          walletSuffix: maskTail(gateway.walletAddress ?? "", 6),
        };
      }

      return {
        ...base,
        kind: "DYNAMIC_QR",
        endpoint: endpointHost(gateway.endpoint),
      };
    default:
      return base;
  }
}

export function serializeTenantOwnGateway(
  gateway: TenantGatewayRecord,
): TenantOwnGateway {
  return {
    id: gateway.id,
    name: gateway.name,
    providerType: gateway.providerType,
    gatewayType: gateway.gatewayType,
    currency: gateway.currency,
    // 商户自己填过的原始配置：编辑弹窗需要回填（接口层已按租户收口）。
    walletAddress: gateway.walletAddress ?? "",
    qrCodeImageUrl: gateway.qrCodeImageUrl ?? "",
    endpoint: gateway.endpoint,
    bankDetails: normalizeGatewayBankDetails(gateway.bankDetails),
    supportedBanks:
      gateway.gatewayType === "REDIRECT_URL"
        ? normalizeSupportedBanks(gateway.supportedBanks)
        : [],
    configurationSummary: gatewayConfigurationSummary(gateway),
    configurationSummaryData: gatewayConfigurationSummaryData(gateway),
    apiKeyPreview: gateway.apiKey ? `••••${gateway.apiKey.slice(-4)}` : "",
    hasApiKey: Boolean(gateway.apiKey),
    payoutApiConfigured: Boolean(gateway.payoutEndpoint),
    isActive: gateway.isActive,
    reviewStatus: gateway.reviewStatus,
    reviewNote: gateway.reviewNote,
    reviewedAt: gateway.reviewedAt?.toISOString() ?? null,
    createdAt: gateway.createdAt.toISOString(),
    updatedAt: gateway.updatedAt.toISOString(),
  };
}

/**
 * 商户支付网关页 / GET /api/tenant/gateways/available 共用的数据加载。
 *
 * 去中心化支付架构下平台不再下发统一收款网关，这里只返回
 * **当前商户自己配置的通道**（含已停用的，方便商户重新启用或编辑）。
 */
export async function loadTenantPaymentGateways(
  tenantId: string,
): Promise<TenantPaymentGatewayData> {
  const gateways = await prisma.paymentGateway.findMany({
    where: { ownerId: tenantId, isPlatformGateway: false },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: tenantGatewaySelect,
  });

  return { ownGateways: gateways.map(serializeTenantOwnGateway) };
}
