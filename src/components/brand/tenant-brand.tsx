"use client";

import { useState } from "react";

import { brandInitial, resolveBrandName } from "@/lib/brand";
import { normalizeTenantLogoUrl } from "@/lib/storefront";

/**
 * 商户品牌锁版（Logo + 商户名）：白标站点里所有「显示品牌」的地方都只用这一个组件。
 *
 * 三档尺寸覆盖现有全部场景：
 * - `lg` 大厅顶栏（主视觉，Logo 44/48px）；
 * - `md` 登录注册 / 玩家中心 / 实名认证顶栏；
 * - `sm` 预留的紧凑场景（弹窗头部等）。
 *
 * 关键行为：
 * - 有 logoUrl 就渲染商户自己的图，没配（或加载失败）用商户名首字母的金色方块占位，
 *   两者视觉重量一致，不会出现「一边 96px 一边 40px」的错位；
 * - 加载失败记的是**失败的那个地址**而不是布尔值：商户换掉 Logo 后自动重试新地址，
 *   同时避免在 effect 里 setState（React Compiler 禁止渲染期副作用）；
 * - 地址统一走 normalizeTenantLogoUrl 校验，后台填了 javascript: / data: 也注入不了。
 */

export type TenantBrandSize = "sm" | "md" | "lg";

type SizeStyle = {
  gap: string;
  tile: string;
  logo: string;
  name: string;
  tagline: string;
};

const SIZE_STYLES: Record<TenantBrandSize, SizeStyle> = {
  sm: {
    gap: "gap-2",
    tile: "h-9 w-9 rounded-lg text-[10px]",
    logo: "h-9 max-w-[120px]",
    name: "text-[13px] tracking-[0.16em]",
    tagline: "text-[8px] tracking-[0.28em]",
  },
  md: {
    gap: "gap-2.5",
    tile: "h-10 w-10 rounded-xl text-[11px]",
    logo: "h-10 max-w-[136px]",
    name: "text-[15px] tracking-[0.24em]",
    tagline: "text-[8px] tracking-[0.3em]",
  },
  lg: {
    gap: "gap-3 sm:gap-4",
    tile: "h-11 w-11 rounded-xl text-2xl tracking-tight sm:h-12 sm:w-12",
    logo: "h-11 max-w-[168px] sm:h-12 sm:max-w-[224px]",
    name: "text-xl tracking-[0.06em] sm:text-2xl",
    tagline: "text-[8px] tracking-[0.34em]",
  },
};

export function TenantBrandLockup({
  brandName,
  logoUrl,
  size = "md",
  tagline,
  taglineClassName = "block truncate",
  className = "",
}: {
  /** 商户品牌名（Tenant.name）；传空则回退平台名 */
  brandName?: string | null;
  /** 商户品牌 Logo（Tenant.logoUrl），未配置 / 非法地址都会退回首字母占位 */
  logoUrl?: string | null;
  size?: TenantBrandSize;
  /** 品牌名下方的小字（页面性质，如「玩家入口」），不传则不渲染 */
  tagline?: string;
  taglineClassName?: string;
  className?: string;
}) {
  const name = resolveBrandName(brandName);
  const normalizedLogoUrl = normalizeTenantLogoUrl(logoUrl);
  const [brokenLogoUrl, setBrokenLogoUrl] = useState<string | null>(null);
  const showLogo =
    Boolean(normalizedLogoUrl) && brokenLogoUrl !== normalizedLogoUrl;
  const style = SIZE_STYLES[size];

  return (
    <span className={`flex min-w-0 items-center ${style.gap} ${className}`}>
      {showLogo && normalizedLogoUrl ? (
        // 商户 Logo 来自任意图床 / CDN，next/image 的固定域名白名单管不住
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={normalizedLogoUrl}
          alt={name}
          draggable={false}
          onError={() => setBrokenLogoUrl(normalizedLogoUrl)}
          className={`w-auto shrink-0 object-contain drop-shadow-[0_0_20px_var(--sf-a45)] ${style.logo}`}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`relative flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-pale via-brand to-brand-deep font-black leading-none text-brand-ink shadow-[0_0_28px_-8px_var(--sf-a95)] ${style.tile}`}
        >
          {brandInitial(name)}
          <span className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/30" />
        </span>
      )}

      <span className="min-w-0 leading-none">
        <span
          className={`block truncate bg-gradient-to-r from-brand-pale via-brand-soft to-brand-deep bg-clip-text font-black text-transparent ${style.name}`}
        >
          {name}
        </span>
        {tagline ? (
          <span
            className={`mt-1.5 uppercase text-neutral-600 ${style.tagline} ${taglineClassName}`}
          >
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
