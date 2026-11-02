import { connection, type NextRequest } from "next/server";

import { gameSelect, readBooleanInput, serializeGame } from "@/lib/game-api";
import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

/**
 * 后台游戏列表（超管）。
 *
 * GET /api/admin/games
 *   可选 query：
 *   - providerId：只看某个游戏商的游戏
 *   - isActive：true / false，不传表示全部
 *
 * 与前台 /api/games 的区别：这里包含已下架游戏，供后台上下架与排序管理使用。
 *
 * 开头 await connection()：本接口读 Cookie + query，永远不能在构建期预渲染
 * （cacheComponents 下不能再用 export const dynamic）。
 */
export async function GET(request: NextRequest) {
  await connection();

  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return Response.json(
        { error: "未登录或登录已过期，请重新登录" },
        { status: 401 },
      );
    }

    const params = request.nextUrl.searchParams;
    const providerId = params.get("providerId")?.trim() || null;
    const isActiveParam = params.get("isActive");
    const isActive =
      isActiveParam === null ? null : readBooleanInput(isActiveParam);

    if (isActiveParam !== null && isActive === null) {
      return Response.json(
        { error: "isActive 只能是 true 或 false" },
        { status: 400 },
      );
    }

    const games = await prisma.game.findMany({
      where: {
        ...(providerId ? { providerId } : {}),
        ...(isActive !== null ? { isActive } : {}),
      },
      orderBy: [
        { provider: { sortOrder: "desc" } },
        { sortOrder: "desc" },
        { name: "asc" },
      ],
      select: gameSelect,
    });

    return Response.json(
      { games: games.map(serializeGame) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取后台游戏列表失败:", error);
    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 },
    );
  }
}
