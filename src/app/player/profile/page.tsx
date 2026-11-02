import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  PlayerProfileClient,
  type PlayerProfileTab,
} from "./player-profile-client";
import { resolveBrandName } from "@/lib/brand";
import { getPlayerProfileData } from "@/lib/player-profile";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import { requireStorefront } from "@/lib/storefront-data";

/**
 * 标签页标题跟着当前商户走（白标站不能写死平台名）。
 * requireStorefront 与页面主体共用同一份解析结果（React cache）；
 * 站点不存在时直接 404，不会借用别家的品牌名。
 */
export async function generateMetadata(): Promise<Metadata> {
  // cacheComponents 下 headers() 属于请求期数据：显式 connection() 后再取，构建期不会误预渲染
  await connection();

  const storefront = await requireStorefront();
  const brand = resolveBrandName(storefront.tenantName);

  return {
    title: `Player Center | ${brand}`,
    description: `Manage your ${brand} wallet, deposit history, security and referral rewards.`,
  };
}

export const instant = false;

const TABS: PlayerProfileTab[] = ["wallet", "history", "security", "referral"];

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readTab(value: string): PlayerProfileTab {
  return TABS.find((item) => item === value) ?? "wallet";
}

export default async function PlayerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  // cacheComponents 下 cookies()/jwt.verify 属于请求期数据（jwt 内部读 Date.now 校验过期），
  // 先显式 connection() 让本段在请求时渲染，避免预渲染阶段触碰不稳定值。
  await connection();

  const params = await searchParams;
  const session = await getPlayerSessionFromCookies();

  if (!session) {
    const tab = readParam(params.tab);
    redirect(
      `/player/login?next=${encodeURIComponent(
        tab ? `/player/profile?tab=${tab}` : "/player/profile",
      )}`,
    );
  }

  const profile = await getPlayerProfileData(session);

  return (
    <PlayerProfileClient
      profile={profile}
      initialTab={readTab(readParam(params.tab))}
    />
  );
}
