import {
  GATEWAY_PROVIDER_TYPE_LABELS,
  GATEWAY_PROVIDER_TYPES,
  GATEWAY_TYPE_LABELS,
  GATEWAY_TYPES,
  type GatewayProviderType,
  type GatewayReviewStatusValue,
  type GatewayTypeValue,
} from "@/lib/payment-gateway-constants";
import type { GatewayBankDetails } from "@/lib/payment-gateway-bank";

export const GATEWAY_TYPE_OPTIONS = GATEWAY_PROVIDER_TYPES.map((value) => ({
  value,
  label: GATEWAY_PROVIDER_TYPE_LABELS[value],
})) satisfies ReadonlyArray<{
  value: GatewayProviderType;
  label: string;
}>;

export const GATEWAY_PAYMENT_TYPE_OPTIONS = GATEWAY_TYPES.map((value) => ({
  value,
  label: GATEWAY_TYPE_LABELS[value],
})) satisfies ReadonlyArray<{
  value: GatewayTypeValue;
  label: string;
}>;

export type GatewayRow = {
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

export type GatewayTenantOption = {
  id: string;
  name: string;
};

export type GatewayMutationResponse = {
  success?: boolean;
  gateway?: GatewayRow;
  error?: string;
};

export type GatewayFormValues = {
  name: string;
  providerType: GatewayProviderType;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string;
  qrCodeImageUrl: string;
  bankDetails: GatewayBankDetails;
  endpoint: string;
  apiKey: string;
  payinCostRate: string;
  payinSellRate: string;
  payoutCostRate: string;
  payoutSellRate: string;
  settlementCostRate: string;
  settlementSellRate: string;
  isPlatformGateway: boolean;
  isActive: boolean;
  ownerId: string;
};
