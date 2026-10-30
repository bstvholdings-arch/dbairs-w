import { cache } from "react";

import type { LobbyGameRecord, LobbyProviderOption } from "@/lib/lobby-games";
import { prisma } from "@/lib/prisma";

export type LobbySnapshot = {
  /**
   * 上架中（isActive）的全部游戏商，用于品牌墙、游戏商展馆解析。
   * 品牌墙要不要展示、排在第几位由 sortOrder / showInShowcase 决定，
   * 过滤与排序统一走 lib/provider-showcase.ts（后台排序面板也用它）。
   */
  providers: LobbyProviderOption[];
  /** 上架中的游戏，按 sortOrder 降序（后台调高排序即可置顶） */
  games: LobbyGameRecord[];
};

/**
 * 玩家前台（大厅 + 游戏商展馆）共用的首屏数据。
 *
 * - 只取上架中的游戏商与游戏；
 * - 数据库不可用时返回空数组，前端会回退到内置游戏目录，保证页面永远能打开；
 * - 用 React 的 cache() 包一层：同一次请求里 generateMetadata 与页面都调用时只查一次库。
 */
export const loadLobbyData = cache(async (): Promise<LobbySnapshot> => {
  try {
    const [providerRows, gameRows] = await Promise.all([
      prisma.gameProvider.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          sortOrder: true,
          showInShowcase: true,
          _count: { select: { games: true } },
        },
      }),
      prisma.game.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          providerId: true,
          category: true,
          sortOrder: true,
          provider: { select: { name: true } },
        },
      }),
    ]);

    return {
      providers: providerRows.map((provider) => ({
        id: provider.id,
        name: provider.name,
        gameCount: provider._count.games,
        sortOrder: provider.sortOrder,
        showInShowcase: provider.showInShowcase,
      })),
      games: gameRows.map((game) => ({
        id: game.id,
        name: game.name,
        providerId: game.providerId,
        providerName: game.provider.name,
        category: game.category,
        sortOrder: game.sortOrder,
      })),
    };
  } catch (error) {
    console.error("读取大厅数据失败，前台将回退到内置游戏目录:", error);

    return { providers: [], games: [] };
  }
});
