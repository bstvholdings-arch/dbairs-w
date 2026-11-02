import type { Metadata } from "next";
import { connection } from "next/server";

import { resolveBrandName } from "@/lib/brand";
import { loadLobbyData } from "@/lib/lobby-data";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import { requireStorefront } from "@/lib/storefront-data";

import { LobbyClient, type LobbyPlayerSummary } from "./lobby-client";

/** `?tenant=` 只认第一个值并 trim；空串视作「没传」 */
function readTenantKey(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;

  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * 标签页标题必须跟着当前租户走：白标站如果标题写着平台名，
 * 玩家一眼就能看出这是套壳站。
 *
 * requireStorefront 与页面主体共用同一份解析结果（React cache）；
 * 站点不存在时这里也会 404，不会先吐一个「别家站点」的标题。
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const storefront = await requireStorefront(readTenantKey(params.tenant));
  const brandName = resolveBrandName(storefront.tenantName);

  return {
    title: `${brandName} | Player Lobby`,
    description: `${brandName} player lobby: hot slots, live casino and fishing games in one hall.`,
  };
}

export const instant = false;

export default async function PlayerLobbyPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  await connection();

  const params = await searchParams;
  // ?tenant=<id|子域名|域名>：后台「预览前台」与白标联调用。
  // 传了就必须严格命中这个租户；查不到直接 404「站点不存在」，
  // 绝不回落到「最早创建的租户」——那正是「代登录 abc 却看到 winvora」的根因。
  const tenantKey = readTenantKey(params.tenant);

  // 大厅首屏数据全部来自数据库（见 lib/lobby-data.ts）：
  // - providers：上架中的游戏商 → 品牌墙
  // - games：上架中的游戏，按 sortOrder 降序
  // - storefront：租户的 themeColor + layoutConfig（见 lib/storefront-data.ts）
  // 数据库不可用时返回空数组 / 默认金色主题，LobbyClient 会回退到内置游戏目录。
  const [{ providers, games }, storefront, playerSession] = await Promise.all([
    loadLobbyData(),
    requireStorefront(tenantKey),
    getPlayerSessionFromCookies(),
  ]);

  const initialPlayer: LobbyPlayerSummary | null = playerSession
    ? {
        id: playerSession.id,
        username: playerSession.username,
        balance: playerSession.balance,
        pendingWithdrawalAmount: playerSession.pendingWithdrawalAmount,
        availableBalance: playerSession.availableBalance,
        referralCode: playerSession.referralCode,
      }
    : null;

  return (
    <LobbyClient
      initialProviders={providers}
      initialGames={games}
      storefront={storefront}
      initialPlayer={initialPlayer}
      previewTenantKey={tenantKey}
    />
  );
}


