import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 游戏封面视觉风格（Game Card Cover Style）。
 *
 * 架构决策（与排版模板同一条红线，见 AGENTS.md 第 4 条）：
 * - **一套组件 + 3 组 token**。绝不为某个风格复制一份 GameCard：
 *   组件树、在线人数跳动、点开游戏的逻辑只有一份，
 *   风格差异全部来自本文件里的 class / 颜色 token。
 * - 风格只管「卡片的视觉表现」（底色 / 边框 / 光效 / 文字色 / 扫光），
 *   不碰数据、不碰主色体系（Tenant.themeColor 仍然决定整站主色），
 *   也不碰排版（那由 storefront-presets.ts 的 layout token 负责）。
 * - 存储：Tenant.layoutConfig.gameCardStyle（JSON 内字段，无需迁移）；
 *   脏数据 / 老租户缺这个字段 → 回落到 cyberNeon，外观与改造前一致。
 *
 * 与 storefront.ts 的分工：storefront.ts 负责「主色 + 模块开关」，
 * 本文件负责「游戏卡片长什么样」。两者都是纯 TS，服务端与客户端共用。
 */

export const GAME_CARD_STYLE_IDS = [
  "cyberNeon",
  "royalGold",
  "candyPop",
] as const;

export type GameCardStyleId = (typeof GAME_CARD_STYLE_IDS)[number];

/** 默认风格 = 赛博霓虹（风格 A），老租户升级后外观不变 */
export const DEFAULT_GAME_CARD_STYLE: GameCardStyleId = "cyberNeon";

/** 卡片封面需要的两个色：深色端 + 高饱和主色（来自 lib/lobby-games.ts 的 art） */
export type GameCardPalette = {
  base: string;
  accent: string;
};

/**
 * 卡片外框 / 文字 / 徽章等的静态 class。
 *
 * 颜色只用两种来源：
 * 1. 风格自带的固定色（赛博青、暗金、糖果白）；
 * 2. 卡片自己的高饱和主色（art.accent，由 build() 生成内联渐变）。
 * 因此切换风格不会影响整站主色，反之亦然。
 */
export type GameCardStyleTokens = {
  /** 外框：底色 + 圆角 + 边框 + 悬停光效（aspect / overflow 等布局类在组件里） */
  frame: string;
  /** 机台格线 / 糖霜点阵这一层纹理 */
  texture: string;
  /** 顶部 1px 亮边（对光感很关键，深色卡尤其明显） */
  hairline: string;
  /** 底部压暗层（糖果风是压亮层） */
  scrim: string;
  /** 顶部高光描边 */
  edge: string;
  /** 游戏名 */
  title: string;
  /** 游戏商徽章 */
  provider: string;
  /** 在线人数胶囊 */
  online: string;
  /** 在线人数绿点 */
  onlineDot: string;
  /** HOT 标 */
  hot: string;
  /** 悬停扫光（null = 该风格不显示扫光） */
  sweep: string | null;
  /** 悬停播放按钮外圈 */
  play: string;
  /** 悬停播放按钮图标 */
  playIcon: string;
  /** 悬停遮罩 */
  veil: string;
};

/** 由卡片主色生成的内联样式（每张卡片颜色不同，只能走 style） */
export type GameCardArtTokens = {
  /** 封面底色渐变 */
  backdrop: string;
  /** 叠加的光晕层 */
  glow: string;
  /** 中央光环填充 */
  haloFill: string;
  /** 中央光环描边 */
  haloStroke: string;
  /** 中央虚线环描边 */
  haloDashed: string;
  /** 中央图形颜色 */
  emblem: string;
  /** 中央图形投影 */
  emblemShadow: string;
};

export type GameCardStyleDefinition = {
  id: GameCardStyleId;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  /**
   * 后台选择器的缩略图配色。与真实卡片同源（frame / rim / ink / glow），
   * 改 token 时缩略图跟着变，不会出现「缩略图与前台不一致」。
   */
  swatch: { frame: string; rim: string; ink: string; glow: string };
  tokens: GameCardStyleTokens;
  build: (palette: GameCardPalette) => GameCardArtTokens;
};

/** `#rrggbb` / `#rgb` → `rgba(r, g, b, alpha)`；解析失败时按透明处理，绝不抛错 */
function withAlpha(hex: string, alpha: number): string {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const value = Number.parseInt(full, 16);

  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * 3 种风格。
 *
 * A. 赛博霓虹（默认）：深色底 + 悬停强荧光（青 / 粉双色发光）+ 高对比渐变。
 * B. 黑金尊享：纯黑底 + 极细暗金边框 + 悬停金属扫光 + 全金文字。
 * C. 糖果明亮：浅色糖果渐变 + 加宽圆角边框 + 深色文字 + 去掉暗色压层。
 */
export const GAME_CARD_STYLES: Record<
  GameCardStyleId,
  GameCardStyleDefinition
> = {
  cyberNeon: {
    id: "cyberNeon",
    labelKey: "storefront.gameCard.cyberNeon",
    hintKey: "storefront.gameCard.cyberNeonHint",
    swatch: {
      frame: "#06090f",
      rim: "#22d3ee",
      ink: "#e6fbff",
      glow: "#e879f9",
    },
    tokens: {
      frame:
        "rounded-xl border bg-[#080808] border-cyan-400/25 " +
        "hover:border-cyan-300/90 " +
        "hover:shadow-[0_0_0_1px_rgba(34,211,238,0.6),0_0_24px_-2px_rgba(34,211,238,0.75),0_0_48px_-8px_rgba(232,121,249,0.6),0_28px_55px_-18px_var(--sf-a65)]",
      texture:
        "[background-image:repeating-linear-gradient(90deg,rgba(255,255,255,0.9)_0_1px,transparent_1px_26px)] opacity-[0.14]",
      hairline:
        "bg-gradient-to-r from-transparent via-cyan-200/65 to-transparent",
      scrim:
        "bg-[linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.55)_58%,#000_100%)]",
      edge:
        "bg-[linear-gradient(135deg,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0.05)_26%,transparent_46%,transparent_72%,rgba(255,255,255,0.1)_100%)]",
      title: "text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]",
      provider: "border-cyan-300/45 bg-black/70 text-cyan-200",
      online:
        "border-cyan-300/30 bg-black/70 text-cyan-300 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.9)]",
      onlineDot: "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.95)]",
      hot: "border-fuchsia-400/50 bg-fuchsia-500/20 text-fuchsia-200",
      sweep:
        "w-2/5 duration-700 bg-gradient-to-r from-transparent via-cyan-100/75 to-transparent blur-[2px]",
      play: "border-cyan-300/80 bg-cyan-400/15",
      playIcon: "text-cyan-200",
      veil: "bg-black/35",
    },
    build: ({ base, accent }) => ({
      backdrop: `linear-gradient(158deg, ${base} 0%, #04060a 74%)`,
      glow:
        `radial-gradient(120% 86% at 18% 0%, ${withAlpha(accent, 0.5)} 0%, transparent 58%), ` +
        "radial-gradient(95% 72% at 88% 10%, rgba(34, 211, 238, 0.32) 0%, transparent 62%), " +
        "radial-gradient(85% 62% at 50% 108%, rgba(232, 121, 249, 0.28) 0%, transparent 70%)",
      haloFill: `radial-gradient(circle at 50% 38%, ${withAlpha(accent, 0.3)} 0%, transparent 66%)`,
      haloStroke: withAlpha(accent, 0.32),
      haloDashed: withAlpha(accent, 0.2),
      emblem: accent,
      emblemShadow: "drop-shadow-[0_10px_22px_rgba(0,0,0,0.8)]",
    }),
  },
  royalGold: {
    id: "royalGold",
    labelKey: "storefront.gameCard.royalGold",
    hintKey: "storefront.gameCard.royalGoldHint",
    swatch: {
      frame: "#000000",
      rim: "#3d3319",
      ink: "#f0d27c",
      glow: "#f5dc9a",
    },
    tokens: {
      frame:
        "rounded-lg border bg-black border-[#3d3319] " +
        "hover:border-[#e3c469]/85 " +
        "hover:shadow-[0_0_0_1px_rgba(227,196,105,0.4),0_0_22px_-6px_rgba(212,175,55,0.7),0_26px_56px_-22px_rgba(212,175,55,0.6)]",
      texture:
        "[background-image:repeating-linear-gradient(90deg,rgba(212,175,55,0.9)_0_1px,transparent_1px_26px)] opacity-[0.1]",
      hairline:
        "bg-gradient-to-r from-transparent via-[#e3c469]/75 to-transparent",
      scrim:
        "bg-[linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.62)_58%,#000_100%)]",
      edge:
        "bg-[linear-gradient(135deg,rgba(245,220,154,0.22)_0%,rgba(245,220,154,0.06)_26%,transparent_48%,transparent_74%,rgba(245,220,154,0.12)_100%)]",
      title: "text-[#f0d27c] drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]",
      provider: "border-[#c8a44a]/45 bg-black/80 text-[#e7c873]",
      online:
        "border-[#c8a44a]/35 bg-black/80 text-[#e7c873] shadow-[0_4px_14px_-6px_rgba(0,0,0,0.9)]",
      onlineDot: "bg-[#e3c469] shadow-[0_0_6px_rgba(227,196,105,0.95)]",
      hot: "border-[#c8a44a]/55 bg-[#c8a44a]/15 text-[#f5dc9a]",
      // 金属扫光：更窄、更慢、金色，划过时像抛光金属反光
      sweep:
        "w-1/4 duration-[1100ms] bg-gradient-to-r from-transparent via-[#f5dc9a]/90 to-transparent blur-[1px]",
      play: "border-[#c8a44a]/80 bg-[#c8a44a]/15",
      playIcon: "text-[#f5dc9a]",
      veil: "bg-black/45",
    },
    build: ({ accent }) => ({
      backdrop: "linear-gradient(162deg, #100d08 0%, #000000 76%)",
      glow:
        "radial-gradient(120% 85% at 22% 0%, rgba(212, 175, 55, 0.16) 0%, transparent 60%), " +
        `radial-gradient(90% 70% at 82% 8%, ${withAlpha(accent, 0.1)} 0%, transparent 64%)`,
      haloFill:
        "radial-gradient(circle at 50% 38%, rgba(212, 175, 55, 0.18) 0%, transparent 66%)",
      haloStroke: "rgba(212, 175, 55, 0.34)",
      haloDashed: "rgba(212, 175, 55, 0.22)",
      // 文字 / 图形统一金色：VIP 站的封面不跟着游戏主色跑
      emblem: "#e7c873",
      emblemShadow: "drop-shadow-[0_10px_22px_rgba(212,175,55,0.35)]",
    }),
  },
  candyPop: {
    id: "candyPop",
    labelKey: "storefront.gameCard.candyPop",
    hintKey: "storefront.gameCard.candyPopHint",
    swatch: {
      frame: "#fff7fb",
      rim: "#ffffff",
      ink: "#43203a",
      glow: "#ffb3d9",
    },
    tokens: {
      frame:
        "rounded-2xl border-2 bg-[#fff7fb] border-white " +
        "hover:border-white hover:shadow-[0_0_0_4px_rgba(255,255,255,0.5),0_22px_45px_-18px_rgba(56,189,248,0.5),0_22px_45px_-18px_rgba(244,114,182,0.5)]",
      // 糖霜点阵替代机台格线，浅色卡片不再有「铁壳」感
      texture:
        "[background-image:radial-gradient(rgba(255,255,255,0.95)_1px,transparent_1px)] [background-size:14px_14px] opacity-50",
      hairline: "bg-gradient-to-r from-transparent via-white to-transparent",
      scrim:
        "bg-[linear-gradient(180deg,transparent_0%,rgba(255,255,255,0.72)_56%,rgba(255,255,255,0.97)_100%)]",
      edge:
        "bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,transparent_45%,rgba(255,255,255,0.45)_100%)]",
      title: "text-[#43203a] drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]",
      provider: "border-white bg-white/85 text-[#8a3f6d]",
      online:
        "border-emerald-300/70 bg-white/90 text-emerald-700 shadow-[0_4px_14px_-8px_rgba(16,185,129,0.6)]",
      onlineDot: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]",
      hot: "border-rose-300 bg-rose-100 text-rose-500",
      // 明亮风不要扫光：扫光是「金属 / 霓虹」的语言
      sweep: null,
      play:
        "border-white bg-white/90 shadow-[0_10px_22px_-10px_rgba(67,32,58,0.45)]",
      playIcon: "text-[#8a3f6d]",
      veil: "bg-white/25",
    },
    build: ({ base, accent }) => ({
      backdrop: `linear-gradient(160deg, #ffffff 0%, ${withAlpha(accent, 0.26)} 58%, ${withAlpha(accent, 0.42)} 100%)`,
      glow:
        "radial-gradient(110% 80% at 18% 0%, rgba(255, 255, 255, 0.85) 0%, transparent 62%), " +
        `radial-gradient(95% 70% at 88% 6%, ${withAlpha(base, 0.16)} 0%, transparent 64%)`,
      haloFill:
        "radial-gradient(circle at 50% 38%, rgba(255, 255, 255, 0.9) 0%, transparent 66%)",
      haloStroke: "rgba(255, 255, 255, 0.95)",
      haloDashed: "rgba(255, 255, 255, 0.75)",
      emblem: accent,
      emblemShadow: "drop-shadow-[0_8px_18px_rgba(67,32,58,0.3)]",
    }),
  },
};

/** 后台选择器的渲染顺序（风格 A 在最前，即默认项） */
export const GAME_CARD_STYLE_ORDER: readonly GameCardStyleId[] =
  GAME_CARD_STYLE_IDS;

export function isGameCardStyleId(value: unknown): value is GameCardStyleId {
  return (
    typeof value === "string" &&
    (GAME_CARD_STYLE_IDS as readonly string[]).includes(value)
  );
}

/**
 * 归一化卡片风格 id。
 *
 * 容错策略与 preset 一致：任何脏数据（拼错、老数据缺失、被整体塞了对象）
 * 都回落到赛博霓虹，保证「配错风格」最坏结果只是外观退回默认，而不是白屏。
 */
export function normalizeGameCardStyle(value: unknown): GameCardStyleId {
  if (isGameCardStyleId(value)) {
    return value;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const nested = (value as Record<string, unknown>).gameCardStyle;

    if (isGameCardStyleId(nested)) {
      return nested;
    }
  }

  return DEFAULT_GAME_CARD_STYLE;
}

export function gameCardStyle(value: unknown): GameCardStyleDefinition {
  return GAME_CARD_STYLES[normalizeGameCardStyle(value)];
}

