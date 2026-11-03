"use client";

import { useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  HeroCarouselArrows,
  HeroCarouselDots,
  useHeroRotation,
} from "@/components/lobby/hero-carousel";

/**
 * 大厅 Hero 海报轮播（后台「活动管理」上传的海报）。
 *
 * 与文本轮播（hero-carousel.tsx 的 HeroCarousel）的分工：
 * - 这里只负责「全屏铺图 + 点击跳转」这一种版式，轮播节奏 / 暂停 / 箭头 /
 *   圆点指示器全部复用 hero-carousel.tsx 里的共享件，不复制第二套定时器；
 * - 后台**一张海报都没配**时，调用方（lobby-client.tsx）不会渲染本组件，
 *   而是退回原来的内置文案轮播（保底兜底）；本组件拿到空数组时返回 null。
 *
 * 为什么不用 next/image：海报来自商户上传或外站图床，域名白名单管不住，
 * 用原生 <img> + object-cover 才能保证「传什么图就铺什么图」。
 */

/** 本组件只关心这几个字段；PromotionBannerView 结构上兼容，不需要 import 服务端模块 */
export type HeroPromoBanner = {
  id: string;
  imageUrl: string;
  linkUrl: string | null;
  title: string | null;
};

/** 站内地址在预览模式下幂等补上 `?tenant=`；外站链接原样返回 */
function withTenant(href: string, tenantKey: string | null) {
  if (!tenantKey || !href.startsWith("/")) {
    return href;
  }

  const [path, search = ""] = href.split("?");
  const params = new URLSearchParams(search);

  params.set("tenant", tenantKey);

  return `${path}?${params.toString()}`;
}

export function PromoHeroCarousel({
  banners,
  tenantKey = null,
}: {
  banners: HeroPromoBanner[];
  /** 预览模式下的租户标识：站内跳转必须透传，否则会掉出当前站点（AGENTS.md 第 7 条） */
  tenantKey?: string | null;
}) {
  const { t } = useLanguage();

  // 空图 / 纯空白图直接丢掉：宁可少一张，也不要在首屏留一块黑
  const slides = useMemo(
    () => banners.filter((banner) => Boolean(banner.imageUrl?.trim())),
    [banners],
  );

  const { index, paused, round, goTo, handlers } = useHeroRotation(slides.length);

  // 图片 404 / 图床被墙时降级成「品牌色底 + 活动标题」，不出现破图图标
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  if (slides.length === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={t("lobby.hero.carousel")}
      data-hero-promo="true"
      className="group relative overflow-hidden rounded-2xl border border-brand/15 bg-[#070707] shadow-[0_28px_70px_-40px_rgba(0,0,0,0.95)] sm:rounded-3xl"
      {...handlers}
    >
      {/* 高度沿用排版模板的 --sf-hero-h* 变量：5 套模板的海拔差异照旧生效 */}
      <div
        className="relative h-[var(--sf-hero-h,250px)] w-full sm:h-[var(--sf-hero-h-sm,286px)] lg:h-[var(--sf-hero-h-lg,330px)]"
        data-hero-stage
      >
        {slides.map((banner, slideIndex) => {
          const active = slideIndex === index;
          const href = banner.linkUrl?.trim()
            ? withTenant(banner.linkUrl.trim(), tenantKey)
            : null;
          const external = Boolean(href && /^https?:\/\//i.test(href));
          const title = banner.title?.trim() || t("promotions.banner.fallback");
          const broken = Boolean(brokenImages[banner.id]);

          return (
            <article
              key={banner.id}
              aria-roledescription="slide"
              aria-label={`${slideIndex + 1} / ${slides.length}`}
              aria-hidden={active ? undefined : true}
              className={`absolute inset-0 overflow-hidden transition-all duration-700 ease-out motion-reduce:transition-none ${
                active
                  ? "translate-x-0 scale-100 opacity-100"
                  : "pointer-events-none translate-x-3 scale-[1.02] opacity-0"
              }`}
            >
              <a
                href={href ?? undefined}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                tabIndex={active && href ? 0 : -1}
                aria-label={
                  href ? t("promotions.banner.aria", { title }) : undefined
                }
                aria-disabled={href ? undefined : true}
                className={`relative block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-soft/70 ${
                  href ? "cursor-pointer" : "cursor-default"
                }`}
              >
                {broken ? (
                  <span className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,var(--sf-a18),#0b0b0b_60%,#080808)] px-6 text-center">
                    <span className="text-sm font-bold text-brand-pale">
                      {title}
                    </span>
                  </span>
                ) : (
                  // 商户上传 / 外站图床的图，next/image 域名白名单管不住
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={banner.imageUrl}
                    alt={title}
                    draggable={false}
                    loading={slideIndex === 0 ? "eager" : "lazy"}
                    fetchPriority={slideIndex === 0 ? "high" : "auto"}
                    onError={() =>
                      setBrokenImages((current) => ({
                        ...current,
                        [banner.id]: true,
                      }))
                    }
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}

                {/* 弱黑色渐变遮罩：海报偏亮时压住底部，圆点 / 箭头才看得清 */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 via-black/20 to-transparent"
                />
              </a>
            </article>
          );
        })}
      </div>

      {/* 与文本轮播同一套控件：小圆点随图片切换高亮，当前点走 5 秒金色进度条 */}
      <HeroCarouselArrows total={slides.length} index={index} goTo={goTo} />

      <HeroCarouselDots
        total={slides.length}
        index={index}
        round={round}
        paused={paused}
        goTo={goTo}
      />
    </div>
  );
}
