import { connection } from "next/server";

import { loadLobbyData } from "@/lib/lobby-data";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import { loadStorefront } from "@/lib/storefront-data";

import { LobbyClient, type LobbyPlayerSummary } from "./lobby-client";

export const metadata = {
  title: "DB AIRS | Player Lobby",
  description:
    "DB AIRS player lobby: hot slots, live casino and fishing games in one black-gold neon hall.",
};

export const instant = false;

export default async function PlayerLobbyPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  await connection();

  const params = await searchParams;
  const rawTenant = Array.isArray(params.tenant)
    ? params.tenant[0]
    : params.tenant;
  // ?tenant=<id|子域名|域名>：后台「预览前台」与白标联调用，不传则按域名 / 会话兜底
  const tenantKey =
    typeof rawTenant === "string" && rawTenant.trim() ? rawTenant.trim() : null;

  // 大厅首屏数据全部来自数据库（见 lib/lobby-data.ts）：
  // - providers：上架中的游戏商 → 品牌墙
  // - games：上架中的游戏，按 sortOrder 降序
  // - storefront：租户的 themeColor + layoutConfig（见 lib/storefront-data.ts）
  // 数据库不可用时返回空数组 / 默认金色主题，LobbyClient 会回退到内置游戏目录。
  const [{ providers, games }, storefront, playerSession] = await Promise.all([
    loadLobbyData(),
    loadStorefront(tenantKey),
    getPlayerSessionFromCookies(),
  ]);

  const initialPlayer: LobbyPlayerSummary | null = playerSession
    ? {
        id: playerSession.id,
        username: playerSession.username,
        balance: playerSession.balance,
        referralCode: playerSession.referralCode,
      }
    : null;

  return (
    <LobbyClient
      initialProviders={providers}
      initialGames={games}
      storefront={storefront}
      initialPlayer={initialPlayer}
    />
  );
}


