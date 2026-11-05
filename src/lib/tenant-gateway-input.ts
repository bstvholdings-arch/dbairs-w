import { Prisma } from "@prisma/client";

import {
  isGatewayProviderType,
  isUsdtProviderType,
  normalizeGatewayApiKey,
  normalizeGatewayCurrency,
  normalizeGatewayEndpoint,
  normalizeGatewayName,
  normalizeWalletAddress,
  validateGatewayConfiguration,
} from "./payment-gateway";
import { normalizeGatewayBankDetails } from "./payment-gateway-bank";
import type { GatewayBankDetails } from "./payment-gateway-bank";
import {
  normalizeSupportedBanks,
  validateSupportedBanks,
} from "./payment-gateway-banks";
import {
  defaultGatewayCurrencyForProvider,
  defaultGatewayTypeForProvider,
  isCryptoGatewayProviderType,
  isGatewayType,
} from "./payment-gateway-constants";
import type {
  GatewayProviderType,
  GatewayTypeValue,
} from "./payment-gateway-constants";
import { normalizeGatewayQrCodeImageUrl } from "./payment-gateway-qr";

/**
 * 商户自有支付网关的入参解析（去中心化支付架构）。
 *
 * 背景：包网平台不再提供统一收款网关，收款通道完全由商户自行对接支付商。
 * 因此「新增」与「编辑」必须共用同一份校验，否则会出现
 * 「创建时能过、编辑时过不了」或「商户页面能保存、玩家却付不了款」。
 *
 * 使用方：
 *   - POST /api/tenant/gateways     （新增）
 *   - PUT  /api/tenant/gateways/:id （编辑，含 API Endpoint / 收款钱包 / API Secret）
 */
export type TenantGatewayInput = {
  name: string;
  providerType: GatewayProviderType;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string;
  qrCodeImageUrl: string;
  endpoint: string;
  apiKey: string;
  bankDetails: GatewayBankDetails;
  /**
   * REDIRECT_URL 通道下玩家可选的银行（归一化后的编码，如 maybank）。
   * 空数组 = 不做银行选择，玩家直接跳支付商收银台。
   */
  supportedBanks: string[];
};

export type TenantGatewayInputResult =
  | { ok: true; value: TenantGatewayInput }
  | { ok: false; status: number; error: string };

function reject(status: number, error: string): TenantGatewayInputResult {
  return { ok: false, status, error };
}

/**
 * 解析并校验商户提交的网关配置。
 *
 * @param body      原始请求体（客户端可传任意结构，这里逐字段收口）
 * @param apiKeyFallback 编辑场景下客户端不回传密钥时沿用的旧值：
 *        留空表示「不修改密钥」，但仍要用旧值参与配置完整性校验。
 */
export function parseTenantGatewayInput(
  body: unknown,
  apiKeyFallback = "",
): TenantGatewayInputResult {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = normalizeGatewayName(input.name);

  if (!name) {
    return reject(400, "网关名称不能为空");
  }

  if (name.length > 80) {
    return reject(400, "网关名称不能超过 80 个字符");
  }

  if (!isGatewayProviderType(input.providerType)) {
    return reject(400, "请选择有效的网关类型");
  }

  /**
   * 法币专精（不可回退）：商户端**不允许**新增 / 修改成加密货币（USDT）通道。
   *
   * 为什么放在这里：新增（POST /api/tenant/gateways）与编辑（PUT …/:id）
   * 共用本函数，一处收口就能同时掐断两条路；商户端下拉也已经不提供这些选项，
   * 这里拦的是「绕过界面直接构造请求」。历史 USDT 通道需要改成法币支付商才能保存。
   */
  if (isCryptoGatewayProviderType(input.providerType)) {
    return reject(
      400,
      "本平台只支持法币通道，已停用加密货币（USDT）网关，请选择银行转账 / 静态码 / 网银跳转等法币支付商",
    );
  }

  const providerType = input.providerType;
  const isUsdt = isUsdtProviderType(providerType);
  const gatewayType =
    input.gatewayType === undefined ||
    input.gatewayType === null ||
    input.gatewayType === ""
      ? defaultGatewayTypeForProvider(providerType)
      : input.gatewayType;

  if (!isGatewayType(gatewayType)) {
    return reject(400, "请选择有效的支付形态");
  }

  const currency =
    normalizeGatewayCurrency(input.currency) ||
    defaultGatewayCurrencyForProvider(providerType);
  const walletAddress = isUsdt
    ? normalizeWalletAddress(input.walletAddress)
    : "";
  const qrCodeImageUrl =
    gatewayType === "STATIC_QR"
      ? normalizeGatewayQrCodeImageUrl(input.qrCodeImageUrl)
      : "";
  const rawEndpoint =
    typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  const isEndpointGateway =
    gatewayType === "REDIRECT_URL" || gatewayType === "DYNAMIC_QR";
  const endpoint = isEndpointGateway
    ? normalizeGatewayEndpoint(input.endpoint)
    : "";

  if (rawEndpoint && !endpoint && isEndpointGateway) {
    return reject(400, "接口地址必须是有效的 http/https URL");
  }

  // 密钥留空 = 沿用旧密钥（编辑场景）；新增场景留空则由完整性校验拦下。
  const apiKey = normalizeGatewayApiKey(input.apiKey) || apiKeyFallback;
  // 银行选择只对「跳转网银」有意义：静态码 / 银行转账 / 动态码存了也是死数据。
  const supportedBanks =
    gatewayType === "REDIRECT_URL"
      ? normalizeSupportedBanks(input.supportedBanks)
      : [];
  const banksError = validateSupportedBanks(supportedBanks);

  if (banksError) {
    return reject(400, banksError);
  }

  const bankDetails =
    gatewayType === "BANK_TRANSFER"
      ? normalizeGatewayBankDetails(input.bankDetails)
      : normalizeGatewayBankDetails(null);
  const configurationError = validateGatewayConfiguration({
    providerType,
    gatewayType,
    currency,
    walletAddress,
    qrCodeImageUrl,
    endpoint,
    apiKey,
    bankDetails,
  });

  if (configurationError) {
    return reject(400, configurationError);
  }

  return {
    ok: true,
    value: {
      name,
      providerType,
      gatewayType,
      currency,
      walletAddress,
      qrCodeImageUrl,
      endpoint,
      apiKey,
      bankDetails,
      supportedBanks,
    },
  };
}

/**
 * 解析结果 → Prisma 写入字段。
 *
 * 非当前支付形态的字段一律清空，避免商户从「静态收款图」切换到
 * 「跳转支付」后，旧的二维码图片 / 银行账号还留在库里被误用。
 */
export function tenantGatewayWriteData(value: TenantGatewayInput) {
  const isUsdt = isUsdtProviderType(value.providerType);

  return {
    name: value.name,
    providerType: value.providerType,
    gatewayType: value.gatewayType,
    currency: value.currency,
    walletAddress: isUsdt ? value.walletAddress || null : null,
    qrCodeImageUrl:
      value.gatewayType === "STATIC_QR" ? value.qrCodeImageUrl || null : null,
    bankDetails:
      value.gatewayType === "BANK_TRANSFER"
        ? value.bankDetails
        : Prisma.DbNull,
    endpoint: value.endpoint,
    apiKey: value.apiKey,
    // 非 REDIRECT_URL 一律清空：换过形态后残留的银行列表会让玩家看到
    // 一个「选了也没用」的选择框。
    supportedBanks:
      value.gatewayType === "REDIRECT_URL" ? value.supportedBanks : [],
  };
}
