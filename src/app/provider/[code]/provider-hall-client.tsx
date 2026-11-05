"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  ComingSoonDialog,
  ConnectingDialog,
} from "@/components/lobby/game-dialogs";
import { GameCard } from "@/components/lobby/game-card";
import { GameEmblem } from "@/components/lobby/game-emblem";
import {
  MissionMedalIcon,
  ReferralGiftIcon,
} from "@/components/lobby/hall-actions";
import { ProviderBrandMark } from "@/components/lobby/provider-brand";
import { ProviderWall } from "@/components/lobby/provider-wall";
import { formatInteger } from "@/lib/format";
import type { ThemeBackgroundId } from "@/lib/theme-backgrounds";
import { LOBBY_CATEGORY_LABEL_KEYS } from "@/lib/i18n-keys";
import {
  LOBBY_FEATURE_CONTENT,
  type LobbyFeature,
} from "@/lib/lobby-features";
import {
  matchesCategory,
  type LobbyCategoryId,
  type LobbyGameCard,
  type LobbyProviderOption,
} from "@/lib/lobby-games";
import { providerBrand } from "@/lib/lobby-providers";
import { buildStorefrontTheme } from "@/lib/storefront";
import {
  buildStorefrontPresetStyle,
  type StorefrontPresetId,
} from "@/lib/storefront-presets";
import { buildThemeBackgroundStyle } from "@/lib/theme-backgrounds";

const CONNECTING_AUTO_CLOSE_MS = 3400;
const FOOTER_YEAR = new Date().getFullYear();

/**
 * 展馆里品类统计的展示顺序。
 * 与大厅左侧导航保持一致：旧的 esport（电竞）已并入 sport（体育），不再单列。
 */
const CATEGORY_ORDER: LobbyCategoryId[] = [
  "slot",
  "live",
  "sport",
  "poker",
  "fish",
  "cockfight",
];

/**
 * 游戏商专属展馆（/provider/[code]）。
 *
 * 与大厅的区别：这里没有分类 / 搜索侧栏，整页只服务一个品牌——
 * 顶部是该厂商的巨幅品牌 Banner（含返回大厅），下方铺满该厂商全部游戏。
 * 点击品牌墙上的其他品牌会继续用 router 跳转到对应展馆，形成「展馆互跳」。
 */
export function ProviderHallClient({
  providerName,
  cards,
  otherProviders,
  onlineTotals,
  themeColor,
  themeBrightness,
  themeBackground,
  preset,
  languageStyle,
  brandName,
}: {
  providerName: string;
  cards: LobbyGameCard[];
  otherProviders: LobbyProviderOption[];
  /** providerId → 基础在线人数合计 */
  onlineTotals: Record<string, number>;
  /** 后台装修的主色（与大厅同源，见 lib/storefront.ts） */
  themeColor: string;
  /** 后台装修的深浅调节 0-100（50 = 色号原样） */
  themeBrightness: number;
  /** 后台装修的主题背景色（与大厅同源，见 lib/theme-backgrounds.ts） */
  themeBackground: ThemeBackgroundId;
  /**
   * 后台装修的排版模板（与大厅同源，见 lib/storefront-presets.ts）。
   *
   * 展馆必须吃同一份 --sf-* token：否则玩家从大厅（classic 1600px）点进品牌馆
   * 会突然变成另一套宽度 / 圆角 / 卡片密度，等于「换个页面换个版式」。
   * 组件树依旧只有一份，差别全部来自 token（AGENTS.md §4）。
   */
  preset: StorefrontPresetId;
  /** 后台装修的语言按钮文案，形如 CH/EN */
  languageStyle: string;
  /** 当前商户品牌名（Tenant.name），页脚版权行用它，白标站不能露出平台名 */
  brandName: string;
}) {
  const { t } = useLanguage();
  const brand = providerBrand(providerName);
  // 展馆沿用租户主色 + 深浅调节：外壳、按钮、光晕与大厅完全同色
  const theme = useMemo(
    () => buildStorefrontTheme({ hex: themeColor, brightness: themeBrightness }),
    [themeBrightness, themeColor],
  );
  // 主题背景色（--tb-*）：与大厅同一份配置，否则玩家点进品牌馆会「换了个底色」
  const backgroundStyle = useMemo(
    () => buildThemeBackgroundStyle(themeBackground),
    [themeBackground],
  );
  // 版式 token（--sf-*）：同样与大厅同源（内容区宽度 / 面板圆角 / 卡片间距）
  const presetStyle = useMemo(
    () => buildStorefrontPresetStyle(preset),
    [preset],
  );

  const [connectingGame, setConnectingGame] = useState<LobbyGameCard | null>(
    null,
  );
  const [comingSoon, setComingSoon] = useState<LobbyFeature | null>(null);

  const connectingTitleId = useId();
  const comingSoonTitleId = useId();

  const onlineByProvider = useMemo(
    () => new Map(Object.entries(onlineTotals)),
    [onlineTotals],
  );

  const totalOnline = useMemo(
    () => cards.reduce((sum, card) => sum + card.online, 0),
    [cards],
  );

  const categoryCounts = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        // 用 matchesCategory 而不是直接看 card.categories：
        // 「体育」要连带收录历史 esport 游戏，否则展馆里会漏统计。
        count: cards.filter((card) => matchesCategory(card, category)).length,
      })).filter((entry) => entry.count > 0),
    [cards],
  );

  const topGame = cards[0] ?? null;
  const modalOpen = connectingGame !== null || comingSoon !== null;

  useEffect(() => {
    if (!modalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setConnectingGame(null);
      setComingSoon(null);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  useEffect(() => {
    if (!connectingGame) {
      return;
    }

    const timer = window.setTimeout(
      () => setConnectingGame(null),
      CONNECTING_AUTO_CLOSE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [connectingGame]);

  return (
    <div
      className="tb-lobby-bg relative min-h-screen font-sans text-neutral-200"
      style={{ ...(theme.style as CSSProperties), ...presetStyle, ...backgroundStyle }}
      data-storefront-preset={preset}
      data-theme-background={themeBackground}
      data-theme-color={theme.brand}
      data-theme-brightness={theme.brightness}
      data-theme-primary={theme.primary}
    >
      <header className="relative overflow-hidden border-b border-brand/25">
        {/* 品牌专属渐变底 */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(110% 130% at 6% -12%, ${brand.secondary}70 0%, transparent 56%), radial-gradient(80% 100% at 94% -4%, ${brand.primary}33 0%, transparent 62%), linear-gradient(180deg, ${brand.base} 0%, #060606 94%)`,
          }}
        />
        {/* 巨幅品牌图腾水印 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-14 top-1/2 hidden -translate-y-1/2 text-white/[0.07] sm:block"
        >
          <GameEmblem
            emblem={brand.emblem}
            className="h-[340px] w-[340px] lg:h-[440px] lg:w-[440px]"
          />
        </div>
        {/* 斜向光带 + 底部金线 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.10] [background-image:repeating-linear-gradient(115deg,rgba(255,255,255,0.16)_0_1px,transparent_1px_24px)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-soft/70 to-transparent"
        />

        <div className="relative mx-auto w-full max-w-[var(--sf-shell-max,1600px)] px-3 pb-8 pt-3 sm:px-5 sm:pb-11 lg:px-8">
          {/* 顶栏：返回大厅 + 功能占位 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href="/"
              className="group inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 text-[11px] font-semibold text-neutral-200 backdrop-blur transition-colors hover:border-brand-soft/60 hover:text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 12H5m6-7-7 7 7 7" />
              </svg>
              {t("provider.hall.back")}
            </Link>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => setComingSoon("mission")}
                aria-label={t("lobby.mission.title")}
                title={t("lobby.mission")}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-brand/25 bg-black/40 transition-colors hover:border-brand-soft/60 hover:bg-brand/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
              >
                <MissionMedalIcon />
              </button>
              <button
                type="button"
                onClick={() => setComingSoon("referral")}
                aria-label={t("lobby.referral.title")}
                title={t("lobby.referral")}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-brand/25 bg-black/40 transition-colors hover:border-brand-soft/60 hover:bg-brand/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
              >
                <ReferralGiftIcon />
              </button>
              <LanguageSwitcher languageStyle={languageStyle} />
              <button
                type="button"
                onClick={() => setComingSoon("login")}
                className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/[0.03] px-2.5 text-[11px] font-semibold text-neutral-300 transition-colors hover:border-brand/45 hover:text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 sm:px-3.5"
              >
                {t("lobby.login")}
              </button>
              <button
                type="button"
                onClick={() => setComingSoon("register")}
                className="inline-flex h-9 items-center rounded-full bg-gradient-to-r from-brand-deep via-brand-soft to-brand-deep px-2.5 text-[11px] font-bold text-brand-ink shadow-[0_10px_26px_-12px_var(--sf-a95)] transition-shadow hover:shadow-[0_14px_34px_-10px_var(--sf-a85)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/70 sm:px-3.5"
              >
                {t("lobby.register")}
              </button>
            </div>
          </div>

          {/* 品牌主视觉：Logo + 巨型品牌名 + 数据胶囊 + CTA */}
          <div className="mt-7 flex flex-col gap-6 sm:mt-11 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.24em] text-brand-soft">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-soft shadow-[0_0_8px_var(--sf-soft-a90)]" />
                {t("provider.hall.badge")}
              </span>

              <div className="mt-4 flex items-center gap-3 sm:gap-4">
                <ProviderBrandMark
                  name={providerName}
                  size="lg"
                  className="hidden sm:flex"
                />
                <div className="min-w-0">
                  <h1 className="truncate text-3xl font-black uppercase italic leading-none tracking-[-0.02em] text-white drop-shadow-[0_14px_30px_rgba(0,0,0,0.85)] sm:text-5xl lg:text-6xl">
                    {providerName}
                  </h1>
                  <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.3em] text-brand-soft/80 sm:text-[10px]">
                    {t("provider.hall.title", { name: providerName })}
                  </p>
                </div>
              </div>

              <p className="mt-3 max-w-md text-[11px] leading-5 text-neutral-300/85 sm:text-xs">
                {t("provider.hall.subtitle", { name: providerName })}
              </p>

              {/* 数据胶囊：游戏数 / 品类分布 */}
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-[10px] font-semibold text-neutral-200 backdrop-blur">
                  {t("provider.hall.games", { count: cards.length })}
                </span>
                {categoryCounts.map(({ category, count }) => (
                  <span
                    key={category}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-neutral-400 backdrop-blur"
                  >
                    {t(LOBBY_CATEGORY_LABEL_KEYS[category])}
                    <span className="ml-1 font-mono font-semibold tabular-nums text-neutral-300">
                      {count}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-black/55 px-3 py-1.5 text-[10px] font-semibold tabular-nums text-emerald-300 backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.95)]" />
                {t("provider.hall.players", {
                  count: formatInteger(totalOnline),
                })}
              </span>
              <button
                type="button"
                disabled={!topGame}
                onClick={() => topGame && setConnectingGame(topGame)}
                className="group relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-brand-deep via-brand-soft to-brand-deep px-6 text-[12px] font-black uppercase tracking-[0.08em] text-brand-ink shadow-[0_18px_44px_-18px_var(--sf-a95)] transition-all hover:shadow-[0_22px_54px_-16px_var(--sf-a85)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 -left-1/3 w-1/3 -translate-x-full skew-x-[-20deg] bg-white/45 blur-[2px] transition-transform duration-700 group-hover:translate-x-[420%]"
                />
                <svg
                  viewBox="0 0 24 24"
                  className="relative h-3.5 w-3.5"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                </svg>
                <span className="relative">{t("lobby.playNow")}</span>
              </button>
            </div>
          </div>

        </div>
      </header>

      <main className="relative mx-auto w-full max-w-[var(--sf-shell-max,1600px)] px-3 pb-14 pt-6 sm:px-5 lg:px-8">
        {/* 该厂商全部游戏 */}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-4 w-1 rounded-full bg-gradient-to-b from-brand-soft to-brand-deep"
            />
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-soft">
              {t("lobby.category.all")}
            </h2>
            <span className="font-mono text-[10px] tabular-nums text-neutral-500">
              {cards.length}
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            LIVE
          </span>
        </div>

        {cards.length > 0 ? (
          <ul className="grid grid-cols-3 gap-[var(--sf-game-gap,0.75rem)] sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {cards.map((card) => (
              <li key={card.id} className="min-w-0">
                <GameCard
                  card={card}
                  onPlay={() => setConnectingGame(card)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-14 text-center">
            <p className="text-[12px] text-neutral-400">
              {t("provider.hall.empty")}
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex h-9 items-center rounded-full border border-brand/40 bg-brand/10 px-4 text-[11px] font-semibold text-brand-soft transition-colors hover:bg-brand/20"
            >
              {t("provider.hall.back")}
            </Link>
          </div>
        )}

        {/* 其他游戏商：继续跳转到对应展馆 */}
        {otherProviders.length > 0 ? (
          <section className="mt-8">
            <div className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-4 w-1 rounded-full bg-gradient-to-b from-brand-soft to-brand-deep"
              />
              <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-soft">
                {t("provider.hall.other")}
              </h2>
            </div>
            <ProviderWall
              providers={otherProviders}
              onlineByProvider={onlineByProvider}
              heading={false}
            />
          </section>
        ) : null}

        <footer className="mt-8 border-t border-white/[0.05] pt-5">
          <div className="flex flex-col items-center justify-between gap-2 text-[10px] text-neutral-600 sm:flex-row">
            <span className="uppercase tracking-[0.2em]">
              © {FOOTER_YEAR} {brandName}
            </span>
            <span>{t("lobby.footer.notice")}</span>
          </div>
        </footer>
      </main>

      {connectingGame ? (
        <ConnectingDialog
          titleId={connectingTitleId}
          providerName={connectingGame.providerLabel}
          onClose={() => setConnectingGame(null)}
        />
      ) : null}

      {comingSoon ? (
        <ComingSoonDialog
          titleId={comingSoonTitleId}
          titleKey={LOBBY_FEATURE_CONTENT[comingSoon].titleKey}
          bodyKey={LOBBY_FEATURE_CONTENT[comingSoon].bodyKey}
          icon={
            comingSoon === "mission" ? (
              <MissionMedalIcon />
            ) : comingSoon === "referral" ? (
              <ReferralGiftIcon />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="3.6" />
                <path d="M4.8 20c0-3.6 3.2-6.4 7.2-6.4s7.2 2.8 7.2 6.4" />
              </svg>
            )
          }
          onClose={() => setComingSoon(null)}
        />
      ) : null}
    </div>
  );
}
