"use client";

import { useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  HeroCarouselArrows,
  HeroCarouselDots,
  useHeroRotation,
} from "@/components/lobby/hero-carousel";
import { HeroPosterImage } from "@/components/lobby/hero-poster-image";

/**
 * 大厅 Hero 海报轮播（后台「活动管理」上传的海报）。
 *
 * 与文本轮播（hero-carousel.tsx 的 HeroCarousel）的分工：
 * - 这里只负责「海报卡片 + 点击跳转」这一种版式（手机 = 圆角横幅卡片，
 *   电脑 = 满版海报），轮播节奏 / 暂停 / 箭头 / 圆点指示器全部复用
 *   hero-carousel.tsx 里的共享件，不复制第二套定时器；
 * - 后台**一张海报都没配**时，调用方（lobby-client.tsx）不会渲染本组件，
 *   而是退回原来的内置文案轮播（保底兜底）；本组件拿到空数组时返回 null。
 *
 * 为什么不用 next/image：海报来自商户上传或外站图床，域名白名单管不住，
 * 用原生 <img> 才能保证「传什么图就铺什么图」。
 *
 * 图片怎么摆：交给 hero-poster-image.tsx（手机单层 cover 铺满卡片，电脑双层
 * 模糊底 + contain 完整露出）。本文件**不许**自己写 object-fit —— 一套渲染只有一份，
 * 否则 5 套模板 + 后台预览迟早各裁各的。
 */

/** 本组件只关心这几个字段；PromotionBannerView 结构上兼容，不需要 import 服务端模块 */
export type HeroPromoBanner = {
  id: string;
  imageUrl: string;
  /**
   * 手机端专用海报（可选）。<768px 时用它铺满手机舞台；
   * 缺失时自动回落成「电脑图模糊底 + 完整显示」，不裁切（见 hero-poster-image.tsx）。
   */
  mobileImageUrl?: string | null;
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
      className="group relative overflow-hidden rounded-[var(--sf-panel-radius,1rem)] border border-brand/15 bg-[#070707] shadow-[0_28px_70px_-40px_rgba(0,0,0,0.95)]"
      {...handlers}
    >
      {/* 高度由 globals.css 的 [data-hero-stage] 统一给（clamp 夹在 200–220 / 240–320 / 350–450），
          这里**不许**再写 h-[var(--sf-hero-h…)]：两处给高度必然打架，正是图片忽高忽低的来源。
          5 套排版模板共用这一块舞台，模板只改宽度 / 间距 / 圆角 / 分栏。
          手机端这块舞台就是一张 200px 高的圆角卡片（横向留白在 lobby-client 的 mx-1），
          所以海报不会撑满整屏，下面的功能岛 / 品牌墙 / 游戏列表照常滚动。 */}
      <div className="relative w-full overflow-hidden" data-hero-stage>
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
                  // 手机：单层 object-cover 铺满圆角卡片（center 30% 保住面部 / 标题）；
                  // 电脑：底层 object-cover + 高斯模糊铺满舞台，顶层 object-contain
                  // 把整张图完整露出来 —— 竖图 / 方图 / 超宽图都不会被裁掉，
                  // 也不会留下生硬黑边（实现见 components/lobby/hero-poster-image.tsx）。
                  // 配了手机图时，<768px 自动切成手机图（同样 cover 铺满）。
                  <HeroPosterImage
                    src={banner.imageUrl}
                    mobileSrc={banner.mobileImageUrl}
                    alt={title}
                    eager={slideIndex === 0}
                    onError={() =>
                      setBrokenImages((current) => ({
                        ...current,
                        [banner.id]: true,
                      }))
                    }
                  />
                )}

                {/* 弱黑色渐变遮罩：海报偏亮时压住底部，圆点 / 箭头才看得清。
                    手机卡片只有 200px 高，所以渐变收窄到 1/3，别把整幅海报压暗。 */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 via-black/10 to-transparent sm:h-1/2 sm:via-black/20"
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
