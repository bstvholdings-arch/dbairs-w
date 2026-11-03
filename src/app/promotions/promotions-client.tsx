"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TenantBrandLockup } from "@/components/brand/tenant-brand";
import { PlayerBottomNav } from "@/components/player/player-bottom-nav";
import { formatCurrency } from "@/lib/currency";
import type {
  PromotionBannerView,
  PromotionBonusSummary,
  PromotionFeed,
} from "@/lib/promotions";
import { buildStorefrontTheme } from "@/lib/storefront";

/** 「全部优惠」虚拟分类：不对应数据库里的任何一行 */
const ALL_CATEGORY_ID = "all";

export function PromotionsClient({
  themeColor,
  tenantName,
  tenantLogoUrl,
  currency,
  initialFeed,
  bonus,
  loggedIn,
  playerName,
  tenantKey,
}: {
  themeColor: string;
  tenantName: string | null;
  tenantLogoUrl: string | null;
  /** 租户记账货币（MYR / USD / USDT…），金额符号统一走 formatCurrency */
  currency: string;
  initialFeed: PromotionFeed;
  bonus: PromotionBonusSummary;
  loggedIn: boolean;
  playerName: string | null;
  /** 预览模式下的租户标识：站内跳转必须透传 */
  tenantKey: string | null;
}) {
  const { t } = useLanguage();
  const theme = useMemo(() => buildStorefrontTheme(themeColor), [themeColor]);

  const [activeId, setActiveId] = useState<string>(ALL_CATEGORY_ID);
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});
  const [countdown, setCountdown] = useState<string | null>(null);

  const { categories, banners } = initialFeed;

  /** 当前分类：脏 id（分类被后台删了）自动回落到「全部优惠」 */
  const activeCategory = categories.find((item) => item.id === activeId) ?? null;
  const visibleBanners = activeCategory
    ? banners.filter((banner) => banner.categoryId === activeCategory.id)
    : banners;

  const tabs = [
    {
      id: ALL_CATEGORY_ID,
      label: t("promotions.category.all"),
      count: banners.length,
    },
    ...categories.map((category) => ({
      id: category.id,
      label: category.name,
      count: category.bannerCount,
    })),
  ];

  /**
   * 倒计时：目标时间是「下一次重置」（UTC 次日 0 点，服务端下发 ISO 串）。
   * 首帧必须留空（`--:--:--`），挂载后再算 —— 服务端渲染时的 Date.now()
   * 与浏览器不一致，直接渲染数字会触发 hydration mismatch。
   */
  useEffect(() => {
    const target = new Date(bonus.nextResetAt).getTime();

    if (!Number.isFinite(target)) {
      return;
    }

    function tick() {
      const remaining = target - Date.now();

      if (remaining <= 0) {
        setCountdown("00:00:00");
        return;
      }

      const total = Math.floor(remaining / 1000);
      const hours = String(Math.floor(total / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
      const seconds = String(total % 60).padStart(2, "0");

      setCountdown(`${hours}:${minutes}:${seconds}`);
    }

    tick();

    const timer = window.setInterval(tick, 1000);

    return () => window.clearInterval(timer);
  }, [bonus.nextResetAt]);

  /** 站内地址在预览模式下补 `?tenant=`（幂等），外站链接原样返回 */
  function withTenant(href: string) {
    if (!tenantKey || !href.startsWith("/")) {
      return href;
    }

    const [path, search = ""] = href.split("?");
    const params = new URLSearchParams(search);

    params.set("tenant", tenantKey);

    return `${path}?${params.toString()}`;
  }

  const claimHref = loggedIn
    ? withTenant("/player/profile?tab=wallet")
    : withTenant(
        `/player/login?next=${encodeURIComponent(withTenant("/promotions"))}`,
      );

  function resolveBannerHref(banner: PromotionBannerView) {
    const link = banner.linkUrl?.trim();

    if (!link) {
      return null;
    }

    return link.startsWith("/") ? withTenant(link) : link;
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#040404] font-sans text-neutral-200"
      style={theme.style}
      data-theme-color={theme.brand}
      data-promotions-page="true"
    >
      {/* 背景：品牌色光晕 + 细网格，与大厅 / 玩家中心同一套语言（黑金，不用白底） */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand/10 blur-[160px]" />
        <div className="absolute -right-40 top-24 h-[30rem] w-[30rem] rounded-full bg-brand/10 blur-[170px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)] [-webkit-mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-brand/10 bg-[#050505]/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href={withTenant("/")} className="flex items-center gap-2.5">
            <TenantBrandLockup
              brandName={tenantName}
              logoUrl={tenantLogoUrl}
              size="md"
              tagline={t("promotions.eyebrow")}
              taglineClassName="block"
            />
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href={withTenant("/")}
              className="hidden h-9 items-center rounded-full border border-white/[0.08] px-4 text-[11px] font-semibold text-neutral-400 transition-colors hover:border-brand/30 hover:text-brand-soft sm:inline-flex"
            >
              {t("promotions.backToLobby")}
            </Link>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-brand-soft/80">
              {t("promotions.eyebrow")}
            </p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-neutral-50 sm:text-3xl">
              {t("promotions.title")}
            </h1>
            <p className="mt-1.5 max-w-xl text-xs leading-5 text-neutral-500">
              {t("promotions.subtitle")}
            </p>
          </div>

          {playerName ? (
            <p className="text-[11px] text-neutral-500">
              {t("promotions.signedInAs", { name: playerName })}
            </p>
          ) : null}
        </div>


        {/* 顶部任务栏：左侧每日任务 + 倒计时，右侧彩金总额（黑金卡） */}
        <section className="relative mt-4 overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-br from-brand/[0.14] via-[#0b0b0b] to-[#050505] p-4 sm:p-5">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-soft to-transparent"
          />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.26em] text-brand-soft/80">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-1 rounded-full bg-gradient-to-b from-brand-soft to-brand-deep"
                />
                {t("promotions.task.title")}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                    bonus.claimedToday
                      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                      : "border-brand/30 bg-brand/10 text-brand-pale"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-current"
                  />
                  {bonus.claimedToday
                    ? t("promotions.task.claimed")
                    : t("promotions.task.claimable")}
                </span>

                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] text-neutral-400">
                  {t("promotions.task.resetIn")}
                  <span className="font-mono tabular-nums text-neutral-200">
                    {countdown ?? "--:--:--"}
                  </span>
                </span>
              </div>

              <p className="mt-2 text-[11px] leading-5 text-neutral-500">
                {t("promotions.task.dailyBonus", {
                  amount: formatCurrency(bonus.dailyAmount, currency),
                })}
              </p>

              <a
                href={claimHref}
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-brand/25 bg-black/40 px-3 text-[10px] font-semibold text-brand-pale transition-colors hover:border-brand/50 hover:bg-brand/10"
              >
                {loggedIn
                  ? t("promotions.task.goClaim")
                  : t("promotions.task.loginToClaim")}
                <span aria-hidden="true">→</span>
              </a>
            </div>

            <div className="shrink-0 rounded-xl border border-brand/25 bg-black/45 px-4 py-3 text-left sm:min-w-[190px] sm:text-right">
              <p className="text-[9px] uppercase tracking-[0.22em] text-neutral-500">
                {t("promotions.bonus.label")}
              </p>
              <p className="mt-1 font-mono text-2xl font-black tabular-nums text-brand-pale">
                {loggedIn
                  ? formatCurrency(bonus.bonusTotal, currency)
                  : t("promotions.bonus.guest")}
              </p>
              <p className="mt-1 text-[9px] leading-4 text-neutral-600">
                {t("promotions.bonus.hint")}
              </p>
            </div>
          </div>
        </section>


        <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
          {/* 分类：手机端横滑 Tab，≥lg 变成左侧竖排（当前分类高亮） */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <p className="mb-2 hidden text-[9px] uppercase tracking-[0.24em] text-neutral-600 lg:block">
              {t("promotions.category.heading")}
            </p>
            <div
              aria-label={t("promotions.category.aria")}
              className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0"
            >
              {tabs.map((tab) => {
                const active =
                  tab.id === (activeCategory?.id ?? ALL_CATEGORY_ID);

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveId(tab.id)}
                    aria-pressed={active}
                    className={`flex shrink-0 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-colors lg:w-full ${
                      active
                        ? "border-brand/30 bg-brand/12 text-brand-pale"
                        : "border-white/[0.07] bg-white/[0.02] text-neutral-400 hover:border-brand/20 hover:text-neutral-200"
                    }`}
                  >
                    <span className="whitespace-nowrap">{tab.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] ${
                        active
                          ? "bg-brand/20 text-brand-pale"
                          : "bg-white/[0.04] text-neutral-500"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Banner 列表：圆角大图，点击跳 linkUrl */}
          <section aria-live="polite" className="min-w-0">
            {visibleBanners.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 py-12 text-center">
                <p className="text-sm font-semibold text-neutral-200">
                  {t("promotions.empty.title")}
                </p>
                <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-neutral-500">
                  {t("promotions.empty.body")}
                </p>
                <Link
                  href={withTenant("/")}
                  className="mt-4 inline-flex h-9 items-center rounded-full border border-brand/25 px-4 text-[11px] font-semibold text-brand-pale transition-colors hover:bg-brand/10"
                >
                  {t("promotions.backToLobby")}
                </Link>
              </div>
            ) : (
              <ul className="grid gap-3 sm:gap-4">

                {visibleBanners.map((banner) => {
                  const href = resolveBannerHref(banner);
                  const external = Boolean(href && /^https?:\/\//i.test(href));
                  const broken = Boolean(brokenImages[banner.id]);
                  const title =
                    banner.title?.trim() || t("promotions.banner.fallback");

                  return (
                    <li key={banner.id}>
                      <a
                        href={href ?? undefined}
                        target={external ? "_blank" : undefined}
                        rel={external ? "noopener noreferrer" : undefined}
                        aria-label={t("promotions.banner.aria", { title })}
                        className={`group block overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0a] transition-colors ${
                          href
                            ? "hover:border-brand/35 hover:shadow-[0_24px_70px_-40px_var(--sf-a95)]"
                            : "cursor-default"
                        }`}
                      >
                        <span className="relative block overflow-hidden rounded-2xl">
                          {broken ? (
                            <span className="flex aspect-[16/7] w-full flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,var(--sf-a18),#0b0b0b_60%,#080808)]">
                              <span aria-hidden="true" className="text-2xl">
                                🎁
                              </span>
                              <span className="px-4 text-center text-xs font-semibold text-brand-pale">
                                {title}
                              </span>
                            </span>
                          ) : (
                            // 活动图来自商户上传或外站图床，next/image 的域名白名单管不住
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={banner.imageUrl}
                              alt={title}
                              draggable={false}
                              loading="lazy"
                              onError={() =>
                                setBrokenImages((current) => ({
                                  ...current,
                                  [banner.id]: true,
                                }))
                              }
                              className="block w-full transition-transform duration-500 group-hover:scale-[1.015]"
                            />
                          )}

                          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-3 pt-10">
                            <span className="flex items-center justify-between gap-3">
                              <span className="truncate text-xs font-semibold text-neutral-100 sm:text-sm">
                                {title}
                              </span>
                              {href ? (
                                <span className="shrink-0 rounded-full border border-brand/30 bg-black/50 px-2.5 py-1 text-[9px] font-semibold text-brand-pale">
                                  {t("promotions.banner.cta")}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </span>
                      </a>
                    </li>
                  );
                })}

              </ul>
            )}
          </section>
        </div>
      </main>

      <PlayerBottomNav tenantKey={tenantKey} />
    </div>
  );
}

