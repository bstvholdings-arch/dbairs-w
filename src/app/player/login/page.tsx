import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { PlayerAuthForm } from "@/components/player/player-auth-form";
import { resolveBrandName } from "@/lib/brand";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import { loadStorefront } from "@/lib/storefront-data";

/**
 * 标签页标题跟着当前商户走（白标站不能写死平台名）。
 * loadStorefront 已用 React cache 包过，与页面主体共用同一次查询。
 */
export async function generateMetadata(): Promise<Metadata> {
  // cacheComponents 下 headers() 属于请求期数据：显式 connection() 后再取，构建期不会误预渲染
  await connection();

  const storefront = await loadStorefront();
  const brand = resolveBrandName(storefront.tenantName);

  return {
    title: `Player Login | ${brand}`,
    description: `Sign in to your ${brand} player wallet and game history.`,
  };
}

export const instant = false;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

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
  }>;
}) {
  // jwt.verify 内部会用 Date.now() 校验过期时间，属于请求期数据：
  // 先 connection() 显式声明动态渲染（与 /player/kyc、根页保持一致）。
  await connection();

  const params = await searchParams;
  const nextPath = safeNextPath(readParam(params.next));
  const session = await getPlayerSessionFromCookies();

  if (session) {
    redirect(nextPath || "/");
  }

  // 品牌名 / Logo / 主色都来自当前访问的租户，未登录也能正确白标
  const storefront = await loadStorefront();

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
