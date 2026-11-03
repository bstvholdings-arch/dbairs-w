import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 主题背景色（Theme Background Color）。
 *
 * 产品需求（替代原来的「3 种游戏封面风格」）：
 * - 站点必须是**深色 / 黑底**的电竞质感，任何主题色都不许把卡片刷白；
 * - 平台在【租户管理 → 新建 / 编辑租户】时从 **15 种预设主题背景色**里单选一种；
 * - 该颜色决定「环境光（大厅背景） + 卡片外框 / 悬停光晕 / 底部文字区底板描边」，
 *   一律以**半透明叠加在深色底上**的方式出现，主体仍是暗黑。
 *
 * 架构红线（与排版模板 / 主色并列，见 AGENTS.md 第 4.1 条）：
 * - **一套 GameCard + 15 组色值**。绝不为某个主题色复制一份 GameCard：
 *   组件树、数据流、在线人数跳动、点开游戏的逻辑只有一份，
 *   差异全部来自本文件的 base / accent 两个色值。
 * - 组件**不接收颜色 prop**：颜色通过根节点注入的 CSS 变量（`--tb-*`）继承下去，
 *   卡片只用 `.tb-card*` 这几个固定 class（见 globals.css 的「主题背景色」区块）。
 *   这样「加一种颜色」= 在这个表里加一行，不用碰组件、不用碰 CSS。
 * - **游戏主图是卡片主体，任何主题色都不许动它**（无遮罩 / 无滤镜 / 无纯色底）；
 *   主题色只作用于外框、悬停光晕、底部文字底板与徽章。
 * - 与 `Tenant.themeColor`（整站主色，见 storefront.ts）互不干扰：
 *   主色管按钮 / 链接 / 品牌强调色，主题背景色只管环境光与卡片。
 * - 存储：`Tenant.layoutConfig.themeBackground`（JSON 内字段，无需迁移）；
 *   老数据里的 `layoutConfig.gameCardStyle`（cyberNeon / royalGold / candyPop）
 *   会被 LEGACY_STYLE_MAP 映射成对应的深色主题，升级后外观不回退成白卡。
 *
 * 本文件是纯 TS，服务端与客户端共用；不 import 任何 React。
 */

export const THEME_BACKGROUND_IDS = [
  "obsidian",
  "royalPurple",
  "deepSea",
  "cyberCyan",
  "roseGold",
  "emerald",
  "bloodRed",
  "neonPink",
  "moltenOrange",
  "champagne",
  "titanium",
  "abyssTeal",
  "arcticSilver",
  "solarYellow",
  "midnightIndigo",
] as const;

export type ThemeBackgroundId = (typeof THEME_BACKGROUND_IDS)[number];

/** 默认主题 = 经典暗黑（金），与改造前的大厅观感一致 */
export const DEFAULT_THEME_BACKGROUND: ThemeBackgroundId = "obsidian";

export type ThemeBackgroundDefinition = {
  id: ThemeBackgroundId;
  /** 后台 / 演示页的显示名（zh.json + en.json 必须同时存在） */
  labelKey: TranslationKey;
  /**
   * 站点底色：接近黑的有色深底，只用来铺大厅背景，
   * 亮度必须压得住（任何一档都不能让卡片变成浅底）。
   */
  base: string;
  /**
   * 点缀色：环境光晕 / 卡片边框 / 悬停光晕 / 底板描边 / 徽章文字。
   * 在深色底上以低透明度叠加，负责「呼吸感」的那点颜色。
   */
  accent: string;
};


export const THEME_BACKGROUNDS: Record<
  ThemeBackgroundId,
  ThemeBackgroundDefinition
> = {
  obsidian: {
    id: "obsidian",
    labelKey: "storefront.themeBackground.obsidian",
    base: "#0b0f1a",
    accent: "#d4af37",
  },
  royalPurple: {
    id: "royalPurple",
    labelKey: "storefront.themeBackground.royalPurple",
    base: "#120b26",
    accent: "#8b5cf6",
  },
  deepSea: {
    id: "deepSea",
    labelKey: "storefront.themeBackground.deepSea",
    base: "#05101f",
    accent: "#3b82f6",
  },
  cyberCyan: {
    id: "cyberCyan",
    labelKey: "storefront.themeBackground.cyberCyan",
    base: "#04141a",
    accent: "#22d3ee",
  },
  roseGold: {
    id: "roseGold",
    labelKey: "storefront.themeBackground.roseGold",
    base: "#170d10",
    accent: "#b76e79",
  },
  emerald: {
    id: "emerald",
    labelKey: "storefront.themeBackground.emerald",
    base: "#04150f",
    accent: "#10b981",
  },
  bloodRed: {
    id: "bloodRed",
    labelKey: "storefront.themeBackground.bloodRed",
    base: "#160609",
    accent: "#dc2626",
  },
  neonPink: {
    id: "neonPink",
    labelKey: "storefront.themeBackground.neonPink",
    base: "#170a13",
    accent: "#f472b6",
  },
  moltenOrange: {
    id: "moltenOrange",
    labelKey: "storefront.themeBackground.moltenOrange",
    base: "#150b04",
    accent: "#f97316",
  },
  champagne: {
    id: "champagne",
    labelKey: "storefront.themeBackground.champagne",
    base: "#14110a",
    accent: "#e5d3a8",
  },
  titanium: {
    id: "titanium",
    labelKey: "storefront.themeBackground.titanium",
    base: "#0c0f12",
    accent: "#94a3b8",
  },
  abyssTeal: {
    id: "abyssTeal",
    labelKey: "storefront.themeBackground.abyssTeal",
    base: "#04121a",
    accent: "#14b8a6",
  },
  arcticSilver: {
    id: "arcticSilver",
    labelKey: "storefront.themeBackground.arcticSilver",
    base: "#0d1013",
    accent: "#f1f5f9",
  },
  solarYellow: {
    id: "solarYellow",
    labelKey: "storefront.themeBackground.solarYellow",
    base: "#141002",
    accent: "#facc15",
  },
  midnightIndigo: {
    id: "midnightIndigo",
    labelKey: "storefront.themeBackground.midnightIndigo",
    base: "#0a0d1e",
    accent: "#6366f1",
  },
};

/** 后台 / 演示页的渲染顺序（第一项即默认项） */
export const THEME_BACKGROUND_ORDER: readonly ThemeBackgroundId[] =
  THEME_BACKGROUND_IDS;

/**
 * 历史值迁移：老租户 layoutConfig.gameCardStyle 的三个 id。
 *
 * 只做「深色化」映射，绝不保留原来的白底观感：
 * - candyPop（原明亮白底）→ neonPink（深底霓虹粉），把丢掉的黑底找回来；
 * - royalGold（暗金）→ obsidian（经典暗黑，同样是金）；
 * - cyberNeon（青粉）→ cyberCyan（赛博青）。
 */
const LEGACY_STYLE_MAP: Record<string, ThemeBackgroundId> = {
  cyberNeon: "cyberCyan",
  royalGold: "obsidian",
  candyPop: "neonPink",
};

export function isThemeBackgroundId(
  value: unknown,
): value is ThemeBackgroundId {
  return (
    typeof value === "string" &&
    (THEME_BACKGROUND_IDS as readonly string[]).includes(value)
  );
}

/**
 * 归一化主题背景色 id。
 *
 * 容错策略与 preset / 主色一致：任何脏数据（拼错、老数据缺失、被整体塞了对象、
 * 传了老的 gameCardStyle）都回落到经典暗黑，保证「配错颜色」最坏结果只是
 * 退回默认的深色外观，而不是白屏或白卡。
 */
export function normalizeThemeBackground(value: unknown): ThemeBackgroundId {
  if (isThemeBackgroundId(value)) {
    return value;
  }

  if (typeof value === "string") {
    const legacy = LEGACY_STYLE_MAP[value.trim()];

    if (legacy) {
      return legacy;
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;

    if (isThemeBackgroundId(record.themeBackground)) {
      return record.themeBackground;
    }

    // 老结构：layoutConfig.gameCardStyle（可能是新 id，也可能是老的三种风格）
    if (isThemeBackgroundId(record.gameCardStyle)) {
      return record.gameCardStyle;
    }

    if (typeof record.gameCardStyle === "string") {
      const legacy = LEGACY_STYLE_MAP[record.gameCardStyle.trim()];

      if (legacy) {
        return legacy;
      }
    }
  }

  return DEFAULT_THEME_BACKGROUND;
}

export function themeBackground(value: unknown): ThemeBackgroundDefinition {
  return THEME_BACKGROUNDS[normalizeThemeBackground(value)];
}

/**
 * `#rrggbb` / `#rgb` → `r g b`（CSS `rgb(R G B / a)` 需要的空格分隔三分量）。
 *
 * 解析失败时按默认金色处理，绝不抛错：颜色值来自后台配置，
 * 前台没有理由因为一个脏色值崩掉整页。
 */
export function hexToRgbTriplet(hex: string): string {
  const raw = hex.trim().replace(/^#/, "");
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw.slice(0, 6);

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return "212 175 55";
  }

  const value = Number.parseInt(expanded, 16);

  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

/**
 * 根节点要注入的 CSS 变量（前台大厅 / 品牌展馆 / 后台预览 / 演示页共用）。
 *
 * 消费端只有三个变量，读法见 globals.css 的「主题背景色」区块：
 *   --tb-base              站点底色（铺大厅底，永远是深色）
 *   --tb-accent            点缀色（徽章文字 / 描边 / 高亮）
 *   --tb-rgb               点缀色的 `r g b` 三分量，用于任意透明度叠加：
 *                          rgb(var(--tb-rgb) / 0.26)
 *
 * 为什么不直接生成 class：颜色是运行时配置，动态拼 class 会让 Tailwind
 * 扫不到、也没法 SSR；CSS 变量 + 固定 class 才是唯一零成本方案。
 */
export function buildThemeBackgroundStyle(
  value: unknown,
): Record<string, string> {
  const definition = themeBackground(value);

  return {
    "--tb-base": definition.base,
    "--tb-accent": definition.accent,
    "--tb-rgb": hexToRgbTriplet(definition.accent),
  };
}

/**
 * 15 种主题背景色的实战预览页（公众可访问，直接渲染前台同一份 GameCard）。
 *
 * 合规 / 权限决策：主题色只能由平台在【租户管理 → 开站 / 编辑】时配置，
 * 商户后台没有自助切换入口。因此「卖站」阶段靠 AI 销冠把这一页的锚点链接
 * 发给客户选，客户选好后由平台在开站时统一写入 Tenant.layoutConfig。
 */
export const THEME_BACKGROUND_PREVIEW_PATH = "/demo/theme-backgrounds";

/** 改造前的旧预览页：已被新页面取代，保留跳转（客户手里的旧链接不能 404） */
export const LEGACY_GAME_CARD_STYLE_PREVIEW_PATH = "/demo/game-card-styles";

/** 发给客户 / 写进 Prompt 时用的中文标签（与后台单选框的中文一致） */
export const THEME_BACKGROUND_PREVIEW_LABELS: Record<
  ThemeBackgroundId,
  string
> = {
  obsidian: "经典暗黑 · 经典金（默认）",
  royalPurple: "皇家紫",
  deepSea: "深海蓝",
  cyberCyan: "赛博青",
  roseGold: "玫瑰金",
  emerald: "翡翠绿",
  bloodRed: "血月红",
  neonPink: "霓虹粉",
  moltenOrange: "熔岩橙",
  champagne: "香槟金",
  titanium: "钛金灰",
  abyssTeal: "幽潭青",
  arcticSilver: "极地银",
  solarYellow: "烈日金",
  midnightIndigo: "午夜靛蓝",
};

/**
 * 15 个预览链接：每种主题色一个锚点，指向同一个预览页。
 *
 * baseUrl 由调用方按「当前请求域名 → APP_BASE_URL」的优先级推导；
 * 推导不到时退回相对路径，保证本地兜底回复里也不会出现拼错的绝对地址。
 */
export function buildThemeBackgroundPreviewLinks(
  baseUrl?: string | null,
): { id: ThemeBackgroundId; label: string; url: string }[] {
  const origin = (baseUrl ?? "").trim().replace(/\/+$/, "");

  return THEME_BACKGROUND_ORDER.map((id) => ({
    id,
    label: THEME_BACKGROUND_PREVIEW_LABELS[id],
    url: `${origin}${THEME_BACKGROUND_PREVIEW_PATH}#${id}`,
  }));
}
