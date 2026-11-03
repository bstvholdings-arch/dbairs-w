import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 前台排版模板（Storefront Layout Presets）。
 *
 * 架构决策（已与产品确认，不可回退）：
 * - **一套组件 + 5 组 layout token**。绝不做 5 套独立布局：
 *   组件树、数据流、交互逻辑只有一份，模板只改 CSS 变量与一处容器排布规则
 *   （见 globals.css 里的 `[data-storefront-preset="..."]`）。
 * - 模板只影响「排版」（宽度 / 间距 / 主视觉高度 / 模块排布方式），
 *   不碰配色（Tenant.themeColor 仍是唯一事实来源，走 buildStorefrontTheme），
 *   也不碰模块开关与顺序（Tenant.layoutConfig.modules 仍由后台单独控制）。
 * - 因此新增 / 调整模板 = 改这个文件的一组 token，不需要动任何前台组件。
 *
 * 与 storefront.ts 的分工：
 * - storefront.ts     主色派生、模块归一化（颜色与内容是「事实」）；
 * - storefront-presets.ts 版式 token（排版是「风格」）。
 * 两者都是纯 TS，服务端与客户端共用，不许 import prisma / cookies。
 */

export const STOREFRONT_PRESET_IDS = [
  "classic",
  "cinema",
  "compact",
  "bento",
  "editorial",
] as const;

export type StorefrontPresetId = (typeof STOREFRONT_PRESET_IDS)[number];

/** 默认模板 = 当前线上版式，老数据（layoutConfig 里没有 preset）自动回落到它。 */
export const DEFAULT_STOREFRONT_PRESET: StorefrontPresetId = "classic";

/**
 * 模块排布方式：
 * - stack   纵向堆叠（当前线上版式）
 * - bento   主视觉独占一行，功能岛 / 品牌墙左右并排
 * - editorial 主视觉占左侧大栏，其余模块沿右侧纵排
 */
export type StorefrontPresetLayoutMode = "stack" | "bento" | "editorial";

/**
 * 版式 token。全部以 CSS 变量形式挂在大厅根节点上，
 * 前台组件只用 `var(--sf-xxx, 默认值)` 消费，因此换模板不触发任何重渲染逻辑。
 */
export type StorefrontPresetTokens = {
  mode: StorefrontPresetLayoutMode;
  /** 内容区最大宽度：--sf-shell-max */
  shellMaxWidth: string;
  /** 模块之间（Hero / 功能岛 / 品牌墙）的纵向间距：--sf-module-gap */
  moduleGap: string;
  /** 主视觉高度（手机 / 平板 / 桌面）：--sf-hero-h / -sm / -lg
   *  所有模板共用 HERO_HEIGHT_TOKENS（见上），不要在单模板里私改。 */
  heroHeight: { base: string; sm: string; lg: string };
  /** 面板圆角（Hero / 品牌墙等大面板）：--sf-panel-radius */
  panelRadius: string;
  /** 游戏卡片网格间距：--sf-game-gap */
  gameGap: string;
};

export type StorefrontPresetDefinition = {
  id: StorefrontPresetId;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  tokens: StorefrontPresetTokens;
};

/**
 * 主视觉（Hero）高度统一规范 —— 产品要求，不许按模板随意浮动。
 *
 * 为什么统一：Hero 现在铺的是后台自己上传的活动海报。高度各模板一套的话，
 * 同一张 21:9 的图在 compact(230px) 和 cinema(440px) 下会裁出两张完全不同的画面，
 * 运营根本没法「一次出图、全模板可用」。统一高度后，裁剪比例就只跟「屏宽」有关。
 *
 * 区间（globals.css 的 `[data-hero-stage]` 用 clamp 兜底，越界自动夹住）：
 * - 手机（<640px）  ：200–250px，理想 220px
 * - 平板（≥640px）  ：240–320px，理想 290px
 * - 桌面（≥1024px） ：350–450px，理想 400px
 *
 * 模板之间的差异仍由 shellMaxWidth / moduleGap / panelRadius / gameGap / mode 承担，
 * 所以 5 套模板看起来依旧完全不同 —— 只是主视觉那块「尺寸恒定」。
 */
export const HERO_HEIGHT_TOKENS = {
  base: "220px",
  sm: "290px",
  lg: "400px",
} as const;

/**
 * 5 套模板。token 只有这几项是刻意克制的：
 * 越多 token 越容易做出「看起来只是换了个颜色」的假模板，
 * 现在这 5 项每一项都能让玩家一眼看出差别（宽度 / 留白 / 分栏 / 圆角 / 卡片密度）。
 *
 * 注意：主视觉高度（heroHeight）是**统一**的，不再参与模板差异化 ——
 * 海报由商户自己上传，高度一浮动就会出现「同一张图在不同模板下裁得完全不同」，
 * 运营没法出图。差异改由上面那 5 项承担（见 HERO_HEIGHT_TOKENS）。
 */
export const STOREFRONT_PRESETS: Record<
  StorefrontPresetId,
  StorefrontPresetDefinition
> = {
  classic: {
    id: "classic",
    labelKey: "storefront.preset.classic",
    hintKey: "storefront.preset.classicHint",
    tokens: {
      mode: "stack",
      shellMaxWidth: "1600px",
      moduleGap: "1.25rem",
      heroHeight: HERO_HEIGHT_TOKENS,
      panelRadius: "1rem",
      gameGap: "0.75rem",
    },
  },
  cinema: {
    id: "cinema",
    labelKey: "storefront.preset.cinema",
    hintKey: "storefront.preset.cinemaHint",
    tokens: {
      mode: "stack",
      shellMaxWidth: "1780px",
      moduleGap: "1.75rem",
      heroHeight: HERO_HEIGHT_TOKENS,
      panelRadius: "1.5rem",
      gameGap: "1rem",
    },
  },
  compact: {
    id: "compact",
    labelKey: "storefront.preset.compact",
    hintKey: "storefront.preset.compactHint",
    tokens: {
      mode: "stack",
      shellMaxWidth: "1400px",
      moduleGap: "0.625rem",
      heroHeight: HERO_HEIGHT_TOKENS,
      panelRadius: "0.75rem",
      gameGap: "0.5rem",
    },
  },
  bento: {
    id: "bento",
    labelKey: "storefront.preset.bento",
    hintKey: "storefront.preset.bentoHint",
    tokens: {
      mode: "bento",
      shellMaxWidth: "1520px",
      moduleGap: "1rem",
      heroHeight: HERO_HEIGHT_TOKENS,
      panelRadius: "1.25rem",
      gameGap: "0.75rem",
    },
  },
  editorial: {
    id: "editorial",
    labelKey: "storefront.preset.editorial",
    hintKey: "storefront.preset.editorialHint",
    tokens: {
      mode: "editorial",
      shellMaxWidth: "1680px",
      moduleGap: "1.25rem",
      heroHeight: HERO_HEIGHT_TOKENS,
      panelRadius: "1.25rem",
      gameGap: "0.875rem",
    },
  },
};

/** 后台模板选择器的渲染顺序（与 STOREFRONT_PRESET_IDS 一致，单独导出便于 UI 遍历） */
export const STOREFRONT_PRESET_ORDER: readonly StorefrontPresetId[] =
  STOREFRONT_PRESET_IDS;

export function isStorefrontPresetId(
  value: unknown,
): value is StorefrontPresetId {
  return (
    typeof value === "string" &&
    (STOREFRONT_PRESET_IDS as readonly string[]).includes(value)
  );
}

/**
 * 归一化模板 id。
 *
 * 容错策略与 layoutConfig 其他字段一致：任何脏数据都回落到经典版式，
 * 保证「模板配错」最坏结果只是版式退回默认，而不是大厅白屏。
 */
export function normalizeStorefrontPreset(value: unknown): StorefrontPresetId {
  if (isStorefrontPresetId(value)) {
    return value;
  }

  // 兼容 { preset: "bento" } 这种被整体塞进来的写法。
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const nested = (value as Record<string, unknown>).preset;

    if (isStorefrontPresetId(nested)) {
      return nested;
    }
  }

  return DEFAULT_STOREFRONT_PRESET;
}

export function storefrontPreset(
  value: unknown,
): StorefrontPresetDefinition {
  return STOREFRONT_PRESETS[normalizeStorefrontPreset(value)];
}

export function storefrontPresetLayoutMode(
  value: unknown,
): StorefrontPresetLayoutMode {
  return storefrontPreset(value).tokens.mode;
}

/**
 * 把模板 token 展开成根节点内联样式（CSS 变量）。
 *
 * 返回 Record<string, string> 而不是 CSSProperties：自定义属性不在
 * CSSProperties 的类型里，调用方统一 `as CSSProperties` 挂到 style 上，
 * 与 buildStorefrontTheme().style 的用法保持一致。
 */
export function buildStorefrontPresetStyle(value: unknown): Record<string, string> {
  const { tokens } = storefrontPreset(value);

  return {
    "--sf-shell-max": tokens.shellMaxWidth,
    "--sf-module-gap": tokens.moduleGap,
    "--sf-hero-h": tokens.heroHeight.base,
    "--sf-hero-h-sm": tokens.heroHeight.sm,
    "--sf-hero-h-lg": tokens.heroHeight.lg,
    "--sf-panel-radius": tokens.panelRadius,
    "--sf-game-gap": tokens.gameGap,
  };
}
