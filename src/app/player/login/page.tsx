import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { PlayerAuthForm } from "@/components/player/player-auth-form";
import { resolveBrandName } from "@/lib/brand";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import { requireStorefront } from "@/lib/storefront-data";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * 登录页属于哪个站：优先 `?site=`（大厅传来的租户标识），其次 `?tenant=`。
 * 空串 = 没指定，交给 requireStorefront 按域名 / 会话解析。
 */
function readSiteKey(params: {
  site?: string | string[];
  tenant?: string | string[];
}) {
  const raw = readParam(params.site).trim() || readParam(params.tenant).trim();

  return raw || null;
}

/** 拿不到租户标识时回 `/`（按域名 / 会话解析），拿到则带回租户 */
function lobbyHrefFromKey(key: string | null) {
  return key ? `/?tenant=${encodeURIComponent(key)}` : "/";
}

/**
 * 标签页标题跟着当前商户走（白标站不能写死平台名）。
 * requireStorefront 找不到站点会直接 404，不会借用别家的品牌名。
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{
    site?: string | string[];
    tenant?: string | string[];
  }>;
}): Promise<Metadata> {
  // cacheComponents 下 headers() 属于请求期数据：显式 connection() 后再取，构建期不会误预渲染
  await connection();

  const storefront = await requireStorefront(readSiteKey(await searchParams));
  const brand = resolveBrandName(storefront.tenantName);

  return {
    title: `Player Login | ${brand}`,
    description: `Sign in to your ${brand} player wallet and game history.`,
  };
}

export const instant = false;

function safeNextPath(value: string) {
  const next = value.trim();

  if (!next.startsWith("/") || next.startsWith("//")) {
    return "";
  }

  return next;
}

export default async function PlayerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    site?: string | string[];
    tenant?: string | string[];
  }>;
}) {
  // jwt.verify 内部会用 Date.now() 校验过期时间，属于请求期数据：
  // 先 connection() 显式声明动态渲染（与 /player/kyc、根页保持一致）。
  await connection();

  const params = await searchParams;
  const nextPath = safeNextPath(readParam(params.next));
  const session = await getPlayerSessionFromCookies();

  if (session) {
    // 已登录：回大厅时必须保留租户标识，否则本地（无域名）会落到 404
    redirect(nextPath || lobbyHrefFromKey(readSiteKey(params)));
  }

  // 品牌名 / Logo / 主色都来自当前访问的租户，未登录也能正确白标。
  // 站点不存在时这里 404，绝不显示别家商户的登录页。
  const storefront = await requireStorefront(readSiteKey(params));

  return (
    <PlayerAuthForm
      mode="login"
      nextPath={nextPath}
      site={readParam(params.site)}
      referralCode=""
      brandName={resolveBrandName(storefront.tenantName)}
      brandLogoUrl={storefront.tenantLogoUrl}
      themeColor={storefront.themeColor}
    />
  );
}
