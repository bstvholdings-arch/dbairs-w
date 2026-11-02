import type { Metadata } from "next";
import { connection } from "next/server";

import { resolveBrandName } from "@/lib/brand";
import { loadLobbyData } from "@/lib/lobby-data";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import { loadStorefront } from "@/lib/storefront-data";

import { LobbyClient, type LobbyPlayerSummary } from "./lobby-client";

/**
 * 标签页标题必须跟着当前租户走：白标站如果标题写着平台名，
 * 玩家一眼就能看出这是套壳站。品牌名解析口径与大厅顶栏完全一致
 * （?tenant= → 访问域名 → 已登录商户 → 默认租户），见 lib/storefront-data.ts；
 * 兜底名与首字母规则见 lib/brand.ts。
 * loadStorefront 用 React cache 包过，与下面页面主体共用同一次查询。
 */
export async function generateMetadata(): Promise<Metadata> {
  const storefront = await loadStorefront();
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
    />
  );
}


