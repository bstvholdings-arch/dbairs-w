import type { Metadata } from "next";
import { connection } from "next/server";

import { resolveBrandName } from "@/lib/brand";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import {
  loadPromotionBonusSummary,
  loadPromotionFeed,
} from "@/lib/promotions";
import { requireStorefront } from "@/lib/storefront-data";

import { PromotionsClient } from "./promotions-client";

/** `?tenant=` 只认第一个值并 trim；空串视作「没传」 */
function readTenantKey(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;

  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * 标签页标题必须跟着当前商户走：白标站如果标题写着平台名，
 * 玩家一眼就能看出这是套壳站。
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}): Promise<Metadata> {
  await connection();

  const params = await searchParams;
  const storefront = await requireStorefront(readTenantKey(params.tenant));
  const brand = resolveBrandName(storefront.tenantName);

  return {
    title: `Promotions | ${brand}`,
    description: `Daily missions, bonus cash and limited-time offers on ${brand}.`,
  };
}

export const instant = false;

/**
 * 活动大厅（Promotions）。
 *
 * - 租户上下文只走 requireStorefront()：`?tenant=` → 域名 / 子域名 → 商户会话 →
 *   代登录票据 → DEFAULT_TENANT，全都拿不到就 404「站点不存在」，
 *   绝不回落到任意租户（AGENTS.md 第 7 条）；
 * - 数据分两路：活动分类 / Banner 走 loadPromotionFeed（只读启用中的），
 *   顶部任务栏的「每日任务 + 彩金总额」走 loadPromotionBonusSummary（只读会话玩家）；
 * - 玩家会话必须属于当前站点：`?tenant=A` 而浏览器里是 B 站玩家的 Cookie 时，
 *   顶部彩金一律按「未登录」展示，不能把 B 站的账显示在 A 站页面上。
 */
export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  await connection();

  const params = await searchParams;
  const tenantKey = readTenantKey(params.tenant);
  const storefront = await requireStorefront(tenantKey);
  const session = await getPlayerSessionFromCookies();

  const player =
    session && storefront.tenantId && session.tenantId === storefront.tenantId
      ? { id: session.id, tenantId: session.tenantId }
      : null;

  const [feed, bonus] = await Promise.all([
    storefront.tenantId
      ? loadPromotionFeed(storefront.tenantId)
      : Promise.resolve({ categories: [], banners: [] }),
    loadPromotionBonusSummary(player),
  ]);

  return (
    <PromotionsClient
      themeColor={storefront.themeColor}
      tenantName={storefront.tenantName}
      tenantLogoUrl={storefront.tenantLogoUrl}
      currency={storefront.currency}
      initialFeed={feed}
      bonus={bonus}
      loggedIn={Boolean(player)}
      playerName={player ? (session?.username ?? null) : null}
      tenantKey={tenantKey}
    />
  );
}
