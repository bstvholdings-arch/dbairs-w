import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 游戏封面视觉风格（Game Card Cover Style）。
 *
 * 架构决策（与排版模板同一条红线，见 AGENTS.md 第 4 条）：
 * - **一套组件 + 3 组 token**。绝不为某个风格复制一份 GameCard：
 *   组件树、在线人数跳动、点开游戏的逻辑只有一份，
 *   风格差异全部来自本文件里的 class / 颜色 token。
 * - **游戏主图是卡片主体，永远优先**：卡片渲染 `card.imageUrl`（游戏商同步过来的
 *   真实封面，见 Game.iconUrl），object-cover 铺满整张卡，**不加遮罩 / 滤镜 / 蒙版 /
 *   纯色底**。风格只作用于两处：
 *   a) 外框（边框 / 圆角 / 悬停发光）；
 *   b) 底部文字区底板（深色半透明 / 纯黑 / 明亮半透明白）。
 *   所以 token 里**不允许出现任何给整张卡上底色的 class**（一个 `bg-*` 都不许有）。
 * - `build()` 产出的渐变 + 品类图形同样只用于「没有封面图」的兜底卡片，
 *   保证空库 / 未同步封面的卡片不是空白方块。
 * - 不碰数据、不碰主色体系（Tenant.themeColor 仍然决定整站主色），
 *   也不碰排版（那由 storefront-presets.ts 的 layout token 负责）。
 * - 存储：Tenant.layoutConfig.gameCardStyle（JSON 内字段，无需迁移）；
 *   脏数据 / 老租户缺这个字段 → 回落到 cyberNeon。
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
 * 颜色只用风格自带的固定色（赛博青、暗金、糖果白）与中性黑白，
 * **不使用游戏主色** —— 卡面主体是游戏主图，风格不能给它调色。
 */
export type GameCardStyleTokens = {
  /**
   * 外框：圆角 + 边框 + 悬停发光。
   * **只能写 border / ring / shadow**，禁止任何背景色 —— 背景色会盖住游戏主图。
   */
  frame: string;
  /**
   * 底部文字区底板：风格的第二个落点。
   * 只压在卡片底部那一条，不覆盖主图主体。
   */
  panel: string;
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
  /**
   * 悬停时叠在封面图上的极淡色罩（alpha ≤ 0.18，且只用 mix-blend-soft-light 这类
   * 「加光不加色」的混合模式，保证图片清晰度不变）。
   * null = 该风格不加任何罩。
   */
  tint: string | null;
  /** 悬停播放按钮外圈 */
  play: string;
  /** 悬停播放按钮图标 */
  playIcon: string;
};

/**
 * 占位封面的内联样式（「这条游戏没有封面图 / 图 404」时才会用到）。
 *
 * **与风格完全无关**：只由游戏自己的 art（深色端 + 高饱和主色）推导，
 * 三种风格下占位封面长得一模一样 —— 风格只改外框与文字底板，
 * 绝不会把整张卡刷成某个风格的底色（改造前「糖果风把卡刷成白底」就是这么来的）。
 */
export type GameCardPlaceholderSkin = {
  /** 占位底色渐变 */
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
   * 后台选择器的缩略图配色。与真实卡片同源（frame / panel / ink / glow），
   * 改 token 时缩略图跟着变，不会出现「缩略图与前台不一致」。
   */
  swatch: { frame: string; rim: string; ink: string; glow: string };
  tokens: GameCardStyleTokens;
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
 * 生成占位封面（只在「没有封面图 / 图加载失败」时用）。
 *
 * **与风格无关**：同一张游戏卡片在三种风格下的占位封面完全一致，
 * 只有外框与文字底板不同。这里刻意不接受 style 参数，
 * 从根上杜绝「某种风格把整张卡刷成自己的底色、把游戏图盖掉」。
 */
export function buildPlaceholderSkin({
  base,
  accent,
}: GameCardPalette): GameCardPlaceholderSkin {
  return {
    backdrop: `linear-gradient(158deg, ${base} 0%, #04060a 74%)`,
    glow:
      `radial-gradient(120% 86% at 18% 0%, ${withAlpha(accent, 0.45)} 0%, transparent 58%), ` +
      `radial-gradient(95% 72% at 88% 10%, ${withAlpha(accent, 0.22)} 0%, transparent 62%)`,
    haloFill: `radial-gradient(circle at 50% 38%, ${withAlpha(accent, 0.3)} 0%, transparent 66%)`,
    haloStroke: withAlpha(accent, 0.32),
    haloDashed: withAlpha(accent, 0.2),
    emblem: accent,
    emblemShadow: "drop-shadow-[0_10px_22px_rgba(0,0,0,0.8)]",
  };
}

/**
 * 3 种风格（全部以「游戏主图清晰可见」为前提）。
 *
 * A. 赛博霓虹（默认）：青 + 品红双色发光外框，文字区深色半透明玻璃板。
 * B. 黑金尊享：极细暗金外框 + 悬停极淡金色流光罩，文字区纯黑，文字金色。
 * C. 糖果明亮：浅色加粗圆角外框，文字区明亮半透明白，文字转深色。
 *
 * 三者都不动图片本身：没有遮罩、没有滤镜、没有把整张卡刷成渐变底。
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
      // 外框：青 + 品红双色发光环。只写 border / shadow，卡片内部完全透明
      frame:
        "rounded-xl border border-cyan-400/45 " +
        "shadow-[0_0_0_1px_rgba(232,121,249,0.3),0_0_20px_-6px_rgba(34,211,238,0.5),0_18px_40px_-24px_rgba(0,0,0,0.9)] " +
        "hover:border-cyan-300/90 " +
        "hover:shadow-[0_0_0_1px_rgba(232,121,249,0.6),0_0_26px_-2px_rgba(34,211,238,0.85),0_0_54px_-10px_rgba(232,121,249,0.7),0_28px_55px_-18px_rgba(0,0,0,0.9)]",
      // 文字区底板：深色半透明玻璃，只压住底部一条，主图完整透出
      panel: "border-t border-cyan-300/25 bg-black/70 backdrop-blur-[2px]",
      title: "text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]",
      provider: "border-cyan-300/45 bg-black/70 text-cyan-200",
      online:
        "border-cyan-300/30 bg-black/75 text-cyan-300 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.9)]",
      onlineDot: "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.95)]",
      hot: "border-fuchsia-400/50 bg-fuchsia-500/25 text-fuchsia-200",
      // 霓虹风只靠发光外框说话，图片上不加任何罩
      tint: null,
      play: "border-cyan-300/80 bg-cyan-400/15",
      playIcon: "text-cyan-200",
    },
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
      // 外框：暗金细边框，悬停才亮起来（平时只有 1px 暗金线，不抢图片）
      frame:
        "rounded-lg border border-[#4a3d1c] " +
        "shadow-[0_18px_44px_-28px_rgba(0,0,0,0.95)] " +
        "hover:border-[#e3c469]/80 " +
        "hover:shadow-[0_0_0_1px_rgba(227,196,105,0.4),0_24px_52px_-26px_rgba(212,175,55,0.55)]",
      // 文字区底板：纯黑（黑金风要的就是这块「铭牌」）
      panel: "border-t border-[#c8a44a]/30 bg-[#050403]/95",
      title: "text-[#f0d27c] drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]",
      provider: "border-[#c8a44a]/45 bg-black/85 text-[#e7c873]",
      online:
        "border-[#c8a44a]/35 bg-black/85 text-[#e7c873] shadow-[0_4px_14px_-6px_rgba(0,0,0,0.9)]",
      onlineDot: "bg-[#e3c469] shadow-[0_0_6px_rgba(227,196,105,0.95)]",
      hot: "border-[#c8a44a]/55 bg-[#c8a44a]/20 text-[#f5dc9a]",
      // 悬停金色流光：alpha ≤ 0.16 + soft-light（加光不加色），只让卡面「提亮一档」
      tint:
        "bg-[linear-gradient(118deg,rgba(245,220,154,0.16)_0%,rgba(245,220,154,0.04)_38%,transparent_60%,rgba(245,220,154,0.1)_100%)] mix-blend-soft-light",
      play: "border-[#c8a44a]/80 bg-[#c8a44a]/20",
      playIcon: "text-[#f5dc9a]",
    },
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
      // 外框：浅色加粗（2px）圆角边，全站唯一「浅色描边」风格
      frame:
        "rounded-2xl border-2 border-white/90 " +
        "shadow-[0_14px_32px_-20px_rgba(67,32,58,0.55)] " +
        "hover:border-white " +
        "hover:shadow-[0_0_0_4px_rgba(255,255,255,0.4),0_20px_40px_-18px_rgba(244,114,182,0.5)]",
      // 文字区底板：明亮半透明白（压亮不压暗），文字转深色
      panel: "border-t-2 border-white bg-white/85 backdrop-blur-[1px]",
      title: "text-[#43203a]",
      provider: "border-white bg-white text-[#8a3f6d]",
      online:
        "border-emerald-300/70 bg-white/95 text-emerald-700 shadow-[0_4px_14px_-8px_rgba(16,185,129,0.6)]",
      onlineDot: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]",
      hot: "border-rose-300 bg-rose-100 text-rose-500",
      // 糖果风不加罩：白罩会把图「洗白」，这正是要避免的
      tint: null,
      play: "border-white bg-white/95 shadow-[0_10px_22px_-10px_rgba(67,32,58,0.45)]",
      playIcon: "text-[#8a3f6d]",
    },
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

/**
 * 3 种风格的真人可看预览页（公众可访问，直接渲染前台同一份 GameCard）。
 *
 * 合规 / 权限决策：风格只能由平台在【租户管理 → 开站 / 编辑】时配置，
 * 商户后台没有自助切换入口。因此「卖站」阶段靠 AI 销冠把这一页的锚点链接
 * 发给客户选，客户选好后由平台在开站时统一写入 Tenant.layoutConfig。
 */
export const GAME_CARD_STYLE_PREVIEW_PATH = "/demo/game-card-styles";

/** 发给客户 / 写进 Prompt 时用的中文标签（与后台下拉的中文一致） */
export const GAME_CARD_STYLE_PREVIEW_LABELS: Record<GameCardStyleId, string> = {
  cyberNeon: "Cyber Neon 赛博霓虹（默认）",
  royalGold: "Royal Gold 黑金尊享",
  candyPop: "Candy Pop 糖果明亮",
};

/**
 * 3 个预览链接：每种种风格一个锚点，指向同一个预览页。
 *
 * baseUrl 由调用方按「当前请求域名 → APP_BASE_URL」的优先级推导；
 * 推导不到时退回相对路径，保证本地兜底回复里也不会出现拼错的绝对地址。
 */
export function buildGameCardStylePreviewLinks(
  baseUrl?: string | null,
): { id: GameCardStyleId; label: string; url: string }[] {
  const origin = (baseUrl ?? "").trim().replace(/\/+$/, "");

  return GAME_CARD_STYLE_ORDER.map((id) => ({
    id,
    label: GAME_CARD_STYLE_PREVIEW_LABELS[id],
    url: `${origin}${GAME_CARD_STYLE_PREVIEW_PATH}#${id}`,
  }));
}


