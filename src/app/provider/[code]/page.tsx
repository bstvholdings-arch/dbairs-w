import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { resolveBrandName } from "@/lib/brand";
import { loadLobbyData } from "@/lib/lobby-data";
import {
  buildCardsFromRecords,
  buildMockLobby,
  type LobbyGameCard,
  type LobbyProviderOption,
} from "@/lib/lobby-games";
import { providerSlug } from "@/lib/lobby-providers";
import { requireStorefront } from "@/lib/storefront-data";

import { ProviderHallClient } from "./provider-hall-client";

export const instant = false;

type ProviderHall = {
  name: string;
  /** 该游戏商下的全部游戏卡片 */
  cards: LobbyGameCard[];
  /** 除当前游戏商以外的品牌（展馆底部的「其他游戏商」） */
  others: LobbyProviderOption[];
  /** providerId → 基础在线人数合计（序列化后传给客户端） */
  onlineTotals: Record<string, number>;
};

/**
 * 按 URL 里的 code 解析游戏商展馆。
 *
 * code 是游戏商名称的 slug（PG Soft → pg-soft、scr888h5 → scr888h5），
 * 客户端品牌墙的跳转地址与这里的解析共用 lib/lobby-providers.ts 的同一套规则，
 * 因此不会出现「点进去 404」的错位。
 * 数据库可用时用数据库数据，否则回退到内置游戏目录。
 */
async function resolveProviderHall(code: string): Promise<ProviderHall | null> {
  const { providers: dbProviders, games: dbGames } = await loadLobbyData();
  const mock = buildMockLobby();

  const providers = dbProviders.length > 0 ? dbProviders : mock.providers;
  const cards = dbGames.length > 0 ? buildCardsFromRecords(dbGames) : mock.cards;
  const slug = code.trim().toLowerCase();

  const target = providers.find(
    (provider) => providerSlug(provider.name) === slug,
  );

  if (!target) {
    return null;
  }

  const onlineTotals: Record<string, number> = {};

  for (const card of cards) {
    if (!card.providerId) {
      continue;
    }

    onlineTotals[card.providerId] =
      (onlineTotals[card.providerId] ?? 0) + card.online;
  }

  return {
    name: target.name,
    cards: cards.filter((card) => card.providerId === target.id),
    others: providers.filter((provider) => provider.id !== target.id),
    onlineTotals,
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tenant?: string | string[] }>;
}): Promise<Metadata> {
  const { code } = await params;
  const query = await searchParams;
  const rawTenant = Array.isArray(query.tenant) ? query.tenant[0] : query.tenant;
  const tenantKey =
    typeof rawTenant === "string" && rawTenant.trim() ? rawTenant.trim() : null;

  // 展馆页的标题同样跟着当前商户走（白标站不能露出平台名）；
  // 站点不存在时 requireStorefront 直接 404，不会借用别家的品牌名。
  const [hall, storefront] = await Promise.all([
    resolveProviderHall(code),
    requireStorefront(tenantKey),
  ]);
  const name = hall?.name ?? code;
  const brandName = resolveBrandName(storefront.tenantName);

  return {
    title: `${name} Hall | ${brandName}`,
    description: `Play every ${name} slot, live and fishing game inside the ${brandName} ${name} hall.`,
  };
}

export default async function ProviderHallPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const rawTenant = Array.isArray(query.tenant) ? query.tenant[0] : query.tenant;
  const tenantKey =
    typeof rawTenant === "string" && rawTenant.trim() ? rawTenant.trim() : null;

  const hall = await resolveProviderHall(code);

  // 未知品牌先抛 404，再进入动态渲染：这样 not-found 边界能接管整页，
  // 而不是在页面已经开始流式输出之后才替换内容。
  if (!hall) {
    notFound();
  }

  await connection();

  // 展馆与大厅共用同一套装修配置：主色一致，品牌页才不会「换个页面换个颜色」
  const storefront = await requireStorefront(tenantKey);

  return (
    <ProviderHallClient
      providerName={hall.name}
      cards={hall.cards}
      otherProviders={hall.others}
      onlineTotals={hall.onlineTotals}
      themeColor={storefront.themeColor}
      themeBrightness={storefront.themeBrightness}
      themeBackground={storefront.themeBackground}
      languageStyle={storefront.languageStyle}
      brandName={resolveBrandName(storefront.tenantName)}
    />
  );
}
