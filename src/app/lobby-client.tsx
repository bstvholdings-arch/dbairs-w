"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TenantBrandLockup } from "@/components/brand/tenant-brand";
import { LobbyActionBar, type LobbyActionId } from "@/components/lobby/action-bar";
import { PlayerDepositModal } from "@/components/player/deposit-modal";
import { PlayerBottomNav } from "@/components/player/player-bottom-nav";
import {
  ComingSoonDialog,
  ConnectingDialog,
} from "@/components/lobby/game-dialogs";
import { GameCard } from "@/components/lobby/game-card";
import {
  MissionMedalIcon,
  ReferralGiftIcon,
  WithdrawIcon,
} from "@/components/lobby/hall-actions";
import { HeroCarousel, type HeroBannerMetric } from "@/components/lobby/hero-carousel";
import {
  PromoHeroCarousel,
  type HeroPromoBanner,
} from "@/components/lobby/promo-hero-carousel";
import { ProviderWall } from "@/components/lobby/provider-wall";
import { SidebarCasinoAnimation } from "@/components/lobby/sidebar-casino-animation";
import { SupportChatDialog } from "@/components/lobby/support-chat-dialog";
import { WinnerTicker } from "@/components/lobby/winner-ticker";
import { formatInteger } from "@/lib/format";
import { resolveBrandName } from "@/lib/brand";
import {
  formatCurrency,
  formatDisplayAmount,
  normalizeCurrency,
} from "@/lib/currency";
import { availableBalanceToString } from "@/lib/player-balance";
import { subscribePlayerWalletChanged } from "@/lib/player-wallet-events";
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
import {
  buildStorefrontTheme,
  type StorefrontModuleId,
  type StorefrontSettings,
} from "@/lib/storefront";
import { buildStorefrontPresetStyle } from "@/lib/storefront-presets";
import { buildThemeBackgroundStyle } from "@/lib/theme-backgrounds";

/** 大厅顶栏需要的玩家摘要；余额已由服务端序列化成字符串。 */
export type LobbyPlayerSummary = {
  id: string;
  username: string;
  balance: string;
  /** 处理中的提现单合计：pending 阶段不扣余额，可用余额要单独减 */
  pendingWithdrawalAmount: string;
  /** 可用余额 = balance − 在途提现；顶栏 BALANCE 展示这一项 */
  availableBalance: string;
  referralCode: string;
};

type PlayerMeResponse = {
  player?: LobbyPlayerSummary;
  error?: string;
};


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
  initialPlayer = null,
  previewTenantKey = null,
  heroBanners = [],
}: {
  initialProviders: LobbyProviderOption[];
  initialGames: LobbyGameRecord[];
  /** 后台装修配置：主色 + 三大模块的开关与顺序 */
  storefront: StorefrontSettings;
  /** 服务端预取的当前玩家，避免首屏先显示「登录 / 注册」再跳成头像 */
  initialPlayer?: LobbyPlayerSummary | null;
  /**
   * 本次访问的 `?tenant=`（后台【预览前台】/ 联调用）。
   * 非空表示「预览模式」：所有站内跳转都要带上它，否则点到二级页
   * （展馆 / 登录 / 玩家中心）就会丢掉租户上下文、回落到别家站点。
   */
  previewTenantKey?: string | null;
  /**
   * Hero 海报（后台【活动管理】里启用中的活动，最多 5 张，服务端已按租户取好）。
   * 有图 → 全屏轮播海报；空数组 → 自动退回内置文案轮播（原 Hero 保底兜底）。
   */
  heroBanners?: HeroPromoBanner[];
}) {
  const { t } = useLanguage();
  const router = useRouter();

  // 租户记账货币（Tenant.currency）：大厅顶栏 BALANCE、奖池等所有金额都用它渲染符号，
  // 不允许再写死 `$`。见 src/lib/currency.ts。
  const walletCurrency = useMemo(
    () => normalizeCurrency(storefront.currency),
    [storefront.currency],
  );

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

  // 排版模板：与配色完全解耦。模板只往根节点补一组 --sf-* 版式变量，
  // 组件树、数据流一份不动，具体分栏规则见 globals.css 的排版模板区块。
  const presetStyle = useMemo(
    () => buildStorefrontPresetStyle(storefront.preset),
    [storefront.preset],
  );

  // 主题背景色（15 选 1）：只产出 --tb-base / --tb-accent / --tb-rgb 三个变量，
  // 由根节点继承给环境光晕与所有游戏卡片（规则见 globals.css 的「主题背景色」区块）。
  // 卡片组件本身不接收任何颜色 prop —— 换主题色不需要动组件。
  const backgroundStyle = useMemo(
    () => buildThemeBackgroundStyle(storefront.themeBackground),
    [storefront.themeBackground],
  );

  // ── 白标品牌区 ─────────────────────────────────────────────────────────
  // Logo 与名称都来自当前租户（Tenant.logoUrl / Tenant.name），由
  // lib/storefront-data.ts 按「?tenant= → 访问域名 → 已登录商户 → 默认租户」
  // 解析后随 storefront 一起下发，所以同一个构建既能服务 winvora.cc 也能服务别家域名。
  // 只有连商户名都取不到时，resolveBrandName 才回落到平台名。
  // 渲染统一交给 TenantBrandLockup（加载失败回退、首字母占位都在组件内），
  // 页脚版权行与充值弹窗页脚复用同一个 brandName，避免各写一份出现穿帮。
  const brandName = resolveBrandName(storefront.tenantName);

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
  const [noticeVisible, setNoticeVisible] = useState(false);
  // Mission / Withdraw 仍是占位入口；Deposit / Referral / Auth 已接真实玩家账户。
  const [comingSoon, setComingSoon] = useState<ComingSoonFeature | null>(null);
  // Live Jackpot：amount 当前奖池，gain 本次增量（0 表示还没涨过），tick 用来重播跳动动画。
  const [jackpot, setJackpot] = useState({
    amount: JACKPOT_SEED_AMOUNT,
    gain: 0,
    tick: 0,
  });

  // 玩家账户：服务端先给一份 initialPlayer，挂载后再用 /api/player/me 校准余额与登录态。
  const [player, setPlayer] = useState<LobbyPlayerSummary | null>(initialPlayer);
  const [playerLoading, setPlayerLoading] = useState(!initialPlayer);
  const [playerDepositOpen, setPlayerDepositOpen] = useState(false);
  // 顶栏 AI 客服：由后台装修 showTopbarChat 控制入口，点击后弹出客服窗口。
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const connectingTitleId = useId();
  const comingSoonTitleId = useId();

  const refreshPlayer = useCallback(async () => {
    try {
      const response = await fetch("/api/player/me", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data: PlayerMeResponse = await response
        .json()
        .catch(() => ({}) as PlayerMeResponse);

      if (!response.ok || !data.player) {
        setPlayer(null);
        return;
      }

      setPlayer({
        id: data.player.id,
        username: data.player.username,
        balance: data.player.balance,
        pendingWithdrawalAmount: data.player.pendingWithdrawalAmount ?? "0",
        availableBalance:
          data.player.availableBalance ??
          availableBalanceToString(
            data.player.balance,
            data.player.pendingWithdrawalAmount,
          ),
        referralCode: data.player.referralCode,
      });
    } catch {
      // 网络异常时保留当前画面，避免把已登录玩家误判成游客。
    } finally {
      setPlayerLoading(false);
    }
  }, []);

  // 把服务端返回的权威余额落到顶栏 state（乐观展示）：
  // 充值只会加钱、不会新增在途提现单，所以可用余额可以本地推算；
  // 算完总会再拉一次 /api/player/me，以服务端账本为准覆盖（并发到账 / 在途提现都可能让推算偏）。
  const applyWalletBalance = useCallback((balance: string) => {
    setPlayer((current) =>
      current
        ? {
            ...current,
            balance,
            availableBalance: availableBalanceToString(
              balance,
              current.pendingWithdrawalAmount,
            ),
          }
        : current,
    );
  }, []);

  // 只更新可用余额（提现 pending 不扣 Player.balance，余额本身没变）
  const applyAvailableBalance = useCallback((availableBalance: string) => {
    setPlayer((current) =>
      current ? { ...current, availableBalance } : current,
    );
  }, []);

  useEffect(() => {
    // refreshPlayer 内部先 await 再 setState，属于异步回填而非同步级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshPlayer();
  }, [refreshPlayer]);

  // 从游戏商页面返回 / 切回大厅标签页时重新校准余额，
  // 避免玩家在别处充值后仍看到旧余额。
  useEffect(() => {
    function syncPlayer() {
      void refreshPlayer();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        syncPlayer();
      }
    }

    window.addEventListener("focus", syncPlayer);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", syncPlayer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshPlayer]);

  // 充值 / 提现成功后（玩家中心、充值弹窗都会广播）：
  // 1) 广播里带了服务端刚算好的余额 → 顶栏立刻重绘，不等任何往返；
  // 2) 再拉一次 /api/player/me，以账本为准纠正（多笔并发 / 在途提现）。
  // 少了第 1 步，网络慢的时候就会出现「弹窗说已到账、Header 还是旧余额」。
  useEffect(
    () =>
      subscribePlayerWalletChanged((detail) => {
        if (detail.balance) {
          applyWalletBalance(detail.balance);
        } else if (detail.availableBalance) {
          applyAvailableBalance(detail.availableBalance);
        }

        void refreshPlayer();
      }),
    [applyAvailableBalance, applyWalletBalance, refreshPlayer],
  );

  // 支付商回调是**异步到账**：玩家挂着充值弹窗等 1-3 分钟时没有任何事件可订阅，
  // 只能定时校准。只在弹窗打开期间轮询，关闭即停，不在后台空转。
  useEffect(() => {
    if (!playerDepositOpen) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshPlayer();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [playerDepositOpen, refreshPlayer]);

  // 头像下拉：点击外部或按 Esc 关闭。
  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);


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

  // 该品类后台还没有上架任何游戏（例如刚补上的 Sport / Cockfight）：
  // 显示「即将上线」而不是像搜索失败一样的「无结果」。
  const emptyCategory =
    category !== "all" && (categoryCounts.get(category) ?? 0) === 0;

  const modalOpen =
    connectingGame !== null ||
    playerDepositOpen ||
    comingSoon !== null ||
    supportChatOpen;

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
      setComingSoon(null);
      setSupportChatOpen(false);
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

    setPlayerDepositOpen(false);
    setConnectingGame(target);
  }

  /** 顶栏客服入口：先收起其它弹层，避免多个遮罩互相叠住。 */
  function openSupportChat() {
    setConnectingGame(null);
    setPlayerDepositOpen(false);
    setComingSoon(null);
    setAccountMenuOpen(false);
    setSupportChatOpen(true);
  }

  /**
   * 预览模式下给任意站内地址补上 `?tenant=`（幂等：已有则覆盖）。
   * 非预览模式（玩家通过自己的白标域名访问）原样返回，不污染 URL。
   */
  function withTenant(href: string): string {
    if (!previewTenantKey) {
      return href;
    }

    const [path, search = ""] = href.split("?");
    const params = new URLSearchParams(search);

    params.set("tenant", previewTenantKey);

    // 登录 / 注册页读的是 site（与大屏脚本、后台链接保持同一口径），两个都带上最稳
    if (path.startsWith("/player/login") || path.startsWith("/player/register")) {
      params.set("site", previewTenantKey);
    }

    return `${path}?${params.toString()}`;
  }

  /** 预览模式下的「大厅首页」地址（登录成功后回到这里，不能丢掉 tenant） */
  const lobbyHomeHref = withTenant("/");
  const loginHref = withTenant(
    `/player/login?next=${encodeURIComponent(lobbyHomeHref)}`,
  );
  const registerHref = withTenant(
    `/player/register?next=${encodeURIComponent(lobbyHomeHref)}`,
  );

  /** 未登录先去登录 / 注册，登录后回到大厅原地址（保留 tenant / 筛选参数）。 */
  function redirectToPlayerAuth(mode: "login" | "register", nextPath?: string) {
    const here = `${window.location.pathname}${window.location.search}`;
    const next = nextPath ?? (here.startsWith("/") ? here : "/");
    const query = new URLSearchParams({ next });
    // 多租户：把当前 ?tenant= 原样传给登录 / 注册，避免回落到别家站点。
    const site =
      previewTenantKey ??
      new URLSearchParams(window.location.search).get("tenant");

    if (site?.trim()) {
      query.set("site", site.trim());
    }

    router.push(`/player/${mode}?${query.toString()}`);
  }

  function openDeposit() {
    setConnectingGame(null);

    if (!player) {
      redirectToPlayerAuth("login");
      return;
    }

    setPlayerDepositOpen(true);
  }

  function handleDepositSuccess(balance?: string | null) {
    if (balance) {
      // 充值只是加钱，不产生在途提现单：本地先把可用余额一起抬高，避免等接口回来才变。
      applyWalletBalance(balance);
    }

    // 但本地值只是「乐观展示」：接口回传的是这笔充值后的余额，若同时还有别的
    // 在途提现 / 多笔并发到账，本地推算就会偏。这里无条件再拉一次
    // /api/player/me，以服务端账本为准覆盖顶栏 BALANCE。
    void refreshPlayer();

    setNoticeVisible(true);
  }

  function closePlayerDeposit() {
    setPlayerDepositOpen(false);
    void refreshPlayer();
  }

  async function handlePlayerLogout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);

    try {
      await fetch("/api/player/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      // 即使接口失败也先把本地界面切成游客态，Cookie 过期后会自动失效。
    } finally {
      setPlayer(null);
      setAccountMenuOpen(false);
      setPlayerDepositOpen(false);
      setLoggingOut(false);
      router.refresh();
    }
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
        value: formatCurrency(jackpot.amount, walletCurrency),
        gain:
          jackpot.gain > 0
            ? formatCurrency(jackpot.gain, walletCurrency, { signed: true })
            : undefined,
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
    [cards.length, jackpot.amount, jackpot.gain, t, totalOnline, walletCurrency],
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

  // 核心功能岛：Deposit / Referral / Withdraw / Auth 已接真实玩家账户，
  // Mission 仍是「即将上线」占位弹窗。
  function handleLobbyAction(action: LobbyActionId) {
    if (action === "deposit") {
      openDeposit();
      return;
    }

    if (action === "auth") {
      if (player) {
        router.push("/player/profile");
      } else {
        redirectToPlayerAuth("login");
      }
      return;
    }

    if (action === "referral") {
      if (player) {
        router.push("/player/profile?tab=referral");
      } else {
        redirectToPlayerAuth("login", "/player/profile?tab=referral");
      }
      return;
    }

    if (action === "withdraw") {
      if (player) {
        router.push("/player/profile?tab=wallet");
      } else {
        redirectToPlayerAuth("login", "/player/profile?tab=wallet");
      }
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
          // 手机端 Hero 是**圆角卡片**：不占满屏、不贴边。main 已有 px-3，
          // 这里再补 4px 凑成 16px（等效设计稿的 mx-4）；≥768px 顶格铺满（md:mx-0）。
          <div key="hero" data-module="hero" className="mx-1 md:mx-0">
            {/* 后台配了启用中的海报 → 海报轮播卡片（点击跳 linkUrl）；
                一张都没配 → 退回原本的暗黑文案轮播（Tonight's luck…），保底兜底。 */}
            {heroBanners.length > 0 ? (
              <PromoHeroCarousel
                banners={heroBanners}
                tenantKey={previewTenantKey}
              />
            ) : (
              <HeroCarousel
                banners={LOBBY_BANNERS}
                metrics={heroMetrics}
                onAction={handleBannerAction}
              />
            )}
          </div>
        );
      case "action":
        return (
          <div
            key="action"
            data-module="action"
            className="flex flex-col gap-3"
          >
            <WinnerTicker />
            <LobbyActionBar
              onAction={handleLobbyAction}
              loggedIn={Boolean(player)}
            />
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
              tenantKey={previewTenantKey}
            />
          </div>
        );
    }
  }

  return (
    <div
      className="tb-lobby-bg relative min-h-screen font-sans text-neutral-200"
      style={
        { ...theme.style, ...presetStyle, ...backgroundStyle } as CSSProperties
      }
      data-storefront-preset={storefront.preset}
      data-theme-background={storefront.themeBackground}
      data-theme-color={theme.brand}
      data-theme-brightness={theme.brightness}
      data-theme-primary={theme.primary}
    >
      {/* 背景：深色底（--tb-base）+ 主题色呼吸光晕 + 品牌金 + 细网格。
          光晕的颜色与节奏全部由 --tb-* 决定，见 globals.css「主题背景色」区块。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="tb-aura -left-40 -top-40 h-[32rem] w-[32rem]" />
        <div className="tb-aura tb-aura--slow bottom-[-18rem] left-1/3 h-[34rem] w-[34rem]" />
        <div className="absolute -right-40 top-10 h-[28rem] w-[28rem] rounded-full bg-brand/10 blur-[150px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--sf-a10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)] [-webkit-mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-brand/10 bg-[#050505]/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2.5 px-3 py-3 sm:px-5 lg:px-8">
          {/*
            品牌区（白标）：Logo + 商户名，统一由 TenantBrandLockup 渲染。
            lg 档 = Logo 44px（sm 以上 48px）+ 商户名 text-xl/2xl，
            没配 Logo 时用商户名首字母做同尺寸金色占位图，二者视觉重量一致。
          */}
          <TenantBrandLockup
            brandName={brandName}
            logoUrl={storefront.tenantLogoUrl}
            size="lg"
            tagline={t("lobby.brandTagline")}
            taglineClassName="hidden sm:block"
          />

          {/* 余额 + 搜索：移动端整行换到第二排，桌面端与品牌区同一条水平中线 */}
          <div className="order-3 flex w-full items-center gap-2 sm:order-2 sm:w-auto sm:flex-1">
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
                {playerLoading && !player
                  ? "…"
                  : player
                    ? formatDisplayAmount(player.availableBalance, walletCurrency)
                    : "—"}
              </span>
              {player ? null : (
                <span className="hidden rounded-full border border-white/10 px-1.5 py-px text-[8px] uppercase tracking-[0.14em] text-neutral-500 md:inline">
                  {t("lobby.guest")}
                </span>
              )}
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

          {/* Header 固定显示 Logo / Balance / Search / Language / 玩家入口 */}
          <div className="order-2 ml-auto flex shrink-0 items-center gap-2 sm:order-3 sm:ml-0">
            {storefront.showTopbarChat ? (
              <button
                type="button"
                onClick={openSupportChat}
                aria-label={t("lobby.support.open")}
                aria-haspopup="dialog"
                aria-expanded={supportChatOpen}
                title={t("lobby.support.open")}
                className="relative flex h-8 w-8 items-center justify-center rounded-full border border-brand/25 bg-black/35 text-brand-soft transition-colors hover:border-brand/55 hover:bg-brand/10 hover:text-brand-pale focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:h-9 sm:w-9"
              >
                <TopbarChatIcon className="h-4 w-4" />
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-[#050505]"
                />
              </button>
            ) : null}

            <LanguageSwitcher languageStyle={storefront.languageStyle} />

            <div ref={accountMenuRef} className="relative">
              {playerLoading && !player ? (
                <span
                  aria-hidden="true"
                  className="block h-9 w-20 animate-pulse rounded-full border border-white/[0.06] bg-white/[0.04]"
                />
              ) : player ? (
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                  className="flex h-9 items-center gap-1.5 rounded-full border border-brand/30 bg-white/[0.03] pl-1 pr-2.5 transition-colors hover:border-brand/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-pale via-brand to-brand-deep text-[11px] font-black text-brand-ink">
                    {player.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden max-w-[92px] truncate text-[11px] font-semibold text-neutral-200 sm:inline">
                    {player.username}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-3 w-3 text-neutral-500 transition-transform ${accountMenuOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Link
                    href={loginHref}
                    onClick={(event) => {
                      event.preventDefault();
                      redirectToPlayerAuth("login");
                    }}
                    className="inline-flex h-8 items-center justify-center rounded-full border border-white/10 px-2.5 text-[10px] font-semibold text-neutral-300 transition-colors hover:border-brand/45 hover:text-brand-pale sm:px-3"
                  >
                    {t("lobby.login")}
                  </Link>
                  <Link
                    href={registerHref}
                    onClick={(event) => {
                      event.preventDefault();
                      redirectToPlayerAuth("register");
                    }}
                    className="inline-flex h-8 items-center justify-center rounded-full bg-gradient-to-r from-brand-deep via-brand to-brand-pale px-2.5 text-[10px] font-bold text-brand-ink transition-opacity hover:opacity-90 sm:px-3"
                  >
                    {t("lobby.register")}
                  </Link>
                </div>
              )}

              {player && accountMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-brand/25 bg-[#0a0a0a] p-1 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.95)]"
                >
                  <div className="border-b border-white/[0.06] px-3 py-2.5">
                    <p className="text-[8px] uppercase tracking-[0.2em] text-neutral-500">
                      {t("lobby.account.signedInAs")}
                    </p>
                    <p className="mt-1 truncate text-xs font-semibold text-neutral-100">
                      {player.username}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-brand-soft/80">
                      {t("lobby.account.code")}: {player.referralCode}
                    </p>
                  </div>

                  <Link
                    role="menuitem"
                    href={withTenant("/player/profile")}
                    onClick={() => setAccountMenuOpen(false)}
                    className="mt-1 flex items-center justify-between rounded-lg px-3 py-2 text-[11px] text-neutral-300 transition-colors hover:bg-brand/10 hover:text-brand-pale"
                  >
                    {t("lobby.account.profile")}
                    <span aria-hidden="true">›</span>
                  </Link>
                  <Link
                    role="menuitem"
                    href={withTenant("/player/profile?tab=referral")}
                    onClick={() => setAccountMenuOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-[11px] text-neutral-300 transition-colors hover:bg-brand/10 hover:text-brand-pale"
                  >
                    {t("lobby.account.referral")}
                    <span aria-hidden="true">›</span>
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => void handlePlayerLogout()}
                    disabled={loggingOut}
                    className="mt-1 flex w-full items-center justify-between rounded-lg border-t border-white/[0.06] px-3 py-2 text-left text-[11px] text-red-300/90 transition-colors hover:bg-red-400/10 hover:text-red-200 disabled:opacity-60"
                  >
                    {loggingOut
                      ? t("player.profile.loggingOut")
                      : t("player.profile.logout")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-[var(--sf-shell-max,1600px)] px-3 pb-28 pt-4 sm:px-5 lg:px-8">
        {/*
          ② ③ ④ 可选模块区：Hero 轮播 / 核心功能岛 / 品牌墙。
          显示与顺序完全由后台【前台装修】的 layoutConfig 决定（Tenant.layoutConfig），
          这里不再写死顺序，改顺序只需要在后台点上移 / 下移。
        */}
        {visibleModules.length > 0 ? (
          <div
            /* 手机端最小 16px（gap-4），平板以上交回模板 token：compact 模板只有
               10px，手机上手会挤在一起（AGENTS.md §4 的排版流不允许重叠 / 挤压）。 */
            className="flex flex-col gap-4 sm:gap-[var(--sf-module-gap,1.25rem)]"
            data-storefront-modules
          >
            {visibleModules.map((id) => renderStorefrontModule(id))}
          </div>
        ) : null}

        {/* ⑤ All Games：左侧品类导航 + 右侧游戏网格（固定显示，不受装修开关影响） */}
        <div
          id="lobby-games"
          className={`flex flex-col gap-4 scroll-mt-24 lg:flex-row lg:gap-6 ${
            visibleModules.length > 0 ? "mt-6" : "mt-1"
          }`}
        >
          {/* 左侧分类导航：桌面 2 列图标卡，手机横向滑动条（单卡 ≥ 64px 高，手指好点） */}
          <aside className="lg:w-[236px] lg:shrink-0">
            <div className="lg:sticky lg:top-[96px]">
              {/* 左侧导航只放游戏品类；游戏商展示全部交给顶部 PROVIDER SHOWCASE 品牌墙 */}
              <nav
                aria-label={t("nav.mainAria")}
                className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-2 lg:gap-2 lg:overflow-visible lg:pb-0"
              >
                {LOBBY_CATEGORY_ORDER.map((id) => {
                  const active = category === id;

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCategory(id)}
                      aria-pressed={active}
                      data-lobby-category={id}
                      data-lobby-category-active={active ? "true" : "false"}
                      className={`group relative flex w-[76px] min-h-[64px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border px-1 pb-1.5 pt-2.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 active:scale-[0.97] lg:w-auto lg:min-h-[74px] ${
                        active
                          ? "border-transparent bg-gradient-to-b from-brand-soft via-brand-mid to-brand-deep text-brand-ink shadow-[0_12px_28px_-14px_var(--sf-a95)]"
                          : "border-white/[0.06] bg-white/[0.02] text-neutral-400 hover:border-brand/30 hover:bg-white/[0.04] hover:text-brand-soft"
                      }`}
                    >
                      <CategoryIcon id={id} />
                      <span className="max-w-full truncate text-[9.5px] font-semibold leading-none tracking-wide sm:text-[10px]">
                        {t(LOBBY_CATEGORY_LABEL_KEYS[id])}
                      </span>
                      <span
                        className={`absolute right-1 top-1 rounded-full px-1 text-[8px] font-bold leading-[1.4] tabular-nums ${
                          active
                            ? "bg-brand-ink/20 text-brand-ink"
                            : "bg-white/[0.06] text-neutral-500"
                        }`}
                      >
                        {categoryCounts.get(id) ?? 0}
                      </span>
                    </button>
                  );
                })}
              </nav>

              {/* 后台装修「互动组件」开启时，在斗鸡分类下方展示娱乐场动态卡片 */}
              {storefront.showSidebarCasinoAnim ? (
                <div className="hidden lg:block">
                  <SidebarCasinoAnimation />
                </div>
              ) : null}
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
              <ul className="grid grid-cols-3 gap-[var(--sf-game-gap,0.75rem)] sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
              © {FOOTER_YEAR} {brandName}
            </span>
            <span>{t("lobby.footer.notice")}</span>
          </div>
        </footer>
      </main>

      {/* 玩家端底部导航（大厅 / 活动 / 我的）：活动大厅 /promotions 的一级入口，
          预览模式下自动透传 ?tenant=（见 components/player/player-bottom-nav.tsx） */}
      <PlayerBottomNav tenantKey={previewTenantKey} />

      {connectingGame ? (
        <ConnectingDialog
          titleId={connectingTitleId}
          providerName={connectingGame.providerLabel}
          onClose={() => setConnectingGame(null)}
        />
      ) : null}

      <SupportChatDialog
        open={supportChatOpen}
        playerName={player?.username ?? null}
        onClose={() => setSupportChatOpen(false)}
      />

      {playerDepositOpen && player ? (
        <PlayerDepositModal
          open
          playerName={player.username}
          brandName={brandName}
          walletCurrency={walletCurrency}
          onClose={closePlayerDeposit}
          onDeposited={handleDepositSuccess}
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
 * 顶栏客服图标：与左侧品类图标保持同一套 24×24 内联描边风格。
 */
function TopbarChatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4.5 13.5v-1.7a7.5 7.5 0 0 1 15 0v1.7" />
      <rect x="3" y="13" width="4" height="6" rx="1.6" />
      <rect x="17" y="13" width="4" height="6" rx="1.6" />
      <path d="M19 19a3 3 0 0 1-3 2.4h-2" />
      <circle cx="13" cy="21.4" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * 左侧品类图标：统一用 emoji —— 一眼能认出玩法、零图片请求、也不受主题色影响。
 *
 * 为什么不用 emoji 图片化 / SVG：emoji 在各端都是彩色字形，
 * 手机上 19px 依旧清晰，后台换主题色也不用重做一套图标。
 * Hot Games 的火焰额外挂 `.tb-flame`（见 globals.css），未选中也在持续跳动。
 */
const LOBBY_CATEGORY_EMOJI = {
  all: "🎮",
  hot: "🔥",
  slot: "🎰",
  live: "🎲",
  sport: "⚽",
  poker: "🃏",
  fish: "🐟",
  esport: "⚽",
  cockfight: "🐓",
} as const satisfies Record<LobbyCategoryFilter, string>;

function CategoryIcon({ id }: { id: LobbyCategoryFilter }) {
  return (
    <span
      aria-hidden="true"
      data-lobby-category-icon={id}
      className={`block shrink-0 select-none text-[19px] leading-none ${
        id === "hot" ? "tb-flame" : ""
      }`}
    >
      {LOBBY_CATEGORY_EMOJI[id]}
    </span>
  );
}
