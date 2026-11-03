import type { TranslationKey } from "@/lib/i18n-types";
import {
  normalizeStorefrontPreset,
  type StorefrontPresetId,
} from "@/lib/storefront-presets";
import {
  normalizeThemeBackground,
  type ThemeBackgroundId,
} from "@/lib/theme-backgrounds";


/**
 * 前台装修（Storefront Settings）的纯函数层。
 *
 * 这份文件同时被服务端（读取 Tenant 配置）和客户端（大厅渲染 / 后台装修页）引用，
 * 因此只能放纯 TS，不许 import prisma、cookies 之类只能在服务端跑的东西。
 * 颜色派生逻辑必须双边一致，否则后台预览与真实前台会「同一个色号两种效果」。
 */

/** 大厅里可开关 / 可排序的三大模块（Header 与 All Games 固定显示） */
export const STOREFRONT_MODULE_IDS = ["hero", "action", "provider"] as const;

export type StorefrontModuleId = (typeof STOREFRONT_MODULE_IDS)[number];

export type StorefrontModule = {
  id: StorefrontModuleId;
  visible: boolean;
};

/** 默认顺序：Hero 轮播 → 核心功能岛 → 品牌墙，全部显示 */
export const DEFAULT_STOREFRONT_MODULES: StorefrontModule[] = [
  { id: "hero", visible: true },
  { id: "action", visible: true },
  { id: "provider", visible: true },
];

/**
 * 顶栏语言按钮文案的默认值。格式固定为「中文标签/EN」，
 * 中文标签由后台配置，英文按需求始终显示 EN。
 */
export const DEFAULT_STOREFRONT_LANGUAGE_STYLE = "CH/EN";

/** 互动组件默认全开：新功能上线即可见，后台可随时关闭。 */
export const DEFAULT_STOREFRONT_TOPBAR_CHAT = true;
export const DEFAULT_STOREFRONT_SIDEBAR_CASINO = true;

/** Tenant.layoutConfig 归一化后的完整形状（版式模板 + 模块顺序 + 互动组件开关） */
export type StorefrontLayout = {
  /**
   * 排版模板：一套组件 + 5 组 layout token，见 src/lib/storefront-presets.ts。
   * 只改排版（宽度 / 间距 / 主视觉高度 / 分栏），不改配色与模块开关顺序。
   */
  preset: StorefrontPresetId;
  /**
   * 主题背景色：一套 GameCard + 15 组色值，见 src/lib/theme-backgrounds.ts。
   * 只改环境光与卡片外框 / 文字底板描边，永远深色底，不改数据与整站主色。
   */
  themeBackground: ThemeBackgroundId;
  modules: StorefrontModule[];
  /** 顶栏语言按钮左侧是否显示 AI 客服图标 */
  showTopbarChat: boolean;
  /** 侧边栏「斗鸡」下方是否显示娱乐场动态卡片 */
  showSidebarCasinoAnim: boolean;
  /** 语言按钮文案，形如 CH/EN */
  languageStyle: string;
};

export const DEFAULT_THEME_COLOR = "#d4af37";

/**
 * 深浅调节（brightness）的取值范围与语义：
 * - 0   = 最暗（明度压到下限，色相/饱和度不变）；
 * - 50  = 色号原样（默认值，滑到 50 时看到的正是预设色块的颜色）；
 * - 100 = 最亮（明度推到上限）。
 * 这是一个「相对」调节：同一个滑条位置，深色和浅色宿主色都会各自向同一方向移动。
 */
export const THEME_BRIGHTNESS_MIN = 0;
export const THEME_BRIGHTNESS_MAX = 100;
export const DEFAULT_THEME_BRIGHTNESS = 50;

/**
 * 明度的最终夹取区间。
 * 不夹到 0 / 1 的原因：brightness=0 时整站会变成纯黑（按钮、边框、文字全部消失），
 * 100 时又会变成纯白（深色大厅上刺眼且丢失品牌感），两端都保留一点余量。
 */
export const THEME_LIGHTNESS_FLOOR = 0.06;
export const THEME_LIGHTNESS_CEILING = 0.97;

/** 主色 + 深浅调节：入库、后台表单、大厅派生三者共用的唯一形状 */
export type StorefrontThemeSetting = {
  /** 归一化后的十六进制主色（3 位缩写会展开成 6 位） */
  hex: string;
  /** 深浅调节：0-100 的整数，50 = 色号原样 */
  brightness: number;
};

export const STOREFRONT_MODULE_LABEL_KEYS: Record<
  StorefrontModuleId,
  TranslationKey
> = {
  hero: "storefront.module.hero",
  action: "storefront.module.action",
  provider: "storefront.module.provider",
};

export const STOREFRONT_MODULE_HINT_KEYS: Record<
  StorefrontModuleId,
  TranslationKey
> = {
  hero: "storefront.module.heroHint",
  action: "storefront.module.actionHint",
  provider: "storefront.module.providerHint",
};

/**
 * 后台颜色选择器里的 15 个预设主色。
 *
 * 顺序即界面顺序：前 8 个是「黑金 / 玫瑰金 / 电竞蓝 / 赛博紫 / 霓虹粉 / 血红 / 翡翠绿 / 清爽白」，
 * 后面 7 个是常用的补位色。色块直接用这里的 value 上色，
 * 命中后只改 hex，深浅滑条保持用户当前的位置（想恢复原样把它拉回 50）。
 */
export const THEME_COLOR_PRESETS: Array<{
  value: string;
  labelKey: TranslationKey;
}> = [
  { value: "#d4af37", labelKey: "storefront.color.preset.obsidianGold" },
  { value: "#b76e79", labelKey: "storefront.color.preset.roseGold" },
  { value: "#3b82f6", labelKey: "storefront.color.preset.esportsBlue" },
  { value: "#8b5cf6", labelKey: "storefront.color.preset.cyberPurple" },
  { value: "#f472b6", labelKey: "storefront.color.preset.neonPink" },
  { value: "#dc2626", labelKey: "storefront.color.preset.bloodRed" },
  { value: "#10b981", labelKey: "storefront.color.preset.emerald" },
  { value: "#f1f5f9", labelKey: "storefront.color.preset.arcticWhite" },
  { value: "#f97316", labelKey: "storefront.color.preset.moltenOrange" },
  { value: "#06b6d4", labelKey: "storefront.color.preset.auroraCyan" },
  { value: "#94a3b8", labelKey: "storefront.color.preset.titanium" },
  { value: "#0f4c81", labelKey: "storefront.color.preset.deepSea" },
  { value: "#e5d3a8", labelKey: "storefront.color.preset.champagne" },
  { value: "#6ee7b7", labelKey: "storefront.color.preset.mint" },
  { value: "#facc15", labelKey: "storefront.color.preset.solarYellow" },
];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isStorefrontModuleId(value: unknown): value is StorefrontModuleId {
  return (
    typeof value === "string" &&
    (STOREFRONT_MODULE_IDS as readonly string[]).includes(value)
  );
}

/** 是否是合法的十六进制颜色（#abc / #aabbcc 都算） */
export function isValidThemeColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value.trim());
}

/**
 * 从任意「主色入参」里取出 hex 文本。
 *
 * 历史上 Tenant.themeColor 存的是裸 hex（`#d4af37`），现在改存 JSON 字符串
 * （`{"hex":"#d4af37","brightness":50}`）。为了让老数据、接口调用方、后台表单
 * 三种写法都能继续工作，这里统一拆一层：裸 hex / JSON 字符串 / 对象都接受。
 */
function parseJsonRecord(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();

  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 对象可能用 hex / color / baseColor 三个字段名，全部兼容 */
function pickHexField(record: Record<string, unknown>): unknown {
  return record.hex ?? record.color ?? record.baseColor;
}

/** 深浅字段兼容 brightness / lightness 两种写法 */
function pickBrightnessField(record: Record<string, unknown>): unknown {
  return record.brightness ?? record.lightness;
}

/**
 * 归一化主色：3 位缩写展开成 6 位、统一小写；非法值回退到默认金色。
 * 入参可以是裸 hex、JSON 字符串或对象（见 parseJsonRecord）。
 */
export function normalizeThemeColor(
  value: unknown,
  fallback: string = DEFAULT_THEME_COLOR,
): string {
  const json = typeof value === "string" ? parseJsonRecord(value) : null;

  const raw =
    typeof value === "string"
      ? json
        ? pickHexField(json)
        : value
      : isRecord(value)
        ? pickHexField(value)
        : value;

  if (!isValidThemeColor(raw)) {
    return fallback;
  }

  const hex = raw.trim().slice(1).toLowerCase();

  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((char) => char + char)
      .join("")}`;
  }

  return `#${hex}`;
}

/** 归一化深浅调节：非数字回退 50，越界夹到 0-100，小数四舍五入成整数 */
export function normalizeThemeBrightness(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return DEFAULT_THEME_BRIGHTNESS;
  }

  return Math.min(
    THEME_BRIGHTNESS_MAX,
    Math.max(THEME_BRIGHTNESS_MIN, Math.round(numeric)),
  );
}

/**
 * 把「任意入参」解析成 { hex, brightness }，永不失败。
 * 大厅 / 展馆读库时用它：脏数据最多退化成默认金色 + 50% 深浅，绝不会白屏。
 */
export function parseThemeSetting(raw: unknown): StorefrontThemeSetting {
  const record =
    isRecord(raw) ? raw : typeof raw === "string" ? parseJsonRecord(raw) : null;

  return {
    hex: normalizeThemeColor(record ? pickHexField(record) : raw),
    brightness: normalizeThemeBrightness(
      record ? pickBrightnessField(record) : null,
    ),
  };
}

/**
 * 校验写库入参（后台 PUT / 直接调接口用）。
 * 与 parseThemeSetting 的区别：hex 非法、brightness 写成非数字时返回 null，
 * 由调用方回 400 —— 宁可直接拒绝，也不要悄悄把商户的配置改成默认金色。
 */
export function readThemeSettingInput(raw: unknown): StorefrontThemeSetting | null {
  const record =
    isRecord(raw) ? raw : typeof raw === "string" ? parseJsonRecord(raw) : null;
  const hexSource = record ? pickHexField(record) : raw;

  if (!isValidThemeColor(hexSource)) {
    return null;
  }

  const brightnessSource = record ? pickBrightnessField(record) : null;

  if (brightnessSource !== null && brightnessSource !== undefined) {
    const numeric =
      typeof brightnessSource === "number"
        ? brightnessSource
        : typeof brightnessSource === "string" && brightnessSource.trim()
          ? Number(brightnessSource)
          : Number.NaN;

    if (!Number.isFinite(numeric)) {
      return null;
    }
  }

  return {
    hex: normalizeThemeColor(hexSource),
    brightness: normalizeThemeBrightness(brightnessSource),
  };
}

/**
 * 写库格式：`{"hex":"#d4af37","brightness":50}`。
 * 固定成这个顺序与字段名，数据库里肉眼可读，也方便以后做 SQL 迁移。
 */
export function serializeThemeSetting(setting: StorefrontThemeSetting): string {
  const { hex, brightness } = parseThemeSetting(setting);

  return JSON.stringify({ hex, brightness });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 归一化模块配置（layoutConfig）。
 *
 * 容错规则，保证任何脏数据都不会让大厅「凭空少一块」：
 * - 支持 `{ modules: [...] }` 与裸数组两种写法；
 * - 丢弃未知 id、重复 id；
 * - 缺失的模块按默认顺序补到末尾并默认显示；
 * - visible 只有明确写成 false 才算关闭。
 */
export function normalizeLayoutConfig(raw: unknown): StorefrontModule[] {
  const source = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.modules)
      ? raw.modules
      : null;

  if (!source) {
    return DEFAULT_STOREFRONT_MODULES.map((module) => ({ ...module }));
  }

  const result: StorefrontModule[] = [];

  for (const entry of source) {
    if (!isRecord(entry)) {
      continue;
    }

    const id = entry.id;

    if (!isStorefrontModuleId(id) || result.some((module) => module.id === id)) {
      continue;
    }

    result.push({ id, visible: entry.visible !== false });
  }

  for (const id of STOREFRONT_MODULE_IDS) {
    if (!result.some((module) => module.id === id)) {
      result.push({ id, visible: true });
    }
  }

  return result;
}

function normalizeLanguageToken(value: string, fallback: string) {
  const token = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 4);

  return token || fallback;
}

/**
 * 语言按钮文案归一化：只接受「中文标签/英文标签」格式。
 * 中文标签最多 4 个英文字母，英文按需求固定为 EN，缺失时回落到 CH/EN。
 */
export function normalizeLanguageStyle(raw: unknown): string {
  if (typeof raw !== "string") {
    return DEFAULT_STOREFRONT_LANGUAGE_STYLE;
  }

  const value = raw.trim();

  if (!value) {
    return DEFAULT_STOREFRONT_LANGUAGE_STYLE;
  }

  const separator = value.indexOf("/");
  const zhSource = separator === -1 ? value : value.slice(0, separator);
  const zh = normalizeLanguageToken(zhSource, "CH");

  // 中文标签不能也是 EN：否则 "EN/EN" 会让两个按钮完全一样，直接使用默认值。
  if (zh === "EN") {
    return DEFAULT_STOREFRONT_LANGUAGE_STYLE;
  }

  return `${zh}/EN`;
}

/** 把语言按钮文案拆成中英文两个标签，渲染与归一化共用。 */
export function parseLanguageStyle(raw: unknown): { zh: string; en: string } {
  const [zh, en] = normalizeLanguageStyle(raw).split("/");

  return { zh: zh || "CH", en: en || "EN" };
}

/**
 * 归一化完整装修配置（layoutConfig）。
 *
 * 兼容历史结构：
 * - 裸数组 / `{ modules: [...] }` 只包含模块顺序；
 * - 缺失的 preset 回落到经典版式（老租户升级后外观不变）；
 * - 新增的互动组件开关缺失时默认开启，只有明确写成 false 才关闭。
 */
export function normalizeStorefrontLayout(raw: unknown): StorefrontLayout {
  const record = isRecord(raw) ? raw : {};

  return {
    preset: normalizeStorefrontPreset(record.preset),
    // 传整个 record：老的 layoutConfig.gameCardStyle 也会被识别并深色化迁移
    themeBackground: normalizeThemeBackground(record),
    modules: normalizeLayoutConfig(raw),
    showTopbarChat: record.showTopbarChat !== false,
    showSidebarCasinoAnim: record.showSidebarCasinoAnim !== false,
    languageStyle: normalizeLanguageStyle(record.languageStyle),
  };
}

/** 写库前统一序列化，避免 JSON 结构漂移 */
export function serializeLayoutConfig(layout: StorefrontLayout): StorefrontLayout {
  const normalized = normalizeStorefrontLayout(layout);

  return {
    ...normalized,
    modules: normalized.modules.map((module) => ({ ...module })),
  };
}

/** 上移 / 下移：返回新数组，越界时原样返回（后台按钮同时会禁用） */
export function moveStorefrontModule(
  modules: StorefrontModule[],
  id: StorefrontModuleId,
  direction: -1 | 1,
): StorefrontModule[] {
  const index = modules.findIndex((module) => module.id === id);
  const next = index + direction;

  if (index === -1 || next < 0 || next >= modules.length) {
    return modules;
  }

  const copy = [...modules];
  const [moved] = copy.splice(index, 1);
  copy.splice(next, 0, moved);

  return copy;
}


/* -------------------------------------------------------------------------- */
/* 主色派生                                                                    */
/* -------------------------------------------------------------------------- */

type Rgb = [number, number, number];
/** [色相 0-360, 饱和度 0-1, 明度 0-1] */
type Hsl = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(normalizeThemeColor(hex).slice(1), 16);

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb: Rgb) {
  return `#${rgb
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function rgbToHsl([r, g, b]: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return [0, 0, lightness];
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;

  if (max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (max === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }

  return [(hue + 360) % 360, Math.min(1, saturation), lightness];
}

function hslToRgb([hue, saturation, lightness]: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;

  let rgb: Rgb;

  if (hue < 60) {
    rgb = [chroma, second, 0];
  } else if (hue < 120) {
    rgb = [second, chroma, 0];
  } else if (hue < 180) {
    rgb = [0, chroma, second];
  } else if (hue < 240) {
    rgb = [0, second, chroma];
  } else if (hue < 300) {
    rgb = [second, 0, chroma];
  } else {
    rgb = [chroma, 0, second];
  }

  return [
    Math.round((rgb[0] + offset) * 255),
    Math.round((rgb[1] + offset) * 255),
    Math.round((rgb[2] + offset) * 255),
  ];
}

/**
 * 同色系色阶：色相永远不变，只各自缩放饱和度与明度。
 * 金色 #d4af37 → #edd484 / #f8e7b1 / #ac913b，与改造前的 #f0d27c / #f8e9b0 / #b8912f 基本一致；
 * 换成蓝色时也会是同色系的亮蓝 / 深蓝，不会糊成灰色。
 */
function lighterShade([hue, saturation, lightness]: Hsl, saturationFactor: number, lightnessGain: number): Rgb {
  return hslToRgb([
    hue,
    Math.min(1, saturation * saturationFactor),
    lightness + (1 - lightness) * lightnessGain,
  ]);
}

/* 相对亮度（WCAG 公式），用来决定主色底上的文字该用深色还是白色 */
function relativeLuminance(rgb: Rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 阴影 / 径向渐变里用到的品牌透明度阶梯，与 globals.css 的默认值保持一致 */
const BRAND_ALPHAS = [10, 12, 14, 50, 65, 80, 85, 90, 95] as const;
/** 高光色（brand-soft）的透明度阶梯 */
const SOFT_ALPHAS = [55, 90, 95, 100] as const;

export type StorefrontTheme = {
  /** 归一化后的原始色号（= Tenant.themeColor 里的 hex，未套用深浅调节） */
  hex: string;
  /** 实际生效的主色 hex（已套用 brightness，玩家真正看到的颜色） */
  brand: string;
  /** 高光色：主色往白色提亮，用于图标 / 标题 */
  soft: string;
  /** 渐变中段 */
  mid: string;
  /** 文字高亮色：几乎发白的主色，用于金额 / 数字 */
  pale: string;
  /** 渐变深端 */
  deep: string;
  /** 主色底上的文字色（金色 → 近黑；深蓝 → 近白） */
  ink: string;
  /** 实际生效的深浅调节值（0-100） */
  brightness: number;
  /** 主色 HSL 字符串，注入 --primary */
  primary: string;
  /** 主色提亮 30%（往白色方向）的 HSL 字符串，注入 --primary-soft */
  primarySoft: string;
  /** 主色变暗 30% 的 HSL 字符串，注入 --primary-dark */
  primaryDark: string;
  /** 直接 spread 到根节点 style 上的 CSS 变量表（--primary* + --sf-*） */
  style: Record<string, string>;
};

/** 0-100 的深浅调节 → 明度系数：50 原样，往 0 变暗，往 100 变亮 */
function adjustLightness(lightness: number, brightness: number) {
  const factor = (normalizeThemeBrightness(brightness) - DEFAULT_THEME_BRIGHTNESS) / 50;

  const next =
    factor < 0
      ? lightness * (1 + factor)
      : lightness + (1 - lightness) * factor;

  return Math.min(
    THEME_LIGHTNESS_CEILING,
    Math.max(THEME_LIGHTNESS_FLOOR, next),
  );
}

/** 提亮 / 变暗用的明度阶梯，与需求里的 ±30% 一一对应 */
const SHADE_LIFT = 0.3;
const SHADE_DROP = 0.3;

function shiftLightness(lightness: number, ratio: number) {
  return Math.min(
    THEME_LIGHTNESS_CEILING,
    Math.max(THEME_LIGHTNESS_FLOOR, lightness + ratio),
  );
}

/** HSL 元组 → 可直接写进 CSS 的 `hsl(H S% L%)`（现代空格语法，主流浏览器全支持） */
function hslString([hue, saturation, lightness]: Hsl) {
  return `hsl(${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(
    lightness * 100,
  )}%)`;
}

/**
 * 由「主色 + 深浅调节」派生整套前台配色。这是全站唯一的配色算法：
 * 后台预览、大厅 `/`、品牌展馆 `/provider/[code]` 都调用它，因此后台看到的
 * 颜色就是玩家看到的颜色，不存在两套实现跑偏的问题。
 *
 * 计算流程（与需求一致）：
 * 1. HEX → HSL；
 * 2. 用 brightness(0-100) 调整明度（50 = 原样），色相 / 饱和度保持不变；
 * 3. 由调整后的 HSL 算出三个核心变量：
 *    --primary      = hsl(H S% L%)          （按钮 / 高亮）
 *    --primary-soft = 明度 +30% 到白色方向   （Hover / 发光）
 *    --primary-dark = 明度 -30%              （卡片底色 / 阴影）
 * 4. 再把同一批颜色以 hex 形式写进大厅既有的 --sf-* 变量与透明度阶梯，
 *    让 bg-brand/15、text-brand-soft、from-brand-deep 等既有工具类继续生效。
 *
 * 兼容性：入参既可以是裸 hex、JSON 字符串，也可以是 { hex, brightness } 对象。
 */
export function buildStorefrontTheme(
  themeColor: string | StorefrontThemeSetting,
): StorefrontTheme {
  const setting = parseThemeSetting(themeColor);
  const baseHsl = rgbToHsl(hexToRgb(setting.hex));

  const hsl: Hsl = [
    baseHsl[0],
    baseHsl[1],
    adjustLightness(baseHsl[2], setting.brightness),
  ];

  const rgb = hslToRgb(hsl);
  const brand = toHex(rgb);

  const softHsl: Hsl = [
    hsl[0],
    Math.min(1, hsl[1] * 1.12),
    shiftLightness(hsl[2], (1 - hsl[2]) * SHADE_LIFT),
  ];
  const darkHsl: Hsl = [
    hsl[0],
    Math.min(1, hsl[1] * 0.95),
    shiftLightness(hsl[2], -hsl[2] * SHADE_DROP),
  ];

  const soft = toHex(hslToRgb(softHsl));
  const deep = toHex(hslToRgb(darkHsl));
  const mid = toHex(lighterShade(hsl, 1.06, 0.27));
  const pale = toHex(lighterShade(hsl, 1.3, 0.65));
  // 阈值取 0.42：品牌金 (#d4af37 亮度 0.449) 底上要用近黑的字，
  // 深蓝 / 深紫底则切到近白字，保证胶囊按钮的可读性。
  const ink = relativeLuminance(rgb) > 0.42 ? "#171105" : "#f8fafc";

  const style: Record<string, string> = {
    // 三个核心变量：任意 Tailwind 任意值类都能直接用，
    // 例如 text-[var(--primary)]、bg-[var(--primary-dark)]、shadow-[0_0_20px_var(--primary-soft)]。
    "--primary": hslString(hsl),
    "--primary-soft": hslString(softHsl),
    "--primary-dark": hslString(darkHsl),
    "--primary-ink": ink,
    // 大厅既有工具类沿用的 --sf-* 命名：写入同一批颜色的 hex 等价色，
    // 保证两套变量永远指向同一个颜色。
    "--sf-brand": brand,
    "--sf-soft": soft,
    "--sf-mid": mid,
    "--sf-pale": pale,
    "--sf-deep": deep,
    "--sf-ink": ink,
  };

  for (const alpha of BRAND_ALPHAS) {
    style[`--sf-a${alpha}`] = `rgb(${rgb.join(" ")} / ${alpha / 100})`;
  }

  const softRgb = hexToRgb(soft);

  for (const alpha of SOFT_ALPHAS) {
    style[`--sf-soft-a${alpha}`] = `rgb(${softRgb.join(" ")} / ${alpha / 100})`;
  }

  return {
    hex: setting.hex,
    brand,
    soft,
    mid,
    pale,
    deep,
    ink,
    brightness: setting.brightness,
    primary: style["--primary"],
    primarySoft: style["--primary-soft"],
    primaryDark: style["--primary-dark"],
    style,
  };
}

/** 前台首屏需要的装修配置（服务端读库后传给 LobbyClient） */
export type StorefrontSettings = {
  /** 生效的租户 id（可能为 null：库里还没有任何租户） */
  tenantId: string | null;
  /** 租户名，后台预览时显示「当前正在装修：xxx」 */
  tenantName: string | null;
  /**
   * 租户品牌 Logo（Tenant.logoUrl，已校验：http(s) 绝对地址或 / 开头的站内路径）。
   * null = 商户没配 Logo，大厅顶栏用「商户名首字母」生成占位图，见 src/app/lobby-client.tsx。
   */
  tenantLogoUrl: string | null;
  /**
   * Logo 在大厅顶栏的位置（Tenant.logoPosition，已归一化）。
   * `left` = 左侧品牌区（默认）；`center` = 屏幕正中央。
   * 位置只是把**同一个** Logo 放进不同栅格，不会渲染两份，见 src/app/lobby-client.tsx。
   */
  logoPosition: TenantLogoPosition;
  /**
   * 租户记账货币（Tenant.currency，已归一化，默认 MYR）。
   * 大厅顶栏 BALANCE、玩家中心所有金额都用它渲染符号，见 src/lib/currency.ts。
   */
  currency: string;
  /** 主色（已归一化的 hex） */
  themeColor: string;
  /** 深浅调节 0-100（50 = 色号原样） */
  themeBrightness: number;
  /**
   * 排版模板（一套组件 + 5 组 layout token）。
   * 大厅根节点会挂 `data-storefront-preset` 与对应的 --sf-* 变量，
   * CSS 见 src/app/globals.css 的排版模板区块。
   */
  preset: StorefrontPresetId;
  /**
   * 主题背景色（一套 GameCard + 15 组色值）。
   * 大厅与品牌展馆的根节点通过 buildThemeBackgroundStyle() 把它变成 --tb-* 变量，
   * 环境光与游戏卡片外框 / 文字底板描边都从这里取色，见 src/lib/theme-backgrounds.ts。
   */
  themeBackground: ThemeBackgroundId;
  /** 三大模块的开关与顺序（数组顺序即页面顺序） */
  modules: StorefrontModule[];
  /** 顶栏语言按钮左侧是否显示 AI 客服图标 */
  showTopbarChat: boolean;
  /** 侧边栏「斗鸡」下方是否显示娱乐场动态卡片 */
  showSidebarCasinoAnim: boolean;
  /** 语言按钮文案，形如 CH/EN */
  languageStyle: string;
};

/** 品牌 Logo 地址长度上限：超过基本可以判定为脏数据或粘贴错误 */
export const TENANT_LOGO_URL_MAX_LENGTH = 2048;

/**
 * 校验并归一化商户品牌 Logo 地址（Tenant.logoUrl）。
 *
 * 只接受两种写法，其余一律当作「未配置」返回 null：
 * 1. http(s) 绝对地址 —— 商户把 Logo 传到图床 / CDN；
 * 2. 以 `/` 开头的站内路径 —— 超管上传接口返回的 `/api/tenant-logos/<uuid>.png`，
 *    或放在 public/ 下的静态资源（如 /brand/winvora.png）。
 *
 * 刻意不支持 `data:` / `javascript:` / 协议相对地址（`//host/x.png` 会被当成外站）：
 * 这些值最终会直接进 `<img src>`，放开等于给后台表单留一个注入面。
 *
 * 写入侧（超管 PUT /api/tenants/[id]）与读取侧（storefront-data / player-session /
 * <TenantBrandLockup />）共用同一个函数，保证「后台存进去的值」和「前台认的值」
 * 永远同一口径：认不出来的值前台一律降级成「商户名首字母」占位。
 */
export function normalizeTenantLogoUrl(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();

  if (!trimmed || trimmed.length > TENANT_LOGO_URL_MAX_LENGTH) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    // `//evil.com/logo.png` 是协议相对地址，指向外站，不算站内资源
    return trimmed.startsWith("//") ? null : trimmed;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* 品牌 Logo 显示位置（玩家大厅顶栏）                                          */
/* -------------------------------------------------------------------------- */

/**
 * Logo 在大厅顶栏的位置。
 *
 * - `left`  ：左侧品牌区（**默认** = 改造前的排版，老租户升级后外观完全不变）；
 * - `center`：屏幕正中央（左槽放菜单按钮、右槽放搜索 / 语言 / 余额）。
 *
 * 关键约定：位置只决定「同一个 Logo 被放进哪一格栅格」，
 * **不是**在左边再画一个 —— 全局永远只有一个 Logo 实例（见 AGENTS.md 4.2）。
 *
 * 权限与 logoUrl 完全一致：只有超管在【租户管理 → 新增 / 编辑租户】能写；
 * 商户后台（/api/tenant/settings）与装修页（/api/admin/storefront）都不认它，
 * 所以它不是 layoutConfig 里的字段，而是 Tenant 上的独立列。
 */
export const TENANT_LOGO_POSITIONS = ["left", "center"] as const;
export type TenantLogoPosition = (typeof TENANT_LOGO_POSITIONS)[number];
export const DEFAULT_TENANT_LOGO_POSITION: TenantLogoPosition = "left";

export function isTenantLogoPosition(
  value: unknown,
): value is TenantLogoPosition {
  return (
    typeof value === "string" &&
    (TENANT_LOGO_POSITIONS as readonly string[]).includes(value)
  );
}

/**
 * 读取侧统一兜底：脏数据 / 老租户缺字段 / null 一律当作 `left`，
 * 保证「后台存进去的值」与「前台认的值」同一口径，且升级后老站点外观不变。
 */
export function normalizeTenantLogoPosition(
  raw: unknown,
): TenantLogoPosition {
  return isTenantLogoPosition(raw) ? raw : DEFAULT_TENANT_LOGO_POSITION;
}


