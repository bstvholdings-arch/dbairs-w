"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LobbyActionBar, type LobbyActionId } from "@/components/lobby/action-bar";
import {
  ComingSoonDialog,
  ConnectingDialog,
  DepositDialog,
} from "@/components/lobby/game-dialogs";
import { GameCard } from "@/components/lobby/game-card";
import {
  MissionMedalIcon,
  ReferralGiftIcon,
  WithdrawIcon,
} from "@/components/lobby/hall-actions";
import { HeroCarousel, type HeroBannerMetric } from "@/components/lobby/hero-carousel";
import { ProviderWall } from "@/components/lobby/provider-wall";
import { formatAmount, formatInteger } from "@/lib/format";
import { LOBBY_CATEGORY_LABEL_KEYS } from "@/lib/i18n-keys";
import { LOBBY_BANNERS, type LobbyBanner } from "@/lib/lobby-banners";
import { selectShowcaseProviders } from "@/lib/provider-showcase";
import {
  LOBBY_FEATURE_CONTENT,
  type LobbyFeature,
} from "@/lib/lobby-features";
import {
  buildCardsFromRecords,
  buildMockLobby,
  cardTitle,
  LOBBY_CATEGORY_ORDER,
  matchesCategory,
  type LobbyCategoryFilter,
  type LobbyGameCard,
  type LobbyGameRecord,
  type LobbyProviderOption,
} from "@/lib/lobby-games";
import { DEPOSIT_PRESETS, INITIAL_BALANCE } from "@/lib/lobby-wallet";
import {
  buildStorefrontTheme,
  type StorefrontModuleId,
  type StorefrontSettings,
} from "@/lib/storefront";


/** 顶部占位功能：点击后统一弹「即将上线」提示 */
type ComingSoonFeature = LobbyFeature;

const COMING_SOON_CONTENT = LOBBY_FEATURE_CONTENT;

/** Live Jackpot 初始奖池 */
const JACKPOT_SEED_AMOUNT = 1284930.55;
/** 奖池上涨节奏：间隔（毫秒）+ 单次增量区间（美元） */
const JACKPOT_TICK_MS = 1600;
const JACKPOT_MIN_GAIN = 0.5;
const JACKPOT_MAX_GAIN = 5;
const CONNECTING_AUTO_CLOSE_MS = 3400;
const NOTICE_DURATION_MS = 2600;
const FOOTER_YEAR = new Date().getFullYear();


/**
 * 玩家前台大厅（Player Lobby）。
 * 服务端已经按 isActive / sortOrder 取好「游戏商 + 游戏」，首屏直接渲染；
 * 客户端再异步刷新一次公开接口，后台同步或上下架游戏后无需硬刷新即可生效。
 * 分类 / 搜索全部在本地完成，语言切换与弹窗也不需要再请求接口。
 * 游戏商不再出现在左侧栏：品牌墙（PROVIDER SHOWCASE）负责展示，点进去是独立展馆页。
 *
 * 页面顺序由后台【前台装修】(Tenant.layoutConfig) 决定，主色由 Tenant.themeColor 决定：
 * - Header / All Games 固定显示；
 * - Hero 轮播、核心功能岛、品牌墙 三块可开关、可排序（见 storefront.modules）；
 * - 主色通过根节点的 --sf-* CSS 变量下发，Tailwind 的 brand / brand-soft / brand-deep…
 *   工具类全部跟随，因此后台改一次色号，整站配色即时变化。
 */
export function LobbyClient({
  initialProviders,
  initialGames,
  storefront,
}: {
  initialProviders: LobbyProviderOption[];
  initialGames: LobbyGameRecord[];
  /** 后台装修配置：主色 + 三大模块的开关与顺序 */
  storefront: StorefrontSettings;
}) {
  const { t } = useLanguage();

  // 后台装修：主色 + 深浅调节派生出一整套配色与 CSS 变量，直接挂在根节点上。
  // buildStorefrontTheme 会算出 --primary / --primary-soft / --primary-dark（hsl）
  // 以及既有工具类用到的 --sf-*（hex），因此改一次色号或滑条，整站配色即时变化。
  const theme = useMemo(
    () =>
      buildStorefrontTheme({
        hex: storefront.themeColor,
        brightness: storefront.themeBrightness,
      }),
    [storefront.themeBrightness, storefront.themeColor],
  );

  // 只渲染开启的模块，数组顺序就是页面顺序
  const visibleModules = useMemo(
    () =>
      storefront.modules
        .filter((module) => module.visible)
        .map((module) => module.id),
    [storefront.modules],
  );

  const [providers, setProviders] = useState(initialProviders);

  const [gameRecords, setGameRecords] = useState(initialGames);
  const [category, setCategory] = useState<LobbyCategoryFilter>("all");
  const [search, setSearch] = useState("");
  const [connectingGame, setConnectingGame] = useState<LobbyGameCard | null>(
    null,
  );
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState(DEPOSIT_PRESETS[1]);
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [noticeVisible, setNoticeVisible] = useState(false);
  // Mission / Referral / Login / Register 目前是占位入口，点击只弹「即将上线」。
  const [comingSoon, setComingSoon] = useState<ComingSoonFeature | null>(null);
  // Live Jackpot：amount 当前奖池，gain 本次增量（0 表示还没涨过），tick 用来重播跳动动画。
  const [jackpot, setJackpot] = useState({
    amount: JACKPOT_SEED_AMOUNT,
    gain: 0,
    tick: 0,
  });

  const connectingTitleId = useId();
  const depositTitleId = useId();
  const comingSoonTitleId = useId();


  // 数据库还没有同步任何游戏时（新部署 / 清库），回退到内置目录，保证大厅不空。
  const fallback = useMemo(() => buildMockLobby(), []);
  const usingFallback = gameRecords.length === 0;
  const providerOptions = usingFallback ? fallback.providers : providers;

  // 顶部品牌墙：只保留后台勾选「在商标网格展示」的游戏商，并按 sortOrder 从大到小排列。
  // 后台【前台装修 → 游戏商商标网格】保存后，下一次打开大厅即按新顺序渲染。
  const showcaseProviders = useMemo(
    () => selectShowcaseProviders(providerOptions),
    [providerOptions],
  );

  const cards = useMemo(
    () => (usingFallback ? fallback.cards : buildCardsFromRecords(gameRecords)),
    [fallback, gameRecords, usingFallback],
  );

  // 后台同步 / 上下架后，大厅在下一次打开时自动拿到最新列表。
  useEffect(() => {
    let cancelled = false;

    async function refreshLobby() {
      try {
        const [providerResponse, gameResponse] = await Promise.all([
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/games", { cache: "no-store" }),
        ]);

        if (!providerResponse.ok || !gameResponse.ok) {
          return;
        }

        const providerPayload = (await providerResponse.json()) as {
          providers?: LobbyProviderOption[];
        };
        const gamePayload = (await gameResponse.json()) as {
          games?: LobbyGameRecord[];
        };

        if (cancelled) {
          return;
        }

        if (Array.isArray(providerPayload.providers)) {
          setProviders(providerPayload.providers);
        }

        if (Array.isArray(gamePayload.games)) {
          setGameRecords(gamePayload.games);
        }
      } catch {
        // 静默失败：首屏 SSR 数据已经可用，不需要打扰玩家。
      }
    }

    void refreshLobby();

    return () => {
      cancelled = true;
    };
  }, []);

  // Live Jackpot 累积动画：每 JACKPOT_TICK_MS 随机涨 $0.50 ~ $5.00，模拟真实奖池被持续投注抬高。
  // 初始值与 SSR 一致，定时器只在客户端启动，因此不会产生 hydration 不匹配。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const gain =
        JACKPOT_MIN_GAIN + Math.random() * (JACKPOT_MAX_GAIN - JACKPOT_MIN_GAIN);

      setJackpot((current) => ({
        amount: current.amount + gain,
        gain,
        tick: current.tick + 1,
      }));
    }, JACKPOT_TICK_MS);

    return () => window.clearInterval(timer);
  }, []);


  // 品牌墙上的「在线人数」= 该游戏商所有游戏基础在线人数之和。
  const providerOnline = useMemo(() => {
    const totals = new Map<string, number>();

    for (const card of cards) {
      if (!card.providerId) {
        continue;
      }

      totals.set(card.providerId, (totals.get(card.providerId) ?? 0) + card.online);
    }

    return totals;
  }, [cards]);

  // 左侧分类计数：直接统计全部上架游戏，点击品类就知道有多少款。
  const categoryCounts = useMemo(() => {
    const counts = new Map<LobbyCategoryFilter, number>();

    for (const id of LOBBY_CATEGORY_ORDER) {
      counts.set(
        id,
        cards.filter((card) => matchesCategory(card, id)).length,
      );
    }

    return counts;
  }, [cards]);

  const query = search.trim().toLowerCase();

  const visibleGames = useMemo(
    () =>
      cards.filter((card) => {
        if (!matchesCategory(card, category)) {
          return false;
        }

        if (!query) {
          return true;
        }

        return (
          cardTitle(card, t).toLowerCase().includes(query) ||
          card.providerLabel.toLowerCase().includes(query) ||
          card.id.includes(query)
        );
      }),
    [cards, category, query, t],
  );

  const featuredGame = useMemo(
    () =>
      cards.find((card) => card.categories.includes("hot")) ?? cards[0] ?? null,
    [cards],
  );

  // 该品类后台还没有上架任何游戏（例如刚补上的 Sport / E-sport）：
  // 显示「即将上线」而不是像搜索失败一样的「无结果」。
  const emptyCategory =
    category !== "all" && (categoryCounts.get(category) ?? 0) === 0;

  const modalOpen =
    connectingGame !== null || depositOpen || comingSoon !== null;

  // 弹窗打开时锁背景滚动，避免大厅在弹窗后面继续滚动。
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

  // Esc 关闭当前弹窗。
  useEffect(() => {
    if (!modalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setConnectingGame(null);
      setDepositOpen(false);
      setComingSoon(null);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  // 连接提示自动收起，模拟跳转到游戏端。
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

  // 充值成功提示自动消失。
  useEffect(() => {
    if (!noticeVisible) {
      return;
    }

    const timer = window.setTimeout(
      () => setNoticeVisible(false),
      NOTICE_DURATION_MS,
    );

    return () => window.clearTimeout(timer);
  }, [noticeVisible]);

  function openGame(target: LobbyGameCard | null) {
    if (!target) {
      return;
    }

    setDepositOpen(false);
    setConnectingGame(target);
  }

  function openDeposit() {
    setConnectingGame(null);
    setDepositOpen(true);
  }

  function confirmDeposit() {
    setBalance((current) => current + depositAmount);
    setDepositOpen(false);
    setNoticeVisible(true);
  }

  // Hero 轮播上的实时数据：奖池、全站在线人数、游戏总数。
  const totalOnline = useMemo(
    () => cards.reduce((sum, card) => sum + card.online, 0),
    [cards],
  );

  const heroMetrics = useMemo<Record<string, HeroBannerMetric | undefined>>(
    () => ({
      jackpot: {
        label: t("lobby.hero.badge"),
        value: `$${formatAmount(jackpot.amount)}`,
        gain: jackpot.gain > 0 ? `+${formatAmount(jackpot.gain)}` : undefined,
      },
      slots: {
        label: "LIVE",
        value: t("lobby.playersOnline", { count: formatInteger(totalOnline) }),
      },
      live: {
        label: "TOTAL",
        value: t("lobby.gamesCount", { count: cards.length }),
      },
    }),
    [cards.length, jackpot.amount, jackpot.gain, t, totalOnline],
  );

  // 轮播 CTA：后台配了链接就跳链接，否则走大厅内部动作。
  function handleBannerAction(banner: LobbyBanner) {
    if (banner.href) {
      window.open(banner.href, "_blank", "noopener,noreferrer");
      return;
    }

    if (banner.action === "play") {
      openGame(featuredGame);
      return;
    }

    if (banner.action === "deposit") {
      openDeposit();
      return;
    }

    // 品牌墙被后台关掉时退回到游戏网格，避免「点了 CTA 页面纹丝不动」
    const anchor =
      document.getElementById("lobby-providers") ??
      document.getElementById("lobby-games");

    anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // 核心功能岛：只有充值走真实流程，其余都是「即将上线」占位弹窗。
  function handleLobbyAction(action: LobbyActionId) {
    if (action === "deposit") {
      openDeposit();
      return;
    }

    // 登录 / 注册在演示环境共用一个「即将上线」提示
    if (action === "auth") {
      setComingSoon("login");
      return;
    }

    setComingSoon(action);
  }

  /**
   * 按后台装修配置渲染三块可选模块。
   * 顺序与开关都来自 Tenant.layoutConfig，切换时不重新拉数据、不重排 DOM 以外的逻辑。
   * data-module 供后台预览 / 自动化测试断言渲染顺序，不影响样式。
   */
  function renderStorefrontModule(id: StorefrontModuleId) {
    switch (id) {
      case "hero":
        return (
          <div key="hero" data-module="hero">
            <HeroCarousel
              banners={LOBBY_BANNERS}
              metrics={heroMetrics}
              onAction={handleBannerAction}
            />
          </div>
        );
      case "action":
        return (
          <div key="action" data-module="action">
            <LobbyActionBar onAction={handleLobbyAction} />
          </div>
        );
      case "provider":
        // 所有游戏商都被后台从商标网格移除时，整块不渲染：
        // Hero 的 CTA 会发现 #lobby-providers 不存在，自动回退滚动到游戏列表。
        if (showcaseProviders.length === 0) {
          return null;
        }

        return (
          <div
            key="provider"
            id="lobby-providers"
            data-module="provider"
            className="scroll-mt-24"
          >
            <ProviderWall
              providers={showcaseProviders}
              onlineByProvider={providerOnline}
            />
          </div>
        );
    }
  }

  return (
    <div
      className="relative min-h-screen bg-[#040404] font-sans text-neutral-200"
      style={theme.style as CSSProperties}
      data-theme-color={theme.brand}
      data-theme-brightness={theme.brightness}
      data-theme-primary={theme.primary}
    >
      {/* 背景：黑金 + 霓虹光晕 + 细网格 */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand/10 blur-[150px]" />
        <div className="absolute -right-40 top-10 h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/10 blur-[150px]" />
        <div className="absolute bottom-[-18rem] left-1/3 h-[32rem] w-[32rem] rounded-full bg-cyan-500/10 blur-[170px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--sf-a10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)] [-webkit-mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-brand/10 bg-[#050505]/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-2.5 gap-y-2 px-3 py-3 sm:px-5 lg:px-8">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-pale via-brand to-brand-deep text-[11px] font-black tracking-tight text-brand-ink shadow-[0_0_28px_-8px_var(--sf-a95)]">
              DB
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/30"
              />
            </span>
            <span className="leading-none">
              <span className="block bg-gradient-to-r from-brand-pale via-brand-soft to-brand-deep bg-clip-text text-[15px] font-black tracking-[0.24em] text-transparent">
                DB AIRS
              </span>
              <span className="mt-1.5 block text-[8px] uppercase tracking-[0.34em] text-neutral-600">
                {t("lobby.brandTagline")}
              </span>
            </span>
          </div>

          {/* 余额 + 搜索：移动端整行换到第二排 */}
          <div className="order-3 flex w-full items-center gap-2 sm:order-2 sm:w-auto sm:flex-1 sm:pl-2">
            <div className="flex shrink-0 items-center gap-2 rounded-full border border-brand/25 bg-gradient-to-r from-brand/15 to-transparent px-2.5 py-1.5 sm:px-3">
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 text-brand-soft"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="6" width="18" height="13" rx="3" />
                <path d="M3 10h18" />
                <circle cx="16.8" cy="14.6" r="1.1" />
              </svg>
              <span className="hidden text-[8px] uppercase tracking-[0.2em] text-neutral-500 sm:inline">
                {t("lobby.balance")}
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums text-brand-pale sm:text-xs">
                ${formatAmount(balance)}
              </span>
              <span className="hidden rounded-full border border-white/10 px-1.5 py-px text-[8px] uppercase tracking-[0.14em] text-neutral-500 md:inline">
                {t("lobby.demo")}
              </span>
            </div>

            <label className="relative flex min-w-0 flex-1 items-center">
              <span className="sr-only">{t("lobby.searchPlaceholder")}</span>
              <svg
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-neutral-600"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.6-3.6" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("lobby.searchPlaceholder")}
                className="h-9 w-full rounded-full border border-white/[0.07] bg-white/[0.03] pl-8 pr-3 text-[11px] text-neutral-200 transition-colors placeholder:text-neutral-600 focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/25"
              />
            </label>
          </div>

          {/* Header 只保留 Logo / Balance / Search / Language；其余功能已搬到下方核心功能岛 */}
          <div className="order-2 ml-auto flex shrink-0 items-center sm:order-3 sm:ml-0">
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-[1600px] px-3 pb-12 pt-4 sm:px-5 lg:px-8">
        {/*
          ② ③ ④ 可选模块区：Hero 轮播 / 核心功能岛 / 品牌墙。
          显示与顺序完全由后台【前台装修】的 layoutConfig 决定（Tenant.layoutConfig），
          这里不再写死顺序，改顺序只需要在后台点上移 / 下移。
        */}
        {visibleModules.length > 0 ? (
          <div className="flex flex-col gap-4 sm:gap-5" data-storefront-modules>
            {visibleModules.map((id) => renderStorefrontModule(id))}
          </div>
        ) : null}

        {/* ⑤ All Games：左侧品类导航 + 右侧游戏网格（固定显示，不受装修开关影响） */}
        <div
          id="lobby-games"
          className={`flex flex-col gap-4 scroll-mt-24 lg:flex-row lg:gap-6 ${
            visibleModules.length > 0 ? "mt-5" : "mt-1"
          }`}
        >
          {/* 左侧分类导航：桌面竖排，手机横向滑动 */}
          <aside className="lg:w-[212px] lg:shrink-0">
            <div className="lg:sticky lg:top-[96px]">
              {/* 左侧导航只放游戏品类；游戏商展示全部交给顶部 PROVIDER SHOWCASE 品牌墙 */}
              <nav
                aria-label={t("nav.mainAria")}
                className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
              >
                {LOBBY_CATEGORY_ORDER.map((id) => {
                  const active = category === id;

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCategory(id)}
                      aria-pressed={active}
                      className={`group relative flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold tracking-wide transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 lg:w-full lg:px-3.5 lg:py-2.5 ${
                        active
                          ? "border-transparent bg-gradient-to-r from-brand-soft via-brand-mid to-brand-deep text-brand-ink shadow-[0_12px_28px_-14px_var(--sf-a95)]"
                          : "border-white/[0.06] bg-white/[0.02] text-neutral-400 hover:border-brand/30 hover:text-brand-soft"
                      }`}
                    >
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1.5 left-0 hidden w-[3px] rounded-full bg-brand-ink/60 lg:block"
                        />
                      ) : null}
                      <CategoryIcon id={id} />
                      <span className="whitespace-nowrap">
                        {t(LOBBY_CATEGORY_LABEL_KEYS[id])}
                      </span>
                      <span
                        className={`ml-auto rounded-full px-1.5 py-px text-[9px] tabular-nums ${
                          active
                            ? "bg-brand-ink/15 text-brand-ink"
                            : "bg-white/[0.06] text-neutral-500"
                        }`}
                      >
                        {categoryCounts.get(id) ?? 0}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* 游戏网格 */}
          <section className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
                <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-brand-soft to-brand-deep" />
                {t(LOBBY_CATEGORY_LABEL_KEYS[category])}
              </h2>
              <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">
                {t("lobby.gamesCount", { count: visibleGames.length })}
              </span>
            </div>

            {visibleGames.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-brand/25 bg-brand/10 text-lg">
                  {emptyCategory ? "🎲" : "🔍"}
                </span>
                <p className="mt-4 text-sm font-semibold text-neutral-200">
                  {emptyCategory
                    ? t("lobby.categoryEmpty")
                    : t("lobby.noResults")}
                </p>
                <p className="mt-1.5 text-[11px] text-neutral-500">
                  {emptyCategory
                    ? t("lobby.categoryEmptyHint")
                    : t("lobby.noResultsHint")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCategory("all");
                  }}
                  className="mt-5 h-9 rounded-lg border border-brand/30 px-4 text-[11px] font-semibold text-brand-soft transition-colors hover:bg-brand/10"
                >
                  {t("lobby.category.all")}
                </button>
              </div>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {visibleGames.map((card) => (
                  <li key={card.id} className="min-w-0">
                    <GameCard card={card} onPlay={() => openGame(card)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="mt-8 border-t border-white/[0.05] pt-5">
          <div className="flex flex-col items-center justify-between gap-2 text-[10px] text-neutral-600 sm:flex-row">
            <span className="uppercase tracking-[0.2em]">
              © {FOOTER_YEAR} DB AIRS
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

      {depositOpen ? (
        <DepositDialog
          titleId={depositTitleId}
          balance={balance}
          amount={depositAmount}
          onSelectAmount={setDepositAmount}
          onConfirm={confirmDeposit}
          onClose={() => setDepositOpen(false)}
        />
      ) : null}

      {comingSoon ? (
        <ComingSoonDialog
          titleId={comingSoonTitleId}
          titleKey={COMING_SOON_CONTENT[comingSoon].titleKey}
          bodyKey={COMING_SOON_CONTENT[comingSoon].bodyKey}
          icon={
            comingSoon === "mission" ? (
              <MissionMedalIcon />
            ) : comingSoon === "referral" ? (
              <ReferralGiftIcon />
            ) : comingSoon === "withdraw" ? (
              <WithdrawIcon className="h-6 w-6" />
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

      {noticeVisible ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[11px] font-medium text-emerald-300 shadow-[0_20px_50px_-20px_rgba(16,185,129,0.8)] backdrop-blur"
        >
          {t("lobby.deposit.success")}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 左侧品类图标：全部是 24×24 的内联描边 SVG，颜色跟随文字（currentColor），
 * 选中态自动变成深色，不需要另配一套图标。
 */
function CategoryIcon({ id }: { id: LobbyCategoryFilter }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "h-3.5 w-3.5 shrink-0",
  };

  switch (id) {
    case "all":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.6" />
          <rect x="14" y="3" width="7" height="7" rx="1.6" />
          <rect x="3" y="14" width="7" height="7" rx="1.6" />
          <rect x="14" y="14" width="7" height="7" rx="1.6" />
        </svg>
      );
    case "hot":
      return (
        <svg {...common}>
          <path d="M12 3c.6 3.2-2.2 4.4-2.2 6.7 0 1.2.9 2 2 2s2-.8 2-2c0-.6-.2-1.1-.5-1.7 2.3 1.2 3.7 3.4 3.7 5.8A5.2 5.2 0 0 1 12 21a5.2 5.2 0 0 1-5-3.2C5.3 13.2 9.4 10.1 12 3Z" />
        </svg>
      );
    case "slot":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M8 9.5h.01M12 9.5h.01M16 9.5h.01M8 14.5h.01M12 14.5h.01M16 14.5h.01" />
        </svg>
      );
    case "live":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
        </svg>
      );
    case "fish":
      return (
        <svg {...common}>
          <path d="M3 12c3-4 7-6 11-6 3 0 5.5 2.5 7 6-1.5 3.5-4 6-7 6-4 0-8-2-11-6Z" />
          <circle cx="9" cy="11" r="0.9" fill="currentColor" stroke="none" />
          <path d="M17 9.5 21 7v10l-4-2.5" />
        </svg>
      );
    case "sport":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.4" />
          <path d="M12 8.2l3 2.2-1.1 3.5H10L8.9 10.4l3.1-2.2Z" />
          <path d="M6.4 8.9l2.5 1.5M17.6 8.9l-2.5 1.5M9.6 18.9l.4-3M14.4 18.9l-.4-3" opacity="0.6" />
        </svg>
      );
    case "poker":
      return (
        <svg {...common}>
          <rect x="3.6" y="6.4" width="8.6" height="12.4" rx="1.6" transform="rotate(-14 8 12.6)" />
          <rect x="11" y="4.8" width="9.4" height="13.6" rx="1.6" />
          <path d="M15.7 9.3c1.1 1.3 2 2 2 3.1a2 2 0 1 1-4 0c0-1.1.9-1.8 2-3.1Z" />
        </svg>
      );
    case "esport":
      return (
        <svg {...common}>
          <path d="M8 8.6h8c2.4 0 4 1.8 4.4 4.4.3 2.4-.6 4.3-2 4.3-1 0-1.7-.6-2.4-1.3-.5-.5-1-.9-1.7-.9h-4.6c-.7 0-1.2.4-1.7.9-.7.7-1.4 1.3-2.4 1.3-1.4 0-2.3-1.9-2-4.3C4 10.4 5.6 8.6 8 8.6Z" />
          <path d="M8.2 10.8v3M6.7 12.3h3" />
          <circle cx="15.4" cy="11.6" r="0.95" fill="currentColor" stroke="none" />
          <circle cx="17.2" cy="13.6" r="0.95" fill="currentColor" stroke="none" />
        </svg>
      );
    case "cockfight":
      return (
        <svg {...common}>
          <path d="M11 5.9c.7-1 1.6-1.3 2.2-.5.4.6.4 1.2.1 2" />
          <circle cx="12.2" cy="10.6" r="3.8" />
          <path d="M16.1 9.8h2.1l-2.1 1.5" />
          <path d="M12.6 14.2c-.2 1.2.5 1.8 1.5 1.8s1.7-.7 1.7-1.6" />
          <path d="M8.6 11.3c-1.7.8-2.7 2.4-2.7 4.2 0 2 1.4 3.5 3.5 3.5 1.5 0 2.7-.7 3.3-1.8" />
          <circle cx="13.2" cy="10.4" r="0.55" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
