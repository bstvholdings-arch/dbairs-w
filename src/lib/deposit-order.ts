import { randomInt } from "node:crypto";

import {
  buildUsdtQrPayload,
  isUsdtProviderType,
} from "./payment-gateway";
import type { GatewayBankDetails } from "./payment-gateway-bank";
import type { GatewayTypeValue } from "./payment-gateway-constants";

/**
 * 充值订单的共享工具层。
 *
 * 这里只放「纯函数 + 常量」，不直接碰数据库，方便：
 * - /api/deposit/create 生成订单号与支付指令；
 * - /api/deposit/callback/[gatewayCode] 回查订单；
 * - 前端弹窗按同一口径展示金额区间。
 */

/** 订单号前缀：DEP_<毫秒时间戳>_<6 位十六进制随机>。 */
export const DEPOSIT_ORDER_NO_PREFIX = "DEP";

/** 资金类型：加密货币直接给钱包地址，法币给银行账号 / 收款码。 */
export type DepositGatewayKind = "CRYPTO" | "FIAT";

/**
 * 生成商户订单号。
 *
 * 为什么不用 uuid：第三方支付商后台、客服对账、玩家回执里都要出现这个号码，
 * 人眼需要能看出「哪天下的单」；时间戳 + 6 位随机（16^6 ≈ 1677 万/毫秒）
 * 既保证唯一性，也让重复回调、人工核对成本最低。
 *
 * 随机数用 node:crypto 的 randomInt，而不是 Math.random()：
 * 后者是可预测的伪随机，攻击者可以猜出邻近订单号去撞库 / 伪造回调。
 */
export function generateDepositOrderNo(now: number = Date.now()) {
  const random = randomInt(0, 0xffffff)
    .toString(16)
    .toUpperCase()
    .padStart(6, "0");

  return `${DEPOSIT_ORDER_NO_PREFIX}_${now}_${random}`;
}

/** 判断是不是本系统生成的订单号（回调里用于区分 orderNo 与其他单号）。 */
export function isDepositOrderNo(value: string) {
  return new RegExp(`^${DEPOSIT_ORDER_NO_PREFIX}_\\d+_[0-9A-F]{6}$`).test(value);
}

/**
 * 网关资金类型：CRYPTO（USDT / 其他链上币种）还是 FIAT（法币）。
 *
 * 两个判断条件都要看，因为历史网关存在「providerType 写成 other、
 * 但币种是 USDT」的配置：
 * - providerType 是 usdt_trc20 / usdt_erc20；
 * - 或网关币种本身就是 USDT。
 */
export function resolveGatewayKind(gateway: {
  providerType: string;
  currency: string;
}): DepositGatewayKind {
  if (
    isUsdtProviderType(gateway.providerType) ||
    gateway.currency.trim().toUpperCase() === "USDT"
  ) {
    return "CRYPTO";
  }

  return "FIAT";
}

/** USDT 链网络标签，用于前端提示玩家「别转错链」。 */
export function resolveGatewayNetwork(providerType: string) {
  if (providerType === "usdt_trc20") {
    return "TRC20";
  }

  if (providerType === "usdt_erc20") {
    return "ERC20";
  }

  return "";
}

/**
 * 支付指令：下单成功后前端只需要照着这张卡片收款，不需要理解网关类型。
 * 字段全部显式可空，前端按 kind 渲染（CRYPTO 展示地址 + 二维码，FIAT 展示银行信息）。
 */
export type DepositPaymentInstructions = {
  kind: DepositGatewayKind;
  /** 应付金额（Decimal 字符串，6 位小数） */
  amount: string;
  currency: string;
  /** CRYPTO：收款钱包地址 */
  walletAddress: string | null;
  /** CRYPTO：链网络（TRC20 / ERC20），为空表示未识别的链 */
  network: string | null;
  /** CRYPTO：二维码内容（默认只编码地址，兼容性最好） */
  qrCodeData: string | null;
  /** CRYPTO：带金额的二维码内容（部分钱包支持，仅作增强） */
  qrCodeDataWithAmount: string | null;
  /** FIAT：银行账号明细 */
  bankDetails: GatewayBankDetails | null;
  /** FIAT：静态收款图（TNG / DuitNow 等） */
  qrCodeImageUrl: string | null;
  /** FIAT：跳转收银台地址（REDIRECT_URL） */
  paymentUrl: string | null;
};

export function buildDepositPaymentInstructions(input: {
  gatewayKind: DepositGatewayKind;
  providerType: string;
  gatewayType: GatewayTypeValue;
  amount: string;
  currency: string;
  walletAddress: string;
  bankDetails: GatewayBankDetails;
  qrCodeImageUrl: string;
  paymentUrl: string | null;
}): DepositPaymentInstructions {
  if (input.gatewayKind === "CRYPTO") {
    const qr =
      input.gatewayType === "DYNAMIC_QR" && input.walletAddress
        ? buildUsdtQrPayload(
            input.walletAddress,
            input.amount,
            input.currency,
          )
        : null;

    return {
      kind: "CRYPTO",
      amount: input.amount,
      currency: input.currency,
      walletAddress: input.walletAddress || null,
      network: resolveGatewayNetwork(input.providerType) || null,
      qrCodeData: qr?.qrCodeData ?? null,
      qrCodeDataWithAmount: qr?.qrCodeDataWithAmount ?? null,
      bankDetails: null,
      qrCodeImageUrl: null,
      paymentUrl: null,
    };
  }

  return {
    kind: "FIAT",
    amount: input.amount,
    currency: input.currency,
    walletAddress: null,
    network: null,
    qrCodeData: null,
    qrCodeDataWithAmount: null,
    bankDetails:
      input.gatewayType === "BANK_TRANSFER" ? input.bankDetails : null,
    qrCodeImageUrl:
      input.gatewayType === "STATIC_QR" ? input.qrCodeImageUrl || null : null,
    paymentUrl: input.paymentUrl,
  };
}
