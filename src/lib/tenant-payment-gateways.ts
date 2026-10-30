import { Prisma } from "@prisma/client";

import { normalizeGatewayBankDetails } from "./payment-gateway-bank";
import {
  isUsdtProviderType,
  validateGatewayCheckoutAvailability,
} from "./payment-gateway";
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
  apiKey: true,
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

/** 租户可见的平台网关：只暴露售价，不暴露平台成本。 */
export type TenantPlatformGateway = {
  id: string;
  name: string;
  providerType: string;
  gatewayType: GatewayTypeValue;
  currency: string;
  payinSellRate: string;
  payoutSellRate: string;
  settlementSellRate: string;
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

/** 租户自有网关：包含审核状态与配置摘要，不返回成本 / 完整密钥。 */
export type TenantOwnGateway = {
  id: string;
  name: string;
  providerType: string;
  gatewayType: GatewayTypeValue;
  currency: string;
  configurationSummary: string;
  configurationSummaryData: TenantGatewayConfigurationSummary;
  apiKeyPreview: string;
  hasApiKey: boolean;
  isActive: boolean;
  reviewStatus: GatewayReviewStatusValue;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TenantPaymentGatewayData = {
  platformGateways: TenantPlatformGateway[];
  ownGateways: TenantOwnGateway[];
};

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
    case "REDIRECT_URL":
      return `跳转支付 · ${endpointHost(gateway.endpoint) || "待补充接口"}`;
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

function isCheckoutAvailable(gateway: TenantGatewayRecord) {
  return (
    validateGatewayCheckoutAvailability({
      providerType: gateway.providerType,
      gatewayType: gateway.gatewayType,
      currency: gateway.currency,
      walletAddress: gateway.walletAddress?.trim() ?? "",
      qrCodeImageUrl: gateway.qrCodeImageUrl?.trim() ?? "",
      endpoint: gateway.endpoint?.trim() ?? "",
      apiKey: gateway.apiKey,
      bankDetails: normalizeGatewayBankDetails(gateway.bankDetails),
    }) === ""
  );
}

export function serializeTenantPlatformGateway(
  gateway: TenantGatewayRecord,
): TenantPlatformGateway {
  return {
    id: gateway.id,
    name: gateway.name,
    providerType: gateway.providerType,
    gatewayType: gateway.gatewayType,
    currency: gateway.currency,
    payinSellRate: gateway.payinSellRate.toFixed(6),
    payoutSellRate: gateway.payoutSellRate.toFixed(6),
    settlementSellRate: gateway.settlementSellRate.toFixed(6),
  };
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
    configurationSummary: gatewayConfigurationSummary(gateway),
    configurationSummaryData: gatewayConfigurationSummaryData(gateway),
    apiKeyPreview: gateway.apiKey ? `••••${gateway.apiKey.slice(-4)}` : "",
    hasApiKey: Boolean(gateway.apiKey),
    isActive: gateway.isActive,
    reviewStatus: gateway.reviewStatus,
    reviewNote: gateway.reviewNote,
    reviewedAt: gateway.reviewedAt?.toISOString() ?? null,
    createdAt: gateway.createdAt.toISOString(),
    updatedAt: gateway.updatedAt.toISOString(),
  };
}

/**
 * 租户支付页 / GET /api/tenant/gateways/available 共用的数据加载。
 *
 * - platformGateways: 平台提供、已审核、已启用且配置完整的网关；
 * - ownGateways: 当前租户提交的全部自有网关（含待审核 / 驳回）。
 */
export async function loadTenantPaymentGateways(
  tenantId: string,
): Promise<TenantPaymentGatewayData> {
  const gateways = await prisma.paymentGateway.findMany({
    where: {
      OR: [{ ownerId: null }, { ownerId: tenantId }],
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: tenantGatewaySelect,
  });

  const platformGateways = gateways
    .filter(
      (gateway) =>
        gateway.isPlatformGateway &&
        gateway.reviewStatus === "APPROVED" &&
        gateway.isActive &&
        isCheckoutAvailable(gateway),
    )
    .map(serializeTenantPlatformGateway);

  const ownGateways = gateways
    .filter(
      (gateway) =>
        !gateway.isPlatformGateway && gateway.ownerId === tenantId,
    )
    .map(serializeTenantOwnGateway);

  return { platformGateways, ownGateways };
}
