/**
 * 充值通道费率的统一口径（**只记账，绝不动玩家余额**）。
 *
 * 业务红线（AGENTS.md §14）：
 * - 包网平台绝不碰资金，只做精准账本：玩家申请充值 100 法币，
 *   系统给玩家的余额依然加 100 法币，通道费一分钱都不从玩家身上扣；
 * - 通道费与商户实际到账只是「记在订单上的两列数字」，供商户财务对账：
 *     feeAmount      = amount × feeRate ÷ 100   （四舍五入到分）
 *     actualReceived = amount − feeAmount
 * - 费率由商户在 /tenant/payments 按通道自己填（0 表示不收手续费）。
 *
 * 本文件是纯函数、不 import Prisma / 数据库，服务端与客户端都能用：
 * - 服务端：POST /api/deposit/create 下单时算账、settleDepositOrder 给历史单补账；
 * - 前端：网关表单实时预览、财务流水展示（全部复用同一份口径，不许各写一份）。
 */

/** 费率上限（百分比）。100 = 100%，再往上就是配置错误，直接拒。 */
export const MAX_GATEWAY_FEE_RATE_PERCENT = 100;

/** 费率落库精度（`PaymentGateway.feeRate` 是 Decimal(6,4)）：2.5000 = 2.5% */
const FEE_RATE_DECIMALS = 4;
/** 金额精度：法币只到「分」，手续费固定四舍五入到 2 位 */
const MONEY_DECIMALS = 2;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;

  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const text = value.trim();

    if (!text) {
      return null;
    }

    const numeric = Number(text);

    return Number.isFinite(numeric) ? numeric : null;
  }

  /**
   * Prisma.Decimal 之类的对象：`String(decimal)` 就是 "2" / "2.5000"。
   * 这样超管兜底接口把库里的旧值直接传进来也不会被判成非法。
   */
  if (value && typeof value === "object") {
    const text = String(value).trim();

    if (!text) {
      return null;
    }

    const numeric = Number(text);

    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

/**
 * 解析商户填写 / 库里存的费率（百分比）。
 *
 * @returns 合法时返回 0~100 的数字（保留 4 位）；空值、非数字、负数、>100 一律 null。
 */
export function parseGatewayFeeRatePercent(value: unknown): number | null {
  const numeric = toFiniteNumber(value);

  if (numeric === null || numeric < 0 || numeric > MAX_GATEWAY_FEE_RATE_PERCENT) {
    return null;
  }

  return roundTo(numeric, FEE_RATE_DECIMALS);
}

/**
 * 读侧归一化：脏数据 / 空值 / 缺字段一律回落 0（= 不收费率）。
 * 「读不炸、写必校验」——接口写入只用 parseGatewayFeeRatePercent，非法值 400。
 */
export function normalizeGatewayFeeRatePercent(value: unknown): number {
  return parseGatewayFeeRatePercent(value) ?? 0;
}

/**
 * 展示用文本："2.0000" → "2"，"2.5000" → "2.5"，脏值 → "0"。
 * 用于编辑弹窗回填与列表角标，避免商户看到 "2.0000%" 这种别扭写法。
 */
export function formatGatewayFeeRatePercent(value: unknown): string {
  const rate = normalizeGatewayFeeRatePercent(value);

  if (rate === 0) {
    return "0";
  }

  return String(Number(rate.toFixed(FEE_RATE_DECIMALS)));
}

/**
 * 算账（唯一口径）：通道费 = 金额 × 费率 ÷ 100，商户实际到账 = 金额 − 通道费。
 *
 * `feeRatePercent` 接受 number / string / Prisma.Decimal（库里的 Decimal(6,4) 直接传），
 * 这样服务端不必先转一道，避免两处口径出现 0.01 的漂移。
 *
 * - 费率 0 / 非法 / 金额非正数 → 费率按 0 处理，实际到账 = 金额（绝不出现负数）；
 * - 结果统一四舍五入到分，保证「通道费 + 实际到账 = 金额」恒等。
 */
export function calculateDepositFee(
  amount: number,
  feeRatePercent: unknown,
): { feeAmount: number; actualReceived: number } {
  const gross = Number.isFinite(amount) ? roundTo(amount, MONEY_DECIMALS) : 0;

  if (gross <= 0) {
    return { feeAmount: 0, actualReceived: 0 };
  }

  const rate = normalizeGatewayFeeRatePercent(feeRatePercent);

  if (rate <= 0) {
    return { feeAmount: 0, actualReceived: gross };
  }

  const feeAmount = roundTo((gross * rate) / 100, MONEY_DECIMALS);
  // 费率极端（100%）时也不能让到账变负数；
  // 用「金额 − 通道费」而不是再算一次比例，保证两列相加恰好等于订单金额。
  const actualReceived = roundTo(Math.max(0, gross - feeAmount), MONEY_DECIMALS);

  return { feeAmount, actualReceived };
}

/**
 * 读订单的两列账本 → 展示用口径。
 *
 * 历史订单（本功能上线前创建）两列都是 0，但金额 > 0：
 * 那时没有手续费概念，实际到账就是全额，界面必须这么显示，
 * 否则商户会看到「充值 100、实际入账 0」，以为系统吞了钱。
 */
export function resolveDepositFeeBreakdown(input: {
  amount: number;
  feeAmount: number | null | undefined;
  actualReceived: number | null | undefined;
}): { feeAmount: number; actualReceived: number } {
  const gross = Number.isFinite(input.amount) ? input.amount : 0;
  const feeAmount = Number.isFinite(input.feeAmount ?? NaN)
    ? (input.feeAmount as number)
    : 0;
  const actualReceived = Number.isFinite(input.actualReceived ?? NaN)
    ? (input.actualReceived as number)
    : 0;

  // 两列都还是 0 = 没走过新链路（历史单），按全额入账回落。
  if (feeAmount === 0 && actualReceived === 0 && gross > 0) {
    return { feeAmount: 0, actualReceived: gross };
  }

  return { feeAmount, actualReceived };
}
