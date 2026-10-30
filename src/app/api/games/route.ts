import type { NextRequest } from "next/server";

import { gameSelect, serializeGame } from "@/lib/game-api";
import { prisma } from "@/lib/prisma";

/**
 * 前台大厅游戏列表（公开接口，无需登录）。
 *
 * GET /api/games
 *   可选 query：
 *   - providerId：按游戏商筛选
 *   - category：按品类筛选（slot / live / fish）
 *
 * 只返回 isActive = true 的游戏，并按 sortOrder 降序排列（越大越靠前）。
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const providerId = params.get("providerId")?.trim() || null;
    const category = params.get("category")?.trim() || null;

    const games = await prisma.game.findMany({
      where: {
        isActive: true,
        ...(providerId ? { providerId } : {}),
        ...(category ? { category } : {}),
      },
      // 后台把 sortOrder 调高即置顶；同权重按名称稳定排序，避免刷新顺序跳动。
      orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
      select: gameSelect,
    });

    return Response.json(
      { games: games.map(serializeGame) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取游戏列表失败:", error);
    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 },
    );
  }
}
