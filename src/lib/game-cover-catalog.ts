/**
 * 示例游戏封面池（Demo Cover Pool）。
 *
 * 为什么需要这一层：内置 Mock 目录（`src/lib/game-catalog.ts`）与回退大厅
 * （`LOBBY_GAMES`）原本没有封面图，卡片只能走「渐变 + 品类图形」占位，
 * 前台一片色块、看不出真实观感。这里集中放一批**真实照片**，让
 * 大厅 / 品牌展馆 / 主题色演示页在**没有任何真实游戏商接口**的情况下
 * 也能立刻看到「纯黑背景 + 一张张真实游戏图」的效果。
 *
 * 三条硬规则：
 * 1. **只做兜底，不覆盖真实数据**：`Game.iconUrl` 有值就永远用真实封面，
 *    本文件只在该字段为空 / 脏值时补位（见 lobby-games.ts）。
 * 2. **一处维护**：颜色不进组件、图片也不进组件 —— 新增 / 替换图片 =
 *    改本文件的表，不碰 `game-card.tsx`、不碰任何页面。
 * 3. **地址必须可校验**：统一走 Unsplash 的 `w/h/fit=crop` 裁成正方形，
 *    卡片 `object-cover` 直接铺满，不二次裁切、不拉伸。
 *
 * 授权：Unsplash License（可商用、免署名、免授权费）。真实接入游戏商后
 * 由上游 `iconUrl` 接管，这张表可以整表删掉而不影响任何逻辑。
 *
 * 本文件是纯 TS，服务端与客户端共用；不 import React、不查库。
 */

/**
 * Unsplash 图片统一取 **560×560 正方形**：
 * - 大厅卡片最大约 200 CSS px（2xl 六列），560 足够覆盖 2x 屏且不吃带宽；
 * - `fit=crop` 在 CDN 侧裁好正方形，`object-cover` 不会二次裁切主体；
 * - `auto=format` 让 CDN 按浏览器给 webp，实测单张 50~90KB。
 */
function coverPhoto(photoId: string): string {
  return `https://images.unsplash.com/${photoId}?w=560&h=560&fit=crop&q=72&auto=format`;
}

/**
 * 封面池：键名是「画面内容」，值是可校验的真实图片地址。
 *
 * 用有语义的键（而不是 `slot1` / `slot2`）是为了让 Mock 数据里一眼看出
 * 这张图是什么：`LOBBY_GAMES` 里写 `imageUrl: DEMO_GAME_COVER.mahjongTilesCloseup`
 * 比 `DEMO_GAME_COVERS[17]` 好维护得多（换图、加图都不会错位）。
 */
export const DEMO_GAME_COVER = {
  /** 金碧辉煌的老虎机大厅（金调，最像「财神爷」类机台） */
  slotFloorGolden: coverPhoto("photo-1596838132731-3301c3fd4317"),
  /** 俯瞰机台阵列（紫粉调，整片灯光铺满） */
  slotFloorAerial: coverPhoto("photo-1541267646418-54dd246a53db"),
  /** 紫调机台特写（LOGO 高亮） */
  slotNeonPurple: coverPhoto("photo-1517085908802-f56a43681c18"),
  /** 复古红调机台（老式拉杆机） */
  slotRetroRed: coverPhoto("photo-1521364577880-a15e92cbff6f"),
  /** 机台浅景深特写（暖色光斑） */
  slotCloseupBokeh: coverPhoto("photo-1525018667593-176858caed6a"),
  /** 机台特写 + 霓虹虚化背景 */
  slotCloseupGlow: coverPhoto("photo-1579026856450-0e24bf0969e0"),
  /** 一排机台（紫蓝灯光纵深） */
  slotRowPurple: coverPhoto("photo-1580088189078-4791d8cfaa78"),
  /** 高奖池机台塔（Jackpot 塔灯） */
  slotJackpotTower: coverPhoto("photo-1582656975064-04e9452fc60e"),
  /** 整面机台墙（暖光投币椅） */
  slotWallGlow: coverPhoto("photo-1586223110870-1fc69221a29a"),
  /** 轮盘赌桌 + 筹码塔（真人荷官） */
  rouletteTableChips: coverPhoto("photo-1517232115160-ff93364542dd"),
  /** 轮盘特写（红黑格） */
  rouletteWheelClose: coverPhoto("photo-1592602944193-0848995f4b5a"),
  /** 轮盘 + 彩色筹码（俯视全景） */
  rouletteWheelGold: coverPhoto("photo-1625888791210-40ea41c1d0f3"),
  /** 扑克 / 骰子 / 筹码 / 钞票平铺 */
  pokerTableFlatlay: coverPhoto("photo-1606559497615-e4787c3c75a1"),
  /** 展开的扑克牌（红心 A 压面） */
  pokerCardsFan: coverPhoto("photo-1497879332819-0c31381c0dad"),
  /** 红色牌背纹理（满版） */
  pokerCardBacks: coverPhoto("photo-1568860161401-fc6bbea94914"),
  /** 霓虹灯下的骰子（手中抛出） */
  diceNeonHand: coverPhoto("photo-1553481187-be93c21490a9"),
  /** 三颗骰子（纯黑底，极简） */
  diceBlackSet: coverPhoto("photo-1608231883522-2efb1897a608"),
  /** 金条（深蓝底） */
  goldBarsBlue: coverPhoto("photo-1718752773168-a44aa1601ddd"),
  /** 金条堆（白金质感） */
  goldBarsStack: coverPhoto("photo-1718752773197-37ade541a72b"),
  /** 麻将牌局（紫色牌桌，人手出牌） */
  mahjongHandsPurple: coverPhoto("photo-1518245078939-75312b6f72c6"),
  /** 麻将牌堆特写（绿色牌背） */
  mahjongTilesCloseup: coverPhoto("photo-1568360891473-99e582334123"),
  /** 麻将牌铺满桌面（人手摸牌） */
  mahjongHandsWhite: coverPhoto("photo-1596760203689-25b5c53b4c78"),
  /** 拉斯维加斯夜景（金色铁塔） */
  vegasParisNight: coverPhoto("photo-1633528760048-3323e024876d"),
  /** 拉斯维加斯霓虹街景 */
  vegasStripNeon: coverPhoto("photo-1638836894907-b72c781017c2"),
  /** 酒店灯光俯瞰（粉紫调） */
  vegasHotelAerial: coverPhoto("photo-1649747320408-d3759b1e4f5f"),
  /** 夜战球场（看台 + 探照灯） */
  stadiumNight: coverPhoto("photo-1569531955323-33c6b2dca44b"),
  /** 球场灯塔（蓝天） */
  stadiumFloodlight: coverPhoto("photo-1762445964939-123200d655ee"),
  /** 星空下的渔船（紫调，捕鱼类最出片） */
  fishingBoatStars: coverPhoto("photo-1513436539083-9d2127e742f1"),
  /** 夜航渔船 + 城市灯海 */
  fishingHarborNight: coverPhoto("photo-1537946601344-843035066851"),
  /** 停靠的渔船（白天，海面开阔） */
  fishingBoatDay: coverPhoto("photo-1548430065-eb8c4845c077"),
  /** 电竞赛场（选手视角 + 大屏） */
  esportsArena: coverPhoto("photo-1542751371-adc38448a05e"),
  /** 电竞对战区（显示器 + 耳机） */
  esportsStation: coverPhoto("photo-1548003693-b55d51032288"),
} as const;

export type DemoGameCoverKey = keyof typeof DEMO_GAME_COVER;

/**
 * 扁平池：给「按顺序轮转」的兜底逻辑用（`buildCardsFromRecords` / 回退大厅）。
 * 顺序即轮转顺序，所以这里刻意把不同题材交错开，相邻两张卡不会撞画面。
 */
export const DEMO_GAME_COVER_LIST: readonly string[] = [
  DEMO_GAME_COVER.slotFloorGolden,
  DEMO_GAME_COVER.pokerTableFlatlay,
  DEMO_GAME_COVER.slotNeonPurple,
  DEMO_GAME_COVER.rouletteWheelClose,
  DEMO_GAME_COVER.mahjongHandsPurple,
  DEMO_GAME_COVER.slotRowPurple,
  DEMO_GAME_COVER.diceNeonHand,
  DEMO_GAME_COVER.vegasStripNeon,
  DEMO_GAME_COVER.fishingBoatStars,
  DEMO_GAME_COVER.slotJackpotTower,
  DEMO_GAME_COVER.pokerCardsFan,
  DEMO_GAME_COVER.slotRetroRed,
  DEMO_GAME_COVER.rouletteTableChips,
  DEMO_GAME_COVER.goldBarsStack,
  DEMO_GAME_COVER.slotCloseupBokeh,
  DEMO_GAME_COVER.esportsArena,
  DEMO_GAME_COVER.mahjongTilesCloseup,
  DEMO_GAME_COVER.slotCloseupGlow,
  DEMO_GAME_COVER.diceBlackSet,
  DEMO_GAME_COVER.stadiumNight,
  DEMO_GAME_COVER.fishingHarborNight,
  DEMO_GAME_COVER.slotWallGlow,
  DEMO_GAME_COVER.pokerCardBacks,
  DEMO_GAME_COVER.vegasParisNight,
  DEMO_GAME_COVER.goldBarsBlue,
  DEMO_GAME_COVER.slotFloorAerial,
  DEMO_GAME_COVER.rouletteWheelGold,
  DEMO_GAME_COVER.mahjongHandsWhite,
  DEMO_GAME_COVER.esportsStation,
  DEMO_GAME_COVER.vegasHotelAerial,
  DEMO_GAME_COVER.fishingBoatDay,
  DEMO_GAME_COVER.stadiumFloodlight,
];

/** 稳定哈希：同一个游戏 id 永远落在同一张图上（SSR / 客户端一致，不会闪图）。 */
function coverHash(key: string): number {
  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 2147483647;
  }

  return hash;
}

/**
 * 取一张示例封面。
 *
 * - 传了 `index`（列表里的序号）→ **按顺序轮转**，一屏里的卡片绝不撞图；
 *   列表排序稳定（`buildCardsFromRecords` 已排好序），所以 SSR 与客户端结果一致。
 * - 没传 `index` → 用 `seed`（游戏 id）稳定哈希，同一款游戏永远同一张图。
 *
 * 池子为空只可能是有人把表删空了，此时返回空串，卡片自动回退到
 * 「渐变 + 品类图形」占位（见 game-card.tsx），不会渲染破图。
 */
export function pickDemoGameCover(seed: string, index?: number): string {
  if (DEMO_GAME_COVER_LIST.length === 0) {
    return "";
  }

  const position =
    typeof index === "number" && Number.isFinite(index)
      ? Math.abs(Math.trunc(index))
      : coverHash(seed);

  const cover = DEMO_GAME_COVER_LIST[position % DEMO_GAME_COVER_LIST.length];

  return cover ?? "";
}
