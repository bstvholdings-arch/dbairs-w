import { Prisma } from "@prisma/client";

import { resolveProviderPoints } from "./ggr-settlement";

/**
 * 游戏商接口统一查询字段与序列化逻辑。
 * - _count.tenantPoints：该游戏商已被多少个租户设置专属点数
 * - _count.betRecords：是否已有历史注单（有注单的游戏商必须保留，不能硬删除）
 * - _count.games：已同步的游戏数量
 */
export const providerSelect = {
  id: true,
  name: true,
  upstreamPoint: true,
  platformMarkup: true,
  downstreamPoint: true,
  status: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { tenantPoints: true, betRecords: true, games: true } },
} satisfies Prisma.GameProviderSelect;

export type ProviderRecord = Prisma.GameProviderGetPayload<{
  select: typeof providerSelect;
}>;

export function serializeProvider(provider: ProviderRecord) {
  // 输出时重新计算下游点数，避免数据库中被直接改写的旧值污染结算口径。
  const points = resolveProviderPoints(
    provider.upstreamPoint,
    provider.platformMarkup,
  );
  const { _count, ...rest } = provider;

  return {
    ...rest,
    upstreamPoint: provider.upstreamPoint.toString(),
    platformMarkup: provider.platformMarkup.toString(),
    downstreamPoint: points.downstreamPoint.toString(),
    tenantOverrideCount: _count.tenantPoints,
    betRecordCount: _count.betRecords,
    gameCount: _count.games,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

export function readDecimalInput(value: unknown): Prisma.Decimal.Value {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return Number.NaN;
}
