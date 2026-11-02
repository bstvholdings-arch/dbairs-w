/**
 * 全站货币符号的唯一出处（纯函数，服务端 / 客户端都能 import）。
 *
 * 背景：玩家钱包 `Player.balance` 是「租户记账货币」，没有 per-player 币种字段，
 * 所以余额、在途金额、各种统计金额的符号必须读 `Tenant.currency`（默认 MYR），
 * 不允许再在组件里写 `${formatAmount(...)}` 这种把 `$` 写死的写法。
 *
 * 用法：
 *   formatCurrency(50.5, tenant.currency)            → "RM 50.50"
 *   formatCurrency(50.5, "USD")                      → "$50.50"
 *   formatCurrency("12.345678", "USDT", { maximumFractionDigits: 6, trimZeros: true })
 *                                                    → "USDT 12.345678"
 *   formatCurrency(3, currency, { signed: true })     → "RM +3.00"
 */

/** 租户没配置币种时的兜底（与 Tenant.currency 的 @default 保持一致） */
export const DEFAULT_CURRENCY = "MYR";

/** 支持列表：后台下拉与 SQL 回填都按这份白名单走 */
export const SUPPORTED_CURRENCIES = [
  "MYR",
  "USD",
  "USDT",
  "THB",
  "IDR",
  "VND",
  "SGD",
  "AUD",
  "EUR",
  "INR",
  "HKD",
  "NPR",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

type CurrencyMeta = {
  /** 展示用的符号（找不到时直接用币种代码） */
  symbol: string;
  /** 符号与数字之间是否留空格：RM / Rp 留，$ / € / ฿ 不留 */
  spaced: boolean;
  /** 符号位置：绝大多数在金额前，越南盾习惯写在后面 */
  placement: "prefix" | "suffix";
};

const CURRENCY_META: Record<string, CurrencyMeta> = {
  MYR: { symbol: "RM", spaced: true, placement: "prefix" },
  USD: { symbol: "$", spaced: false, placement: "prefix" },
  // USDT 没有通用符号，直接用代码，避免 ₮ 在部分字体里缺字
  USDT: { symbol: "USDT", spaced: true, placement: "prefix" },
  THB: { symbol: "฿", spaced: false, placement: "prefix" },
  IDR: { symbol: "Rp", spaced: true, placement: "prefix" },
  VND: { symbol: "₫", spaced: true, placement: "suffix" },
  SGD: { symbol: "S$", spaced: false, placement: "prefix" },
  AUD: { symbol: "A$", spaced: false, placement: "prefix" },
  EUR: { symbol: "€", spaced: false, placement: "prefix" },
  INR: { symbol: "₹", spaced: false, placement: "prefix" },
  HKD: { symbol: "HK$", spaced: false, placement: "prefix" },
  NPR: { symbol: "रू", spaced: true, placement: "prefix" },
};

/** 归一化币种代码：未知 / 空值一律回退到 DEFAULT_CURRENCY，绝不返回空串 */
export function normalizeCurrency(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";

  if (!code) {
    return DEFAULT_CURRENCY;
  }

  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(code)) {
    return code;
  }

  // 允许后台自定义 2-8 位字母代码（如 CNY / PHP），非法字符则兜底
  return /^[A-Z]{2,8}$/.test(code) ? code : DEFAULT_CURRENCY;
}

/** 只取符号，例如 "MYR" → "RM"、"USD" → "$" */
export function currencySymbol(value: unknown): string {
  const code = normalizeCurrency(value);

  return CURRENCY_META[code]?.symbol ?? code;
}

export type CurrencyFormatOptions = {
  /** 最少保留几位小数（默认 2） */
  minimumFractionDigits?: number;
  /** 最多保留几位小数（默认与 minimumFractionDigits 相同） */
  maximumFractionDigits?: number;
  /** 去掉小数末尾多余的 0：50.50 → 50.5、50.00 → 50（加密货币金额常用） */
  trimZeros?: boolean;
  /** 正数前面补 "+"（今日输赢 / 奖池涨幅这类场景） */
  signed?: boolean;
};

/**
 * 金额格式化：符号 + 千分位 + 固定小数位。
 * 负数的负号永远在符号之前（-RM 5.00），不会出现 RM -5.00。
 */
export function formatCurrency(
  value: unknown,
  currency?: string | null,
  options: CurrencyFormatOptions = {},
): string {
  const code = normalizeCurrency(currency);
  const meta = CURRENCY_META[code] ?? {
    symbol: code,
    spaced: true,
    placement: "prefix" as const,
  };

  const raw = typeof value === "number" ? value : Number(value ?? 0);
  const amount = Number.isFinite(raw) ? raw : 0;
  const minimumFractionDigits = options.trimZeros
    ? 0
    : (options.minimumFractionDigits ?? 2);
  const maximumFractionDigits = Math.max(
    minimumFractionDigits,
    options.maximumFractionDigits ?? minimumFractionDigits,
  );

  const body = new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(Math.abs(amount));

  const sign = amount < 0 ? "-" : options.signed && amount > 0 ? "+" : "";
  const joiner = meta.spaced ? " " : "";

  return meta.placement === "suffix"
    ? `${sign}${body}${joiner}${meta.symbol}`
    : `${sign}${meta.symbol}${joiner}${body}`;
}

/** 带符号的金额（今日输赢、盈亏等），0 不显示 "+" */
export function formatSignedCurrency(
  value: unknown,
  currency?: string | null,
  options: CurrencyFormatOptions = {},
): string {
  return formatCurrency(value, currency, { ...options, signed: true });
}
