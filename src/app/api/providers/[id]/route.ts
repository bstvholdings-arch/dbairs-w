import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { resolveProviderPoints } from "@/lib/ggr-settlement";
import { prisma } from "@/lib/prisma";
import {
  providerSelect,
  readDecimalInput,
  serializeProvider,
} from "@/lib/provider-api";
import { can } from "@/lib/rbac";
import { guardPermission, getSessionUserFromRequest } from "@/lib/session";

type ProviderRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeProviderName(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

/**
 * 查询单个游戏商。
 * GET /api/providers/[id]
 */
export async function GET(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  try {
    // 详情含点数等敏感字段：读权限与写权限一致（providers）。
    const viewer = await getSessionUserFromRequest(request);

    if (!viewer || !can(viewer.role, "providers")) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id } = await context.params;

    const provider = await prisma.gameProvider.findUnique({
      where: { id },
      select: providerSelect,
    });

    if (!provider) {
      return jsonError("游戏商不存在", 404);
    }

    return Response.json(
      { provider: serializeProvider(provider) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取游戏商详情失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}


/**
 * 修改游戏商名称 / 上游点数 / 平台加点。
 *
 * PATCH 与 PUT 共用同一套逻辑：请求体中可以只传需要修改的字段。
 * 保存后立即写入 upstreamPoint / platformMarkup / downstreamPoint。
 * 已存在的租户专属点数不被覆盖，但若专属点数高于新的上游点数，则拒绝保存。
 */
async function updateProvider(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  try {
    const gate = await guardPermission(request, "providers");

    if (gate.response) {
      return gate.response;
    }

    const { id } = await context.params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;

    const existing = await prisma.gameProvider.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        upstreamPoint: true,
        platformMarkup: true,
        tenantPoints: {
          orderBy: { customPoint: "desc" },
          select: {
            customPoint: true,
            tenant: { select: { name: true } },
          },
        },
      },
    });

    if (!existing) {
      return jsonError("游戏商不存在", 404);
    }

    let name: string | undefined;

    if (hasOwn(input, "name")) {
      name = normalizeProviderName(input.name);

      if (!name) {
        return jsonError("游戏商名称不能为空", 400);
      }

      if (name.length > 80) {
        return jsonError("游戏商名称不能超过 80 个字符", 400);
      }

      if (name.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await prisma.gameProvider.findFirst({
          where: {
            id: { not: id },
            name: { equals: name, mode: "insensitive" },
          },
          select: { id: true },
        });

        if (duplicate) {
          return jsonError("该游戏商名称已存在", 409);
        }
      }
    }

    let status: "active" | "suspended" | undefined;

    if (hasOwn(input, "status")) {
      if (input.status !== "active" && input.status !== "suspended") {
        return jsonError("游戏商状态只能是 active 或 suspended", 400);
      }

      status = input.status;
    }

    // 大厅展示控制：排序权重 + 上架开关，与结算状态 status 互相独立。
    let sortOrder: number | undefined;

    if (hasOwn(input, "sortOrder")) {
      const value = input.sortOrder;

      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 999999
      ) {
        return jsonError("排序权重必须是 0 ~ 999999 的整数", 400);
      }

      sortOrder = value;
    }

    let isActive: boolean | undefined;

    if (hasOwn(input, "isActive")) {
      if (typeof input.isActive !== "boolean") {
        return jsonError("isActive 只能是 true 或 false", 400);
      }

      isActive = input.isActive;
    }

    let points;

    try {
      points = resolveProviderPoints(
        hasOwn(input, "upstreamPoint")
          ? readDecimalInput(input.upstreamPoint)
          : existing.upstreamPoint,
        hasOwn(input, "platformMarkup")
          ? readDecimalInput(input.platformMarkup)
          : existing.platformMarkup,
      );
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "点数格式不正确",
        400,
      );
    }

    // 专属点数必须始终不高于上游点数，否则平台分成会变成负数。
    const conflicting = existing.tenantPoints.find((item) =>
      item.customPoint.gt(points.upstreamPoint),
    );

    if (conflicting) {
      return jsonError(
        `无法保存：商户「${conflicting.tenant.name}」的专属点数 ${conflicting.customPoint.toFixed(4)} 高于新的上游点数 ${points.upstreamPoint.toFixed(4)}，请先调整该商户的专属点数`,
        409,
      );
    }

    const updated = await prisma.gameProvider.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        upstreamPoint: points.upstreamPoint,
        platformMarkup: points.platformMarkup,
        downstreamPoint: points.downstreamPoint,
      },
      select: providerSelect,
    });

    return Response.json({
      success: true,
      provider: serializeProvider(updated),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("该游戏商名称已存在", 409);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("游戏商不存在", 404);
    }

    console.error("更新游戏商失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/**
 * PATCH /api/providers/[id]
 */
export async function PATCH(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  return updateProvider(request, context);
}

/**
 * PUT /api/providers/[id]
 * 与 PATCH 等价，兼容使用 PUT 的前端 / 外部调用方。
 */
export async function PUT(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  return updateProvider(request, context);
}

/**
 * 删除游戏商。
 *
 * 已有历史注单的游戏商不能硬删除，否则会破坏 BetRecord 的历史结算依据；
 * 此时返回 409，请改为将 status 设置为 suspended 停用。
 * 没有历史注单时，关联的 TenantProviderPoint 会随外键级联删除。
 */
export async function DELETE(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  try {
    const gate = await guardPermission(request, "providers");

    if (gate.response) {
      return gate.response;
    }

    const { id } = await context.params;

    const provider = await prisma.gameProvider.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            betRecords: true,
            tenantPoints: true,
          },
        },
      },
    });

    if (!provider) {
      return jsonError("游戏商不存在", 404);
    }

    if (provider._count.betRecords > 0) {
      return jsonError(
        `无法删除：游戏商「${provider.name}」已有 ${provider._count.betRecords} 条历史注单。为保证历史结算快照可追溯，请将状态改为 suspended 停用，而不是删除。`,
        409,
      );
    }

    // 显式先删除租户专属点数，再删除游戏商。
    // 这样即使线上数据库的外键仍然是 RESTRICT（历史库未执行最新迁移），
    // 也不会因为 TenantProviderPoint 的关联而删除失败；两条语句同一事务提交。
    const [deletedOverrides] = await prisma.$transaction([
      prisma.tenantProviderPoint.deleteMany({
        where: { providerId: provider.id },
      }),
      prisma.gameProvider.delete({ where: { id: provider.id } }),
    ]);

    return Response.json({
      success: true,
      deletedId: provider.id,
      deletedTenantOverrideCount: deletedOverrides.count,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError(
        "无法删除：该游戏商仍有关联的历史注单或结算数据，请先停用而不是删除",
        409,
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("游戏商不存在", 404);
    }

    console.error("删除游戏商失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

