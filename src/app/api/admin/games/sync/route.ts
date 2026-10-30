import type { NextRequest } from "next/server";

import {
  GameSyncError,
  syncAllActiveProviders,
  syncProviderGames,
} from "@/lib/game-sync";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

/**
 * 从游戏商拉取游戏并写入 Game 表（当前为 Mock 数据源）。
 *
 * POST /api/admin/games/sync
 *   body 二选一：
 *   - { providerId: "<游戏商 id>" }  → 只同步该游戏商
 *   - { all: true }                  → 同步所有「上架中」的游戏商（供定时任务调用）
 *
 * 返回每个游戏商的新增 / 更新数量。
 * 定时任务示例（Vercel Cron / 任意调度器）：
 *   curl -X POST https://<host>/api/admin/games/sync \
 *     -H "Cookie: token=<超管 token>" -H "Content-Type: application/json" \
 *     -d '{"all":true}'
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return Response.json(
        { error: "未登录或登录已过期，请重新登录" },
        { status: 401 },
      );
    }

    let body: unknown = {};

    try {
      body = await request.json();
    } catch {
      // 允许空 body：此时按 { all: false } 处理，并由下面的校验给出明确报错。
      body = {};
    }

    const input = (body ?? {}) as Record<string, unknown>;

    if (input.all === true) {
      const results = await syncAllActiveProviders();
      const created = results.reduce((sum, item) => sum + item.created, 0);
      const updated = results.reduce((sum, item) => sum + item.updated, 0);

      return Response.json({
        success: true,
        scope: "all" as const,
        results,
        totals: {
          providers: results.length,
          created,
          updated,
        },
      });
    }

    const providerId =
      typeof input.providerId === "string" ? input.providerId.trim() : "";

    if (!providerId) {
      return Response.json(
        { error: "请提供 providerId，或使用 { all: true } 同步全部游戏商" },
        { status: 400 },
      );
    }

    const result = await syncProviderGames(providerId);

    return Response.json({
      success: true,
      scope: "provider" as const,
      result,
    });
  } catch (error) {
    if (error instanceof GameSyncError) {
      return Response.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error("同步游戏失败:", error);
    return Response.json(
      { error: "同步失败，请稍后重试" },
      { status: 500 },
    );
  }
}
