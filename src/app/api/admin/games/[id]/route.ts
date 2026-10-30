import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  gameSelect,
  readBooleanInput,
  readSortOrderInput,
  serializeGame,
} from "@/lib/game-api";
import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

type GameRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * 后台调整单个游戏：排序权重 / 上架状态。
 *
 * PATCH /api/admin/games/[id]
 *   body: { sortOrder?: number, isActive?: boolean }
 *
 * 只允许改这两个字段：名称与品类由游戏同步覆盖，避免与上游不一致。
 */
export async function PATCH(
  request: NextRequest,
  context: GameRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id } = await context.params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;

    if (!hasOwn(input, "sortOrder") && !hasOwn(input, "isActive")) {
      return jsonError("请提供 sortOrder 或 isActive", 400);
    }

    let sortOrder: number | null = null;

    if (hasOwn(input, "sortOrder")) {
      sortOrder = readSortOrderInput(input.sortOrder);

      if (sortOrder === null) {
        return jsonError("排序权重必须是 0 ~ 999999 的整数", 400);
      }
    }

    let isActive: boolean | null = null;

    if (hasOwn(input, "isActive")) {
      isActive = readBooleanInput(input.isActive);

      if (isActive === null) {
        return jsonError("isActive 只能是 true 或 false", 400);
      }
    }

    const game = await prisma.game.update({
      where: { id },
      data: {
        ...(sortOrder !== null ? { sortOrder } : {}),
        ...(isActive !== null ? { isActive } : {}),
      },
      select: gameSelect,
    });

    return Response.json({
      success: true,
      game: serializeGame(game),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("游戏不存在", 404);
    }

    console.error("更新游戏失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
