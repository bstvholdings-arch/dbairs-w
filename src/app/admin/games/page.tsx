import { connection } from "next/server";

import { gameSelect, serializeGame } from "@/lib/game-api";
import { prisma } from "@/lib/prisma";

import { GamesClient } from "./games-client";
import type { AdminGameRow, AdminProviderOption } from "./types";

export const metadata = {
  title: "Game Library | DBAIRS Super Admin",
  description:
    "Control per-game sort order and storefront visibility for the player lobby.",
};

export const instant = false;

/** 仅开发环境打印调试日志。 */
const DEBUG = process.env.NODE_ENV !== "production";

/**
 * 把 URL 里的 providerId 解析成真实的游戏商 id。
 *
 * 正常情况是 uuid；但手工改 URL / 老链接里可能是游戏商名称（如「PG Soft」），
 * 这时按名称兜底匹配，避免出现「带了筛选参数却查出全部游戏」的错觉。
 */
function resolveProviderId(
  providers: Array<{ id: string; name: string }>,
  rawProviderId: string | null,
) {
  if (!rawProviderId) {
    return null;
  }

  const byId = providers.find((provider) => provider.id === rawProviderId);

  if (byId) {
    return byId.id;
  }

  const normalized = rawProviderId.toLowerCase();
  const byName = providers.find(
    (provider) => provider.name.toLowerCase() === normalized,
  );

  return byName ? byName.id : null;
}

export default async function AdminGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ providerId?: string | string[] }>;
}) {
  await connection();

  const params = await searchParams;
  const rawProviderId = Array.isArray(params.providerId)
    ? params.providerId[0]
    : params.providerId;
  const requestedProviderId =
    typeof rawProviderId === "string" && rawProviderId.trim()
      ? rawProviderId.trim()
      : null;

  const providers = await prisma.gameProvider.findMany({
    orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true },
  });

  const providerId = resolveProviderId(providers, requestedProviderId);

  const games = await prisma.game.findMany({
    where: providerId ? { providerId } : {},
    // 与大厅一致的排序口径：游戏商排序 → 游戏排序 → 名称
    orderBy: [
      { provider: { sortOrder: "desc" } },
      { sortOrder: "desc" },
      { name: "asc" },
    ],
    select: gameSelect,
  });

  if (DEBUG) {
    console.log("[admin/games] SSR query", {
      requestedProviderId,
      resolvedProviderId: providerId,
      providers: providers.map((provider) => provider.name),
      games: games.length,
    });
  }

  const rows: AdminGameRow[] = games.map((game) => {
    const serialized = serializeGame(game);

    return {
      id: serialized.id,
      name: serialized.name,
      externalId: serialized.externalId,
      providerId: serialized.providerId,
      providerName: serialized.providerName,
      category: serialized.category,
      sortOrder: serialized.sortOrder,
      isActive: serialized.isActive,
      syncedAt: serialized.syncedAt,
    };
  });

  const providerOptions: AdminProviderOption[] = providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    isActive: provider.isActive,
  }));

  return (
    <GamesClient
      initialGames={rows}
      providers={providerOptions}
      activeProviderId={providerId}
      unresolvedProviderId={
        requestedProviderId && !providerId ? requestedProviderId : null
      }
    />
  );
}
