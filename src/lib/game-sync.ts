import type { MockGameSeed } from "./game-catalog";
import {
  fetchProviderCatalog,
  resolveGameProviderConnection,
  type ProviderRequestTrace,
} from "./game-provider";
import { prisma } from "./prisma";

/**
 * 游戏同步服务。
 *
 * 「拉取」这一步交给 src/lib/game-provider.ts：先读 GameProvider 里的
 * apiEndpoint / merchantId / apiSecret 组装出真实接入时会发出的请求（含签名），
 * 目前返回 Mock 目录。拿到 PG Soft 等厂商的《API 接口对接文档》后，
 * 只需要改 fetchProviderCatalog()，本文件的写库逻辑完全不用动。
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

/** 同步时需要的游戏商字段：既包含展示信息，也包含 API 对接凭据。 */
const syncProviderSelect = {
  id: true,
  name: true,
  apiEndpoint: true,
  merchantId: true,
  apiSecret: true,
} as const;

type SyncProviderSource = {
  id: string;
  name: string;
  apiEndpoint: string | null;
  merchantId: string | null;
  apiSecret: string | null;
};

type GameCatalogWrite = {
  /** 本次从游戏商拉到的游戏数量 */
  fetched: number;
  /** 新入库的游戏数量 */
  created: number;
  /** 已存在而被更新的游戏数量 */
  updated: number;
};

export type GameSyncResult = GameCatalogWrite & {
  providerId: string;
  providerName: string;
  /** 真实接口接入前，拉取动作一律为模拟 */
  mode: "mock";
  /** endpoint + merchantId + apiSecret 是否齐全 */
  configured: boolean;
  /** 配置缺失 / 非法的可读提示 */
  warnings: string[];
  /** 模拟请求描述：真实 URL、商户号、签名前缀（不含密钥明文） */
  request: ProviderRequestTrace;
};


async function writeCatalog(
  provider: { id: string; name: string },
  catalog: MockGameSeed[],
): Promise<GameCatalogWrite> {
  if (catalog.length === 0) {
    return { fetched: 0, created: 0, updated: 0 };
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
          // 上游给了封面图就一起入库（大厅卡片主体就是这张图）
          iconUrl: seed.iconUrl?.trim() || null,
          isActive: true,
          syncedAt,
        },
        // 只覆盖上游字段：后台配置过的 sortOrder / isActive 不会被同步冲掉。
        update: {
          name: seed.name,
          category: seed.category,
          // 这次上游没给封面图时保留库里已有的图，避免把手工补的封面清空
          ...(seed.iconUrl?.trim() ? { iconUrl: seed.iconUrl.trim() } : {}),
          syncedAt,
        },
      }),
    ),
  );

  return {
    fetched: catalog.length,
    created: catalog.length - existingIds.size,
    updated: existingIds.size,
  };
}

/**
 * 同步单个游戏商：
 * 1. 读配置（endpoint / merchantId / apiSecret）→ 解析成连接信息；
 * 2. 「请求」游戏商拉列表（当前 Mock，附带模拟请求描述）；
 * 3. upsert 进 Game 表，并回传配置告警，方便后台判断离真实对接还差什么。
 */
async function syncProvider(
  provider: SyncProviderSource,
): Promise<GameSyncResult> {
  const connection = resolveGameProviderConnection(provider);
  const { games, request } = await fetchProviderCatalog(connection);
  const written = await writeCatalog(provider, games);

  return {
    providerId: provider.id,
    providerName: provider.name,
    ...written,
    mode: "mock",
    configured: connection.configured,
    warnings: connection.warnings,
    request,
  };
}

/** 同步单个游戏商的游戏列表。 */
export async function syncProviderGames(
  providerId: string,
): Promise<GameSyncResult> {
  const provider = await prisma.gameProvider.findUnique({
    where: { id: providerId },
    select: syncProviderSelect,
  });

  if (!provider) {
    throw new GameSyncError("游戏商不存在", 404);
  }

  return syncProvider(provider);
}

/** 同步所有「上架中」游戏商的游戏列表（供定时任务一次性跑全量）。 */
export async function syncAllActiveProviders(): Promise<GameSyncResult[]> {
  const providers = await prisma.gameProvider.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
    select: syncProviderSelect,
  });

  const results: GameSyncResult[] = [];

  for (const provider of providers) {
    results.push(await syncProvider(provider));
  }

  return results;
}

