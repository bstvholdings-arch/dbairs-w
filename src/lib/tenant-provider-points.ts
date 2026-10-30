import { Prisma } from "@prisma/client";

import { resolveEffectivePoints } from "./ggr-settlement";
import { prisma } from "./prisma";

/**
 * 租户 × 游戏商的最终点数视图。
 * customPoint 为 null 时表示没有覆盖记录，使用 GameProvider.downstreamPoint。
 */
export type TenantProviderPointRow = {
  providerId: string;
  providerName: string;
  providerStatus: string;
  upstreamPoint: string;
  platformMarkup: string;
  downstreamPoint: string;
  customPoint: string | null;
  effectivePoint: string;
  effectivePlatformMarkup: string;
  isCustom: boolean;
};

type ProviderPointSource = {
  id: string;
  name: string;
  status: string;
  upstreamPoint: Prisma.Decimal;
  platformMarkup: Prisma.Decimal;
};

/**
 * 将游戏商记录 + 该租户的覆盖点数统一序列化为前端 / API 所需结构。
 * 所有 Decimal 输出为字符串，避免 JSON 精度丢失。
 */
export function serializeTenantProviderRow(
  provider: ProviderPointSource,
  customPoint: Prisma.Decimal | null,
): TenantProviderPointRow {
  const points = resolveEffectivePoints(
    provider.upstreamPoint,
    provider.platformMarkup,
    customPoint,
  );

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerStatus: provider.status,
    upstreamPoint: points.upstreamPoint.toString(),
    platformMarkup: points.platformMarkup.toString(),
    downstreamPoint: points.downstreamPoint.toString(),
    customPoint: points.customPoint?.toString() ?? null,
    effectivePoint: points.effectivePoint.toString(),
    effectivePlatformMarkup: points.effectivePlatformMarkup.toString(),
    isCustom: points.isCustom,
  };
}

/**
 * 查询某个租户下所有游戏商的专属点数配置（包含未覆盖的游戏商）。
 */
export async function listTenantProviderPoints(
  tenantId: string,
): Promise<TenantProviderPointRow[]> {
  const providers = await prisma.gameProvider.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      upstreamPoint: true,
      platformMarkup: true,
      tenantPoints: {
        where: { tenantId },
        select: { customPoint: true },
      },
    },
  });

  return providers.map((provider) =>
    serializeTenantProviderRow(
      provider,
      provider.tenantPoints[0]?.customPoint ?? null,
    ),
  );
}

/**
 * 查询单个租户 × 游戏商的专属点数配置。
 * 返回 null 表示游戏商不存在；租户是否存在由调用方另行校验。
 */
export async function getTenantProviderPoint(
  tenantId: string,
  providerId: string,
): Promise<TenantProviderPointRow | null> {
  const provider = await prisma.gameProvider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      name: true,
      status: true,
      upstreamPoint: true,
      platformMarkup: true,
      tenantPoints: {
        where: { tenantId },
        select: { customPoint: true },
      },
    },
  });

  if (!provider) {
    return null;
  }

  return serializeTenantProviderRow(
    provider,
    provider.tenantPoints[0]?.customPoint ?? null,
  );
}
