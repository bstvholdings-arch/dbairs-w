"use client";

import { useCallback, useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { GameEmblem } from "@/components/lobby/game-emblem";
import {
  HERO_ROTATE_MS,
  type LobbyBanner,
  type LobbyBannerArt,
} from "@/lib/lobby-banners";
import type { LobbyGameEmblem } from "@/lib/lobby-games";

/** 每张横幅下方挂的实时数据（由大厅计算后传进来） */
export type HeroBannerMetric = {
  label: string;
  value: string;
  /** 可选增量，例如奖池刚刚上涨的 +$3.42（渲染成绿色小徽章） */
  gain?: string;
};

/** 内置占位图形：复用 GameEmblem 的图形，避免再画三套 SVG */
const ART_EMBLEM: Record<LobbyBannerArt, LobbyGameEmblem> = {
  jackpot: "coin",
  slots: "reels",
  live: "cards",
};

/**
 * 大厅 Hero 广告轮播。
 *
 * - 纯 CSS 过渡（opacity + translate + scale）做淡入淡出 + 轻微滑动，
 *   不引入 Framer Motion，客户端包体保持最小；
 * - 每 HERO_ROTATE_MS（5 秒）自动切一张：悬停 / 键盘聚焦时暂停，
 *   标签页切到后台（document.hidden）也跳过推进，回来不会「连跳」；
 * - 尊重 prefers-reduced-motion：过渡与进度条动画都会关掉；
 * - 有 imageUrl 时用后台图当背景，没有则回退到内置 SVG 占位图。
 *
 * TODO: 此处需读取后台配置的 Banner 图片和跳转链接（见 lib/lobby-banners.ts）。
 */
export function HeroCarousel({
  banners,
  metrics,
  onAction,
}: {
  banners: LobbyBanner[];
  /** bannerId → 实时指标 */
  metrics: Record<string, HeroBannerMetric | undefined>;
  onAction: (banner: LobbyBanner) => void;
}) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // 重新计时的令牌：手动切页后进度条与定时器都从 0 起算。
  const [round, setRound] = useState(0);

  const total = banners.length;

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) {
        return;
      }

      setIndex(((next % total) + total) % total);
      setRound((current) => current + 1);
    },
    [total],
  );

  useEffect(() => {
    if (paused || total <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.hidden) {
        return;
      }

      setIndex((current) => (current + 1) % total);
      setRound((current) => current + 1);
    }, HERO_ROTATE_MS);

    return () => window.clearInterval(timer);
  }, [paused, round, total]);

  if (total === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={t("lobby.hero.carousel")}
      className="group relative overflow-hidden rounded-2xl border border-brand/15 bg-[#070707] shadow-[0_28px_70px_-40px_rgba(0,0,0,0.95)] sm:rounded-3xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          goTo(index - 1);
        }

        if (event.key === "ArrowRight") {
          event.preventDefault();
          goTo(index + 1);
        }
      }}
    >
      <div className="relative h-[250px] w-full sm:h-[286px] lg:h-[330px]">
        {banners.map((banner, slideIndex) => {
          const active = slideIndex === index;
          const metric = metrics[banner.id];

          return (
            <article
              key={banner.id}
              aria-roledescription="slide"
              aria-label={`${slideIndex + 1} / ${total}`}
              aria-hidden={active ? undefined : true}
              className={`absolute inset-0 transition-all duration-700 ease-out motion-reduce:transition-none ${
                active
                  ? "translate-x-0 scale-100 opacity-100"
                  : "pointer-events-none translate-x-3 scale-[1.02] opacity-0"
              }`}
            >
              {/* 背景层：后台图片（如果有）+ 渐变叠色 + 细网格 + SVG 占位图形 */}
              <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
                {banner.imageUrl ? (
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-70"
                    style={{ backgroundImage: `url(${banner.imageUrl})` }}
                  />
                ) : null}
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `radial-gradient(120% 130% at 8% 0%, ${banner.accent}38, transparent 58%), radial-gradient(100% 120% at 92% 12%, ${banner.secondary}88, transparent 62%), linear-gradient(115deg, rgba(4,4,4,0.96) 12%, rgba(4,4,4,0.55) 58%, rgba(4,4,4,0.88) 100%)`,
                  }}
                />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:46px_46px] [mask-image:linear-gradient(to_right,black,transparent_78%)] [-webkit-mask-image:linear-gradient(to_right,black,transparent_78%)]" />
                <div
                  className="absolute -right-4 top-1/2 hidden -translate-y-1/2 sm:block"
                  style={{ color: banner.accent }}
                >
                  <GameEmblem
                    emblem={ART_EMBLEM[banner.art]}
                    className={`h-48 w-48 opacity-[0.18] transition-transform duration-[1400ms] ease-out motion-reduce:transition-none lg:h-56 lg:w-56 ${
                      active ? "translate-x-0 rotate-0" : "translate-x-6 rotate-6"
                    }`}
                  />
                </div>
              </div>

              {/* 内容层 */}
              <div className="relative flex h-full flex-col justify-center gap-2 px-3.5 py-4 sm:gap-2.5 sm:px-8 sm:py-7 lg:px-11">
                <span
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.24em]"
                  style={{
                    borderColor: `${banner.accent}55`,
                    backgroundColor: "rgba(0,0,0,0.42)",
                    color: banner.accent,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 animate-pulse rounded-full motion-reduce:animate-none"
                    style={{ backgroundColor: banner.accent }}
                  />
                  {banner.kicker}
                </span>

                {/* h1：大厅主标题放在第一张横幅上，其余横幅降级为 h2 语义 */}
                {slideIndex === 0 ? (
                  <h1 className="line-clamp-2 max-w-[16ch] text-[21px] font-black leading-[1.14] tracking-tight text-white sm:line-clamp-none sm:max-w-[22ch] sm:text-[32px] lg:text-[38px]">
                    <span className="bg-gradient-to-r from-white via-brand-pale to-brand-deep bg-clip-text text-transparent">
                      {t(banner.titleKey)}
                    </span>
                  </h1>
                ) : (
                  <h2 className="line-clamp-2 max-w-[16ch] text-[21px] font-black leading-[1.14] tracking-tight text-white sm:line-clamp-none sm:max-w-[22ch] sm:text-[32px] lg:text-[38px]">
                    <span className="bg-gradient-to-r from-white via-brand-pale to-brand-deep bg-clip-text text-transparent">
                      {t(banner.titleKey)}
                    </span>
                  </h2>
                )}

                <p className="line-clamp-2 max-w-[34ch] text-[11px] leading-5 text-neutral-400 sm:line-clamp-none sm:max-w-[52ch] sm:text-xs">
                  {t(banner.bodyKey)}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:gap-2.5">
                  <button
                    type="button"
                    onClick={() => onAction(banner)}
                    tabIndex={active ? 0 : -1}
                    className="group/cta relative inline-flex h-9 items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-brand-deep via-brand-soft to-brand-deep px-4 text-[11px] font-bold text-brand-ink shadow-[0_14px_34px_-14px_var(--sf-a95)] transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070707] sm:h-10 sm:px-5 sm:text-xs"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 -left-1/3 w-1/3 -translate-x-full skew-x-[-20deg] bg-white/40 blur-[2px] transition-transform duration-700 group-hover/cta:translate-x-[420%]"
                    />
                    <svg
                      viewBox="0 0 24 24"
                      className="relative h-3 w-3 sm:h-3.5 sm:w-3.5"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                    </svg>
                    <span className="relative">{t(banner.ctaKey)}</span>
                  </button>

                  {metric ? (
                    <span className="inline-flex items-baseline gap-1.5 rounded-xl border border-white/10 bg-black/45 px-2.5 py-1.5 backdrop-blur">
                      <span className="text-[8px] uppercase tracking-[0.22em] text-neutral-500">
                        {metric.label}
                      </span>
                      <span className="font-mono text-[11px] font-bold tabular-nums text-brand-pale sm:text-xs">
                        {metric.value}
                      </span>
                      {metric.gain ? (
                        <span
                          key={`${banner.id}-${metric.gain}`}
                          className="inline-flex items-center gap-0.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-1 py-px font-mono text-[8px] font-bold tabular-nums text-emerald-300 animate-[jackpot-rise_900ms_ease-out] motion-reduce:animate-none"
                        >
                          <svg
                            viewBox="0 0 12 12"
                            className="h-1.5 w-1.5"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M6 1.6 10.4 8.4H1.6L6 1.6Z" />
                          </svg>
                          {metric.gain}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </div>

            </article>
          );
        })}
      </div>

      {/* 左右切换：手机也保留，按小尺寸呈现；悬停或聚焦时显形 */}
      {total > 1 ? (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            aria-label={t("lobby.hero.prev")}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/45 p-1.5 text-neutral-300 opacity-0 backdrop-blur transition-all hover:border-brand-soft/60 hover:text-brand-soft focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-soft/60 group-hover:opacity-100 sm:left-3 sm:p-2"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 sm:h-4 sm:w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 5-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            aria-label={t("lobby.hero.next")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/45 p-1.5 text-neutral-300 opacity-0 backdrop-blur transition-all hover:border-brand-soft/60 hover:text-brand-soft focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-soft/60 group-hover:opacity-100 sm:right-3 sm:p-2"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 sm:h-4 sm:w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>

          {/* 指示器 + 自动轮播进度：当前点的金色进度条正好走满 5 秒 */}
          <div className="absolute inset-x-0 bottom-2.5 flex items-center justify-center gap-1.5 sm:bottom-3.5">
            {banners.map((banner, dotIndex) => {
              const active = dotIndex === index;

              return (
                <button
                  key={banner.id}
                  type="button"
                  onClick={() => goTo(dotIndex)}
                  aria-label={t("lobby.hero.goTo", { index: dotIndex + 1 })}
                  aria-current={active ? "true" : undefined}
                  className={`h-1.5 overflow-hidden rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 ${
                    active
                      ? "w-8 bg-white/25"
                      : "w-1.5 bg-white/25 hover:bg-white/45"
                  }`}
                >
                  {active ? (
                    <span
                      key={`${banner.id}-${round}-${paused ? "paused" : "run"}`}
                      className="block h-full rounded-full bg-gradient-to-r from-brand-soft to-brand-deep"
                      style={
                        paused
                          ? { width: "100%" }
                          : {
                              animation: `hero-progress ${HERO_ROTATE_MS}ms linear forwards`,
                            }
                      }
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

    </div>
  );
}
