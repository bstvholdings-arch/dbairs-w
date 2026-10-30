import type { LobbyCategoryId } from "./lobby-games";

/**
 * 从游戏商「拉取」到的游戏条目（Mock）。
 * 真实接入时，只需把 fetchProviderGames() 换成游戏商 OpenAPI 调用，
 * 返回结构保持不变即可，后续写入逻辑（game-sync.ts）完全复用。
 */
export type MockGameSeed = {
  /** 游戏商侧的游戏编码，同步去重键 */
  externalId: string;
  name: string;
  category: LobbyCategoryId;
  /** 初始排序权重：越大越靠前（后台可再手工调整） */
  sortOrder: number;
};

function seeds(entries: Array<[string, string, LobbyCategoryId]>): MockGameSeed[] {
  return entries.map(([externalId, name, category], index) => ({
    externalId,
    name,
    category,
    // 100, 90, 80 ... 保证首次同步后的默认顺序稳定可见
    sortOrder: (entries.length - index) * 10,
  }));
}

/** 模拟 PG Soft 游戏列表（10 款） */
const PG_SOFT_GAMES = seeds([
  ["pg-mahjong-ways-2", "Mahjong Ways 2", "slot"],
  ["pg-fortune-tiger", "Fortune Tiger", "slot"],
  ["pg-fortune-ox", "Fortune Ox", "slot"],
  ["pg-wild-bandito", "Wild Bandito", "slot"],
  ["pg-caishen-wins", "Caishen Wins", "slot"],
  ["pg-treasures-of-aztec", "Treasures of Aztec", "slot"],
  ["pg-bali-vacation", "Bali Vacation", "fish"],
  ["pg-fishing-king", "Fishing King", "fish"],
  ["pg-speed-baccarat", "Speed Baccarat", "live"],
  ["pg-dragon-tiger", "Dragon Tiger", "live"],
]);

/** 模拟 SCR888h5 游戏列表（10 款） */
const SCR888_GAMES = seeds([
  ["scr888-fortune-kingdom", "Fortune Kingdom", "slot"],
  ["scr888-lucky-dragon", "Lucky Dragon", "slot"],
  ["scr888-golden-empire", "Golden Empire", "slot"],
  ["scr888-monkey-king", "Monkey King", "slot"],
  ["scr888-prosperity-lion", "Prosperity Lion", "slot"],
  ["scr888-fish-prawn-crab", "Fish Prawn Crab", "live"],
  ["scr888-roulette-deluxe", "Roulette Deluxe", "live"],
  ["scr888-baccarat-classic", "Baccarat Classic", "live"],
  ["scr888-ocean-hunter", "Ocean Hunter", "fish"],
  ["scr888-deep-sea-fishing", "Deep Sea Fishing", "fish"],
]);

/** 其他游戏商的通用 fallback 目录（保证「同步游戏」按钮对任何游戏商都可用） */
const GENERIC_GAMES = seeds([
  ["g-legend-of-poseidon", "Legend of Poseidon", "slot"],
  ["g-golden-fortune", "Golden Fortune", "slot"],
  ["g-candy-crush-slots", "Candy Rush Slots", "slot"],
  ["g-lucky-888", "Lucky 888", "slot"],
  ["g-diamond-strike", "Diamond Strike", "slot"],
  ["g-live-blackjack", "Live Blackjack", "live"],
  ["g-live-sic-bo", "Live Sic Bo", "live"],
  ["g-lightning-roulette", "Lightning Roulette", "live"],
  ["g-dragon-fishing", "Dragon Fishing", "fish"],
  ["g-jackpot-fishing", "Jackpot Fishing", "fish"],
]);

/**
 * 按游戏商名称挑选 Mock 目录。
 * 真实接入时替换成请求游戏商接口，其余流程不变。
 */
export function fetchMockProviderGames(providerName: string): MockGameSeed[] {
  const key = providerName.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (key.includes("pgsoft") || key.startsWith("pg")) {
    return PG_SOFT_GAMES;
  }

  if (key.includes("scr888")) {
    return SCR888_GAMES;
  }

  return GENERIC_GAMES;
}
