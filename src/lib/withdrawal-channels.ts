/**
 * 纯法币提现（MYR → MYR）的共用口径：法币通道筛选 + 手续费估算。
 *
 * 为什么单独放一份：提现弹窗（客户端）与 /api/player/withdrawal-gateways、
 * /api/withdrawal/create（服务端）必须用同一套规则，否则会出现
 * 「弹窗里能选、提交被拒」或者「前端算 5%、后台算 10%」的对不上。
 * 本文件不依赖 Prisma / next，两端都能 import。
 */
import { normalizeCurrency } from "@/lib/currency";

/** 纯法币提现的小数位：MYR 只到「分」，两位以后的小数没有实际意义 */
export const PAYOUT_AMOUNT_DECIMALS = 2;

/**
 * 币种别名：后台把「符号」当成币种代码填的历史脏数据。
 * 例：PaymentGateway.currency = "RM"（RM 是 MYR 的符号）按 MYR 对待，
 * 否则该通道会从可用通道列表里凭空消失，商户还以为通道被删了。
 */
const PAYOUT_CURRENCY_ALIASES: Record<string, string> = {
  RM: "MYR",
  RINGGIT: "MYR",
};

/** 币种归一化：空值回落 DEFAULT_CURRENCY，符号别名映射成真正的币种代码 */
export function normalizePayoutCurrency(value: unknown): string {
  const code = normalizeCurrency(value).toUpperCase();

  return PAYOUT_CURRENCY_ALIASES[code] ?? code;
}

/** 链上 / 加密代付通道的 providerType 前缀：纯法币提现一律排除 */
const CRYPTO_PROVIDER_PREFIXES = ["usdt_", "crypto_", "coin_"];

/** 是否加密（链上）代付通道：out 掉 USDT / TRC20 / ERC20 这些 */
export function isCryptoPayoutProvider(providerType: string) {
  const type = providerType.trim().toLowerCase();

  return CRYPTO_PROVIDER_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export type PayoutChannelLike = {
  providerType: string;
  currency: string;
};

/**
 * 是不是「同一币种的纯法币通道」：
 * 1. 不能是加密通道（USDT / TRC20 / ERC20 …）；
 * 2. 通道币种必须等于本站记账币种（Tenant.currency，通常 MYR），
 *    否则就是跨币种出款 —— 需要汇率换算，本流程不做。
 */
export function isFiatPayoutChannel(
  channel: PayoutChannelLike,
  payoutCurrency: string,
) {
  if (isCryptoPayoutProvider(channel.providerType)) {
    return false;
  }

  return (
    normalizePayoutCurrency(channel.currency) ===
    normalizePayoutCurrency(payoutCurrency)
  );
}

export type PayoutAccountLike = {
  accountType: string;
  currency: string;
};

/** 法币提现账号：只认银行账号，且币种与本站记账币种一致 */
export function isFiatPayoutAccount(
  account: PayoutAccountLike,
  payoutCurrency: string,
) {
  if (account.accountType !== "bank") {
    return false;
  }

  return (
    normalizePayoutCurrency(account.currency) ===
    normalizePayoutCurrency(payoutCurrency)
  );
}

/** 四舍五入到分：不要用浮点原值展示，0.1 + 0.2 那套误差会露出来 */
export function roundPayoutAmount(value: number) {
  const factor = 10 ** PAYOUT_AMOUNT_DECIMALS;

  return Math.round(value * factor) / factor;
}

/**
 * 预估手续费 = 提现金额 × 通道费率（0.01 = 1%），四舍五入到分。
 *
 * 费率来自后台维护的 PaymentGateway.payoutSellRate（GET
 * /api/player/withdrawal-gateways 下发），前端不写死任何数字；
 * 金额与币种都是本站记账货币（MYR），不做汇率换算。
 */
export function calculateWithdrawalFee(amount: number, feeRate: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (!Number.isFinite(feeRate) || feeRate <= 0) {
    return 0;
  }

  return roundPayoutAmount(amount * feeRate);
}

/**
 * 预计到账 = 提现金额 − 预估手续费，最低 0。
 * 费率被后台配成 > 1 时也不会出现「负数到账」这种离谱展示。
 */
export function calculateWithdrawalReceive(amount: number, feeRate: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  return roundPayoutAmount(
    Math.max(0, amount - calculateWithdrawalFee(amount, feeRate)),
  );
}
