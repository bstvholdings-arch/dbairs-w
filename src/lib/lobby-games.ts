import type { TFunction, TranslationKey } from "./i18n-types";

/**
 * 玩家大厅左侧分类。
 * hot 是跨品类推荐位，其余对应真实品类（与后台 Game.category 取值一一对应）。
 */
export type LobbyCategoryId =
  | "hot"
  | "slot"
  | "live"
  | "sport"
  | "poker"
  | "fish"
  | "esport"
  | "cockfight";

export type LobbyCategoryFilter = "all" | LobbyCategoryId;

/**
 * 封面图形：全部用内联 SVG 绘制（见 components/lobby/game-emblem.tsx），
 * 不依赖任何外部图片，离线也能保持「博彩封面」质感。
 */
export type LobbyGameEmblem =
  | "reels"
  | "cards"
  | "rooster"
  | "mahjong"
  | "dragon"
  | "fish"
  | "dice"
  | "coin"
  | "crown"
  | "clover"
  | "ball"
  | "gamepad";

/** 封面配色：高饱和渐变 + 图形，替代风景 / 建筑占位图。 */
export type LobbyGameArt = {
  /** 渐变深色端 */
  base: string;
  /** 渐变亮色端 + 图形主色（高饱和） */
  accent: string;
  emblem: LobbyGameEmblem;
};

/** 卡片右上角在线人数胶囊 + 封面配色，两者都由 id 稳定推导。 */
export type LobbyGame = {
  id: string;
  titleKey: TranslationKey;
  /** 没有可用 GameProvider 时的回退游戏商名称 */
  provider: string;
  categories: LobbyCategoryId[];
  /** 卡片右上角在线人数胶囊（300 ~ 1500，客户端会持续跳动） */
  online: number;
  art: LobbyGameArt;
  /** 真实封面图（后台 / 内置素材给出的图）；没有时用 art 的渐变 + 品类图形兜底 */
  imageUrl?: string;
};

/** GET /api/providers 返回的上架中游戏商（大厅顶部筛选 Tab + 品牌墙的数据源） */
export type LobbyProviderOption = {
  id: string;
  name: string;
  /** 已同步的游戏数量，仅用于展示 */
  gameCount?: number;
  /** 品牌墙顺序：数字越大越靠前（来自 GameProvider.sortOrder） */
  sortOrder?: number;
  /** 是否进入首页品牌墙；false 时品牌墙跳过该游戏商（展馆页仍然可访问） */
  showInShowcase?: boolean;
};

/** GET /api/games 返回的游戏记录（数据库同步数据） */
export type LobbyGameRecord = {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  /** slot / live / fish，来自 Game.category */
  category: string;
  sortOrder: number;
  /**
   * 游戏商同步过来的真实封面图（Game.iconUrl）。
   * 可选：老接口 / 内置目录没有这个字段时按「无封面」处理，走渐变占位。
   */
  iconUrl?: string | null;
};

/**
 * 大厅卡片的统一渲染结构：
 * 数据库同步来的游戏与内置回退目录都会被转换成这一种形状，
 * 这样 GameCard 只关心「标题 / 游戏商 / 在线人数 / 封面图 / 占位配色」五件事。
 */
export type LobbyGameCard = {
  id: string;
  /** 数据库同步过来的游戏名；为空时用 titleKey 取词典文案 */
  name: string | null;
  titleKey: TranslationKey | null;
  providerId: string | null;
  providerLabel: string;
  categories: LobbyCategoryId[];
  online: number;
  art: LobbyGameArt;
  /**
   * 卡片主体：游戏商的真实封面图（已做 URL 白名单校验）。
   * null = 这条游戏没有封面图，GameCard 用 art 的渐变 + 品类图形兜底。
   */
  imageUrl: string | null;
};

/**
 * 封面图兜底校验：只接受 http(s)://、站内绝对路径 /xxx、data:image/，
 * 其它（javascript:、file:、畸形值…）一律当作「没有封面图」，
 * 避免脏数据把 <img src> 变成 XSS 入口或破图。
 */
export function readGameImageUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  if (
    /^https?:\/\//i.test(trimmed) ||
    /^\/(?!\/)/.test(trimmed) ||
    /^data:image\//i.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

/**
 * 大厅游戏目录（Mock 数据）。
 * 卡片左下角显示的游戏商名称优先取后台 GameProvider 里已启用的真实游戏商，
 * 只有在数据库不可用 / 没有启用游戏商时才使用这里的回退名称。
 */
export const LOBBY_GAMES: LobbyGame[] = [
  {
    id: "mahjong-ways",
    titleKey: "lobby.game.mahjongWays",
    provider: "PG Soft",
    categories: ["hot", "slot"],
    online: 1284,
    art: { base: "#0d3b2e", accent: "#22c55e", emblem: "mahjong" },
  },
  {
    id: "gates-of-olympus",
    titleKey: "lobby.game.gatesOfOlympus",
    provider: "Pragmatic Play",
    categories: ["hot", "slot"],
    online: 1420,
    art: { base: "#2b1065", accent: "#a855f7", emblem: "crown" },
  },
  {
    id: "fortune-tiger",
    titleKey: "lobby.game.fortuneTiger",
    provider: "PG Soft",
    categories: ["hot", "slot"],
    online: 1360,
    art: { base: "#4a1503", accent: "#f97316", emblem: "reels" },
  },
  {
    id: "sweet-bonanza",
    titleKey: "lobby.game.sweetBonanza",
    provider: "Pragmatic Play",
    categories: ["hot", "slot"],
    online: 1310,
    art: { base: "#4a0d3a", accent: "#ec4899", emblem: "clover" },
  },
  {
    id: "wild-bandito",
    titleKey: "lobby.game.wildBandito",
    provider: "PG Soft",
    categories: ["slot"],
    online: 870,
    art: { base: "#3b2a06", accent: "#eab308", emblem: "coin" },
  },
  {
    id: "caishen-wins",
    titleKey: "lobby.game.caishenWins",
    provider: "PG Soft",
    categories: ["slot"],
    online: 990,
    art: { base: "#4a0d0d", accent: "#ef4444", emblem: "coin" },
  },
  {
    id: "sugar-rush",
    titleKey: "lobby.game.sugarRush",
    provider: "Pragmatic Play",
    categories: ["slot"],
    online: 1130,
    art: { base: "#33114a", accent: "#d946ef", emblem: "clover" },
  },
  {
    id: "big-bass-bonanza",
    titleKey: "lobby.game.bigBass",
    provider: "Pragmatic Play",
    categories: ["slot"],
    online: 760,
    art: { base: "#052e3b", accent: "#06b6d4", emblem: "fish" },
  },
  {
    id: "lucky-neko",
    titleKey: "lobby.game.luckyNeko",
    provider: "PG Soft",
    categories: ["slot"],
    online: 640,
    art: { base: "#0b3b2f", accent: "#10b981", emblem: "mahjong" },
  },
  {
    id: "cockfight-king",
    titleKey: "lobby.game.cockfightKing",
    provider: "JDB",
    categories: ["cockfight"],
    online: 1150,
    art: { base: "#3f1204", accent: "#f43f5e", emblem: "rooster" },
  },
  {
    id: "speed-baccarat",
    titleKey: "lobby.game.speedBaccarat",
    provider: "Evolution",
    categories: ["hot", "live"],
    online: 1490,
    art: { base: "#3a1004", accent: "#f59e0b", emblem: "cards" },
  },
  {
    id: "crazy-time",
    titleKey: "lobby.game.crazyTime",
    provider: "Evolution",
    categories: ["hot", "live"],
    online: 1480,
    art: { base: "#2a0b4a", accent: "#8b5cf6", emblem: "dice" },
  },
  {
    id: "lightning-roulette",
    titleKey: "lobby.game.lightningRoulette",
    provider: "Evolution",
    categories: ["live"],
    online: 1420,
    art: { base: "#101a3b", accent: "#6366f1", emblem: "dice" },
  },
  {
    id: "dragon-tiger",
    titleKey: "lobby.game.dragonTiger",
    provider: "Evolution",
    categories: ["live"],
    online: 1010,
    art: { base: "#3b0a1f", accent: "#e11d48", emblem: "dragon" },
  },
  {
    id: "sic-bo",
    titleKey: "lobby.game.sicBo",
    provider: "Evolution",
    categories: ["live"],
    online: 720,
    art: { base: "#06303b", accent: "#22d3ee", emblem: "dice" },
  },
  {
    id: "jackpot-fishing",
    titleKey: "lobby.game.jackpotFishing",
    provider: "JDB",
    categories: ["hot", "fish"],
    online: 1340,
    art: { base: "#04283b", accent: "#0ea5e9", emblem: "fish" },
  },
  {
    id: "dragon-fishing",
    titleKey: "lobby.game.dragonFishing",
    provider: "JDB",
    categories: ["fish"],
    online: 880,
    art: { base: "#052f2a", accent: "#14b8a6", emblem: "dragon" },
  },
  {
    id: "ocean-king",
    titleKey: "lobby.game.oceanKing",
    provider: "JDB",
    categories: ["fish"],
    online: 790,
    art: { base: "#062044", accent: "#3b82f6", emblem: "fish" },
  },
  {
    id: "fishing-war",
    titleKey: "lobby.game.fishingWar",
    provider: "JDB",
    categories: ["fish"],
    online: 610,
    art: { base: "#2b0a33", accent: "#c026d3", emblem: "fish" },
  },
  {
    id: "saba-sportsbook",
    titleKey: "lobby.game.sabaSportsbook",
    provider: "SABA Sports",
    categories: ["hot", "sport"],
    online: 1240,
    art: { base: "#062a3f", accent: "#0ea5e9", emblem: "ball" },
  },
  {
    id: "bti-sports",
    titleKey: "lobby.game.btiSports",
    provider: "BTI Sports",
    categories: ["sport"],
    online: 860,
    art: { base: "#12321f", accent: "#22c55e", emblem: "ball" },
  },
  {
    id: "idn-poker",
    titleKey: "lobby.game.idnPoker",
    provider: "IDN Poker",
    categories: ["poker"],
    online: 940,
    art: { base: "#2b1065", accent: "#a855f7", emblem: "cards" },
  },
  {
    id: "texas-holdem-pro",
    titleKey: "lobby.game.texasHoldem",
    provider: "IDN Poker",
    categories: ["poker"],
    online: 720,
    art: { base: "#3b0a1f", accent: "#e11d48", emblem: "cards" },
  },
  {
    id: "esport-arena",
    titleKey: "lobby.game.esportArena",
    provider: "TF Gaming",
    categories: ["esport"],
    online: 1080,
    art: { base: "#101a3b", accent: "#6366f1", emblem: "gamepad" },
  },
  {
    id: "battle-royale-live",
    titleKey: "lobby.game.battleRoyale",
    provider: "TF Gaming",
    categories: ["esport"],
    online: 690,
    art: { base: "#2b0a33", accent: "#c026d3", emblem: "gamepad" },
  },
  {
    id: "meron-wala",
    titleKey: "lobby.game.meronWala",
    provider: "JDB",
    categories: ["cockfight"],
    online: 1320,
    art: { base: "#3f1204", accent: "#f59e0b", emblem: "rooster" },
  },
];

/** 顶部导航展示的分类顺序。 */
export const LOBBY_CATEGORY_ORDER: LobbyCategoryFilter[] = [
  "all",
  "hot",
  "slot",
  "live",
  "sport",
  "poker",
  "fish",
  "esport",
  "cockfight",
];

export function matchesCategory(
  game: { categories: LobbyCategoryId[] },
  category: LobbyCategoryFilter,
): boolean {
  return category === "all" || game.categories.includes(category);
}

/** 封面配色池：数据库游戏没有 iconUrl 时按 id 稳定哈希取一组。 */
const ART_PRESETS: LobbyGameArt[] = [
  { base: "#0d3b2e", accent: "#22c55e", emblem: "reels" },
  { base: "#2b1065", accent: "#a855f7", emblem: "cards" },
  { base: "#4a1503", accent: "#f97316", emblem: "dice" },
  { base: "#4a0d3a", accent: "#ec4899", emblem: "clover" },
  { base: "#101a3b", accent: "#6366f1", emblem: "crown" },
  { base: "#052e3b", accent: "#06b6d4", emblem: "fish" },
  { base: "#3b2a06", accent: "#eab308", emblem: "coin" },
  { base: "#3b0a1f", accent: "#e11d48", emblem: "dragon" },
  { base: "#3f1204", accent: "#f43f5e", emblem: "rooster" },
  { base: "#12261a", accent: "#84cc16", emblem: "mahjong" },
];

/** 品类默认图形：同一品类里再按 id 轮换，保证网格不会满屏同一个图标。 */
const CATEGORY_EMBLEMS: Record<LobbyCategoryId, LobbyGameEmblem[]> = {
  hot: ["reels", "crown", "dragon", "coin"],
  slot: ["reels", "reels", "cards", "rooster", "clover", "coin"],
  live: ["cards", "cards", "dice", "crown"],
  sport: ["ball", "ball", "crown", "coin"],
  poker: ["cards", "cards", "crown", "coin"],
  fish: ["fish", "fish", "dragon", "coin"],
  esport: ["gamepad", "gamepad", "dragon", "crown"],
  cockfight: ["rooster", "rooster", "crown", "coin"],
};

/** 稳定的字符串哈希：同一个 key 永远得到同一张封面 / 同一个在线人数。 */
function hashKey(key: string): number {
  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 2147483647;
  }

  return hash;
}

/** 把 Game.category 归一化成大厅分类，未知值按 slot 处理。 */
export function normalizeGameCategory(value: string): LobbyCategoryId {
  switch (value) {
    case "slot":
    case "live":
    case "sport":
    case "poker":
    case "fish":
    case "esport":
    case "cockfight":
      return value;
    default:
      return "slot";
  }
}

export function artForKey(key: string, category: LobbyCategoryId): LobbyGameArt {
  const preset = ART_PRESETS[hashKey(key) % ART_PRESETS.length];
  const emblems = CATEGORY_EMBLEMS[category];
  const emblem = emblems[hashKey(`${key}-emblem`) % emblems.length];

  return { ...preset, emblem };
}

/** 在线人数下限：人数跳动永远不能跌破 300。 */
export const LOBBY_ONLINE_MIN = 300;
/** 在线人数上限：基础人数随机区间 300 ~ 1500。 */
export const LOBBY_ONLINE_MAX = 1500;

/**
 * 演示用的「基础在线人数」：300 ~ 1500 之间。
 * 真实在线人数需要游戏商 / 网关侧的实时统计，这里由游戏 id 稳定推导，
 * 保证 SSR 与客户端首帧一致（否则会 hydration 不匹配）；后续跳动由
 * components/lobby/use-online-count.ts 在客户端完成。
 */
export function onlineCountFor(key: string): number {
  const span = LOBBY_ONLINE_MAX - LOBBY_ONLINE_MIN + 1;

  return LOBBY_ONLINE_MIN + (hashKey(`online-${key}`) % span);
}

/** 热门 = sortOrder 最高的前 N 款；后台把想推荐的游戏排序调高即可。 */
export const LOBBY_HOT_LIMIT = 6;

/**
 * 把 /api/games 返回的数据库游戏转换成卡片数据。
 * 输入已按 sortOrder 降序，这里再排一次以保证客户端刷新后顺序一致。
 */
export function buildCardsFromRecords(
  records: readonly LobbyGameRecord[],
): LobbyGameCard[] {
  const sorted = [...records].sort(
    (left, right) =>
      right.sortOrder - left.sortOrder || left.name.localeCompare(right.name),
  );

  const hotIds = new Set(sorted.slice(0, LOBBY_HOT_LIMIT).map((item) => item.id));

  return sorted.map((record) => {
    const category = normalizeGameCategory(record.category);

    return {
      id: record.id,
      name: record.name,
      titleKey: null,
      providerId: record.providerId,
      providerLabel: record.providerName,
      categories: hotIds.has(record.id) ? [category, "hot"] : [category],
      online: onlineCountFor(record.id),
      art: artForKey(record.id, category),
      // 真实封面图优先；没有就交给 GameCard 用渐变 + 品类图形兜底
      imageUrl: readGameImageUrl(record.iconUrl),
    };
  });
}

export function mockProviderId(name: string): string {
  return `mock-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * 数据库还没有同步任何游戏时的回退目录。
 * 保证刚部署 / 清库后大厅依然有内容可看，而不是一片空白。
 */
export function buildMockLobby(): {
  cards: LobbyGameCard[];
  providers: LobbyProviderOption[];
} {
  const providers: LobbyProviderOption[] = [
    ...new Set(LOBBY_GAMES.map((game) => game.provider)),
  ].map((name) => ({ id: mockProviderId(name), name }));

  const cards: LobbyGameCard[] = LOBBY_GAMES.map((game) => ({
    id: game.id,
    name: null,
    titleKey: game.titleKey,
    providerId: mockProviderId(game.provider),
    providerLabel: game.provider,
    categories: game.categories,
    online: game.online,
    art: game.art,
    imageUrl: readGameImageUrl(game.imageUrl),
  }));

  return { cards, providers };
}

/** 卡片标题：数据库游戏用游戏名，回退目录用词典文案。 */
export function cardTitle(card: LobbyGameCard, t: TFunction): string {
  if (card.name) {
    return card.name;
  }

  return card.titleKey ? t(card.titleKey) : card.id;
}

