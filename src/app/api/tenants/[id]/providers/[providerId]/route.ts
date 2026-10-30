import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { resolveEffectivePoints } from "@/lib/ggr-settlement";
import { prisma } from "@/lib/prisma";
import { readDecimalInput } from "@/lib/provider-api";
import { getSuperAdminFromRequest } from "@/lib/super-admin";
import {
  getTenantProviderPoint,
  serializeTenantProviderRow,
} from "@/lib/tenant-provider-points";

type TenantProviderRouteContext = {
  params: Promise<{ id: string; providerId: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * 查询单个租户 × 游戏商的专属点数。
 * GET /api/tenants/[id]/providers/[providerId]
 */
export async function GET(
  request: NextRequest,
  context: TenantProviderRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id: tenantId, providerId } = await context.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      return jsonError("租户不存在", 404);
    }

    const row = await getTenantProviderPoint(tenantId, providerId);

    if (!row) {
      return jsonError("游戏商不存在", 404);
    }

    return Response.json(
      { provider: row },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取租户专属点数失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/**
 * 设置 / 修改 / 清空某个租户在某个游戏商下的专属点数。
 *
 * - customPoint 为数字或数字字符串：upsert TenantProviderPoint
 * - customPoint 为 null / 空字符串 / 纯空格：删除覆盖记录，回退全局 downstreamPoint
 */
async function saveTenantProviderPoint(
  request: NextRequest,
  context: TenantProviderRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id: tenantId, providerId } = await context.params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;

    if (!hasOwn(input, "customPoint")) {
      return jsonError("缺少 customPoint 字段", 400);
    }

    const [tenant, provider] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      }),
      prisma.gameProvider.findUnique({
        where: { id: providerId },
        select: {
          id: true,
          name: true,
          status: true,
          upstreamPoint: true,
          platformMarkup: true,
        },
      }),
    ]);

    if (!tenant) {
      return jsonError("租户不存在", 404);
    }

    if (!provider) {
      return jsonError("游戏商不存在", 404);
    }

    const rawCustomPoint = input.customPoint;
    const isReset =
      rawCustomPoint === null ||
      (typeof rawCustomPoint === "string" && rawCustomPoint.trim() === "");

    let points;

    try {
      points = resolveEffectivePoints(
        provider.upstreamPoint,
        provider.platformMarkup,
        isReset ? null : readDecimalInput(rawCustomPoint),
      );
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "专属点数格式不正确",
        400,
      );
    }

    if (isReset) {
      await prisma.tenantProviderPoint.deleteMany({
        where: { tenantId, providerId },
      });
    } else {
      await prisma.tenantProviderPoint.upsert({
        where: {
          tenantId_providerId: { tenantId, providerId },
        },
        create: {
          tenantId,
          providerId,
          customPoint: points.effectivePoint,
        },
        update: {
          customPoint: points.effectivePoint,
        },
      });
    }

    const row = serializeTenantProviderRow(provider, points.customPoint);

    return Response.json({
      success: true,
      ...row,
      row,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("保存冲突，请刷新页面后重试", 409);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError("租户或游戏商已被删除，请刷新页面后重试", 409);
    }

    console.error("设置租户专属点数失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/**
 * PUT /api/tenants/[id]/providers/[providerId]
 */
export async function PUT(
  request: NextRequest,
  context: TenantProviderRouteContext,
) {
  return saveTenantProviderPoint(request, context);
}

/**
 * PATCH /api/tenants/[id]/providers/[providerId]
 * 与 PUT 等价，兼容使用 PATCH 的前端 / 外部调用方。
 */
export async function PATCH(
  request: NextRequest,
  context: TenantProviderRouteContext,
) {
  return saveTenantProviderPoint(request, context);
}


/**
 * 删除某个租户的专属点数覆盖，回退到全局默认点数。
 * DELETE /api/tenants/[id]/providers/[providerId]
 */
export async function DELETE(
  request: NextRequest,
  context: TenantProviderRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id: tenantId, providerId } = await context.params;

    const [tenant, provider] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      }),
      prisma.gameProvider.findUnique({
        where: { id: providerId },
        select: {
          id: true,
          name: true,
          status: true,
          upstreamPoint: true,
          platformMarkup: true,
        },
      }),
    ]);

    if (!tenant) {
      return jsonError("租户不存在", 404);
    }

    if (!provider) {
      return jsonError("游戏商不存在", 404);
    }

    await prisma.tenantProviderPoint.deleteMany({
      where: { tenantId, providerId },
    });

    const row = serializeTenantProviderRow(provider, null);

    return Response.json({
      success: true,
      deleted: true,
      ...row,
      row,
    });
  } catch (error) {
    console.error("删除租户专属点数失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

