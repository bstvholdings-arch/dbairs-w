import { fetchMockProviderGames, type MockGameSeed } from "./game-catalog";
import { prisma } from "./prisma";

/**
 * 游戏同步服务。
 *
 * 目前「拉取」这一步是 Mock（game-catalog.ts），生产接入时把它换成游戏商
 * OpenAPI / 文件导出即可，写库逻辑无需改动。
 *
 * 预留定时任务：`/api/admin/games/sync` 支持 { all: true }，
 * 可以被 Vercel Cron、GitHub Actions 或任意调度器定时 POST 调用，
 * 也可以直接在服务端脚本里 import syncAllActiveProviders()。
 */
export class GameSyncError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GameSyncError";
    this.status = status;
  }
}

export type GameSyncResult = {
  providerId: string;
  providerName: string;
  /** 本次从游戏商拉到的游戏数量 */
  fetched: number;
  /** 新入库的游戏数量 */
  created: number;
  /** 已存在而被更新的游戏数量 */
  updated: number;
};

async function writeCatalog(
  provider: { id: string; name: string },
  catalog: MockGameSeed[],
): Promise<GameSyncResult> {
  if (catalog.length === 0) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      fetched: 0,
      created: 0,
      updated: 0,
    };
  }

  const existing = await prisma.game.findMany({
    where: {
      providerId: provider.id,
      externalId: { in: catalog.map((seed) => seed.externalId) },
    },
    select: { externalId: true },
  });

  const existingIds = new Set(existing.map((row) => row.externalId));
  const syncedAt = new Date();

  await prisma.$transaction(
    catalog.map((seed) =>
      prisma.game.upsert({
        where: {
          providerId_externalId: {
            providerId: provider.id,
            externalId: seed.externalId,
          },
        },
        create: {
          providerId: provider.id,
          externalId: seed.externalId,
          name: seed.name,
          category: seed.category,
          sortOrder: seed.sortOrder,
          isActive: true,
          syncedAt,
        },
        // 只覆盖上游字段：后台配置过的 sortOrder / isActive 不会被同步冲掉。
        update: {
          name: seed.name,
          category: seed.category,
          syncedAt,
        },
      }),
    ),
  );

  return {
    providerId: provider.id,
    providerName: provider.name,
    fetched: catalog.length,
    created: catalog.length - existingIds.size,
    updated: existingIds.size,
  };
}

/** 同步单个游戏商的游戏列表。 */
export async function syncProviderGames(
  providerId: string,
): Promise<GameSyncResult> {
  const provider = await prisma.gameProvider.findUnique({
    where: { id: providerId },
    select: { id: true, name: true },
  });

  if (!provider) {
    throw new GameSyncError("游戏商不存在", 404);
  }

  return writeCatalog(provider, fetchMockProviderGames(provider.name));
}

/** 同步所有「上架中」游戏商的游戏列表（供定时任务一次性跑全量）。 */
export async function syncAllActiveProviders(): Promise<GameSyncResult[]> {
  const providers = await prisma.gameProvider.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  const results: GameSyncResult[] = [];

  for (const provider of providers) {
    results.push(await writeCatalog(provider, fetchMockProviderGames(provider.name)));
  }

  return results;
}
