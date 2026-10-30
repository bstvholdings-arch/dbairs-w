/**
 * 支付费率字段定义与展示工具（客户端 / 服务端均可使用，不依赖 Prisma）。
 *
 * 数据库存小数：0.005 = 0.5%。平台利润（点差）= 售价 - 成本。
 */
export const GATEWAY_RATE_FIELD_KEYS = [
  "payinCostRate",
  "payinSellRate",
  "payoutCostRate",
  "payoutSellRate",
  "settlementCostRate",
  "settlementSellRate",
] as const;

export type GatewayRateFieldKey = (typeof GATEWAY_RATE_FIELD_KEYS)[number];

export type GatewayRateService = {
  key: "payin" | "payout" | "settlement";
  label: string;
  description: string;
  costKey: GatewayRateFieldKey;
  sellKey: GatewayRateFieldKey;
};

export const GATEWAY_RATE_SERVICES: readonly GatewayRateService[] = [
  {
    key: "payin",
    label: "代收 Deposit",
    description: "玩家充值入金",
    costKey: "payinCostRate",
    sellKey: "payinSellRate",
  },
  {
    key: "payout",
    label: "代付 Withdrawal",
    description: "玩家提现出金",
    costKey: "payoutCostRate",
    sellKey: "payoutSellRate",
  },
  {
    key: "settlement",
    label: "结算 Settlement",
    description: "商户资金结算",
    costKey: "settlementCostRate",
    sellKey: "settlementSellRate",
  },
] as const;

export const GATEWAY_RATE_FIELD_LABELS: Record<GatewayRateFieldKey, string> = {
  payinCostRate: "代收成本",
  payinSellRate: "代收售价",
  payoutCostRate: "代付成本",
  payoutSellRate: "代付售价",
  settlementCostRate: "结算成本",
  settlementSellRate: "结算售价",
};

export const GATEWAY_RATE_MAX = 1;
export const GATEWAY_RATE_DECIMAL_PLACES = 6;

/** 展示为百分比，默认 4 位小数；0.005 → 0.5000%。 */
export function formatGatewayRatePercent(value: unknown, digits = 4) {
  const number = Number(value ?? 0);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return `${(number * 100).toFixed(digits)}%`;
}

/** 展示带符号的点差，例如 +0.3000%。 */
export function formatGatewayRateSpread(
  cost: unknown,
  sell: unknown,
  digits = 4,
) {
  const spread = (Number(sell ?? 0) - Number(cost ?? 0)) * 100;

  if (!Number.isFinite(spread)) {
    return "—";
  }

  return `${spread >= 0 ? "+" : ""}${spread.toFixed(digits)}%`;
}

export function gatewayRateSpread(cost: unknown, sell: unknown) {
  const spread = Number(sell ?? 0) - Number(cost ?? 0);
  return Number.isFinite(spread) ? spread : 0;
}

/**
 * 前端只做快速校验；服务端仍会用 Prisma.Decimal 精确校验。
 * 允许 0 ~ 1，最多 6 位小数。
 */
export function validateGatewayRateInput(value: string) {
  const text = value.trim();

  if (!text) {
    return "费率不能为空，可填写 0";
  }

  if (!/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(text)) {
    return "费率必须是 0 ~ 1 之间的小数，最多 6 位，例如 0.005";
  }

  return "";
}

export function normalizeGatewayRateInput(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "0";
}
