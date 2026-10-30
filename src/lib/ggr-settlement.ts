import { Prisma } from "@prisma/client";

/**
 * GGR（Gross Gaming Revenue，总游戏收入）结算核心。
 *
 * 重要口径：
 * - GGR = 总下注额（Total Bets）- 总派彩额（Total Payouts）
 * - Point 是分配 GGR 的比例，只能乘以 GGR，绝对不能乘以总流水 Turnover。
 * - upstreamPoint = 0.94：游戏商保留 1 - 0.94 = 6% 的 GGR。
 * - platformMarkup = 0.02：平台保留 2% 的 GGR。
 * - downstreamPoint = 0.94 - 0.02 = 0.92：下游商户保留 92% 的 GGR。
 */

const ONE = new Prisma.Decimal(1);
const POINT_DECIMALS = 4;
const AMOUNT_DECIMALS = 6;

export type DecimalInput = Prisma.Decimal.Value;

export type ProviderPointBreakdown = {
  upstreamPoint: Prisma.Decimal;
  platformMarkup: Prisma.Decimal;
  downstreamPoint: Prisma.Decimal;
  providerPoint: Prisma.Decimal;
};

/**
 * 租户生效点数：
 * - 未设置专属点数时，effectivePoint = 全局 downstreamPoint
 * - 设置专属点数时，effectivePoint = customPoint
 * - effectivePlatformMarkup = 上游点数 - 最终下游点数
 */
export type EffectivePointBreakdown = ProviderPointBreakdown & {
  customPoint: Prisma.Decimal | null;
  effectivePoint: Prisma.Decimal;
  effectivePlatformMarkup: Prisma.Decimal;
  isCustom: boolean;
};

export type GgrSettlementResult = EffectivePointBreakdown & {
  totalBets: Prisma.Decimal;
  totalPayouts: Prisma.Decimal;
  ggr: Prisma.Decimal;
  providerShare: Prisma.Decimal;
  platformShare: Prisma.Decimal;
  downstreamShare: Prisma.Decimal;
};

/**
 * 下注瞬间写入 BetRecord 的快照，后续修改任何点数都不会影响历史账单。
 */
export type SettlementSnapshot = {
  snapshotPoint: Prisma.Decimal;
  snapshotUpstreamPoint: Prisma.Decimal;
  snapshotPlatformMarkup: Prisma.Decimal;
  providerPoint: Prisma.Decimal;
  isCustom: boolean;
};

function toDecimal(value: DecimalInput, field: string) {
  try {
    const decimal = new Prisma.Decimal(value);

    if (!decimal.isFinite()) {
      throw new Error("not finite");
    }

    return decimal;
  } catch {
    throw new RangeError(`${field}必须是有效数字`);
  }
}

function assertPoint(value: Prisma.Decimal, field: string) {
  if (value.lt(0) || value.gt(1)) {
    throw new RangeError(
      `${field}必须在 0 到 1 之间，例如 0.94 表示 94%`,
    );
  }

  if (value.decimalPlaces() > POINT_DECIMALS) {
    throw new RangeError(`${field}最多支持 ${POINT_DECIMALS} 位小数`);
  }
}

/**
 * 计算下游最终点数：downstreamPoint = upstreamPoint - platformMarkup。
 * 同时返回游戏商实际分成比例 providerPoint = 1 - upstreamPoint。
 */
export function resolveProviderPoints(
  upstreamPoint: DecimalInput,
  platformMarkup: DecimalInput,
): ProviderPointBreakdown {
  const upstream = toDecimal(upstreamPoint, "上游点数");
  const markup = toDecimal(platformMarkup, "平台加点");

  assertPoint(upstream, "上游点数");
  assertPoint(markup, "平台加点");

  const downstream = upstream.minus(markup);

  if (downstream.lte(0)) {
    throw new RangeError("平台加点必须小于上游点数，否则下游点数为 0");
  }

  return {
    upstreamPoint: upstream.toDecimalPlaces(POINT_DECIMALS),
    platformMarkup: markup.toDecimalPlaces(POINT_DECIMALS),
    downstreamPoint: downstream.toDecimalPlaces(POINT_DECIMALS),
    providerPoint: ONE.minus(upstream).toDecimalPlaces(POINT_DECIMALS),
  };
}

/**
 * 解析某个租户在某个游戏商下的最终生效点数。
 * customPoint 为 null / undefined / 空字符串时使用全局默认点数。
 */
export function resolveEffectivePoints(
  upstreamPoint: DecimalInput,
  platformMarkup: DecimalInput,
  customPoint?: DecimalInput | null,
): EffectivePointBreakdown {
  const points = resolveProviderPoints(upstreamPoint, platformMarkup);

  if (customPoint === null || customPoint === undefined || customPoint === "") {
    return {
      ...points,
      customPoint: null,
      effectivePoint: points.downstreamPoint,
      effectivePlatformMarkup: points.platformMarkup,
      isCustom: false,
    };
  }

  const custom = toDecimal(customPoint, "专属点数");

  assertPoint(custom, "专属点数");

  if (custom.lte(0)) {
    throw new RangeError("专属点数必须大于 0");
  }

  if (custom.gt(points.upstreamPoint)) {
    throw new RangeError("专属点数不能高于上游点数");
  }

  return {
    ...points,
    customPoint: custom.toDecimalPlaces(POINT_DECIMALS),
    effectivePoint: custom.toDecimalPlaces(POINT_DECIMALS),
    effectivePlatformMarkup: points.upstreamPoint
      .minus(custom)
      .toDecimalPlaces(POINT_DECIMALS),
    isCustom: true,
  };
}

/**
 * 生成下注瞬间的快照。写入 BetRecord 后，即使后台修改全局点数或租户专属点数，
 * 历史账单仍按 snapshotPoint / snapshotUpstreamPoint / snapshotPlatformMarkup 结算。
 */
export function buildSettlementSnapshot({
  upstreamPoint,
  platformMarkup,
  customPoint,
}: {
  upstreamPoint: DecimalInput;
  platformMarkup: DecimalInput;
  customPoint?: DecimalInput | null;
}): SettlementSnapshot {
  const points = resolveEffectivePoints(
    upstreamPoint,
    platformMarkup,
    customPoint,
  );

  return {
    snapshotPoint: points.effectivePoint,
    snapshotUpstreamPoint: points.upstreamPoint,
    snapshotPlatformMarkup: points.effectivePlatformMarkup,
    providerPoint: points.providerPoint,
    isCustom: points.isCustom,
  };
}

/**
 * GGR = 总下注额 - 总派彩额。
 * GGR 允许为负（玩家净赢），负值会原样进入结算，业务侧可选择滚存或次期抵扣。
 */
export function calculateGgr(
  totalBets: DecimalInput,
  totalPayouts: DecimalInput,
) {
  const bets = toDecimal(totalBets, "总下注额");
  const payouts = toDecimal(totalPayouts, "总派彩额");

  if (bets.lt(0)) {
    throw new RangeError("总下注额不能为负数");
  }

  if (payouts.lt(0)) {
    throw new RangeError("总派彩额不能为负数");
  }

  return bets
    .minus(payouts)
    .toDecimalPlaces(AMOUNT_DECIMALS);
}

/**
 * 按点数拆分 GGR，绝不对 Turnover 计费。
 *
 * providerShare  = GGR × (1 - upstreamPoint)
 * platformShare  = GGR × platformMarkup
 * downstreamShare = GGR - providerShare - platformShare
 *
 * 下游份额使用 GGR 减去另外两方份额，确保三笔金额在 6 位小数上严格合计为 GGR。
 */
export function calculateGgrSettlement({
  totalBets,
  totalPayouts,
  upstreamPoint,
  platformMarkup,
  customPoint,
}: {
  totalBets: DecimalInput;
  totalPayouts: DecimalInput;
  upstreamPoint: DecimalInput;
  platformMarkup: DecimalInput;
  customPoint?: DecimalInput | null;
}): GgrSettlementResult {
  const points = resolveEffectivePoints(
    upstreamPoint,
    platformMarkup,
    customPoint,
  );
  const bets = toDecimal(totalBets, "总下注额");
  const payouts = toDecimal(totalPayouts, "总派彩额");
  const ggr = calculateGgr(bets, payouts);

  const providerShare = ggr
    .times(points.providerPoint)
    .toDecimalPlaces(AMOUNT_DECIMALS);
  const platformShare = ggr
    .times(points.effectivePlatformMarkup)
    .toDecimalPlaces(AMOUNT_DECIMALS);
  const downstreamShare = ggr
    .minus(providerShare)
    .minus(platformShare)
    .toDecimalPlaces(AMOUNT_DECIMALS);

  return {
    ...points,
    totalBets: bets.toDecimalPlaces(AMOUNT_DECIMALS),
    totalPayouts: payouts.toDecimalPlaces(AMOUNT_DECIMALS),
    ggr,
    providerShare,
    platformShare,
    downstreamShare,
  };
}
