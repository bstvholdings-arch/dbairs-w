/**
 * 游戏商品牌资产（大厅品牌墙 + 游戏商专属展馆共用）。
 *
 * 数据库里游戏商只有 name，没有 logo / 主题色，所以这里按名称稳定推导出一套
 * 「品牌视觉」：缩写、主色、辅色、深色底、图腾。同一个游戏商在大厅品牌墙、
 * 游戏卡片、/provider/[code] 展馆 Banner 上颜色永远一致。
 */

/** 游戏商展馆路由前缀：/provider/[code] */
export const PROVIDER_HALL_PREFIX = "/provider";

/** 品牌图腾：展馆 Banner 水印 + 品牌墙图标使用 */
export type ProviderEmblem =
  | "reels"
  | "cards"
  | "dragon"
  | "fish"
  | "crown"
  | "dice";

export type ProviderBrand = {
  /** 品牌缩写（Logo 上的 2 个字母） */
  initials: string;
  /** 高饱和主色 */
  primary: string;
  /** 渐变辅色 */
  secondary: string;
  /** 深色底，用于 Banner / 卡片背景 */
  base: string;
  emblem: ProviderEmblem;
};

type ProviderBrandPreset = Omit<ProviderBrand, "initials">;

const PROVIDER_BRAND_PRESETS: ProviderBrandPreset[] = [
  { primary: "#f8e9b0", secondary: "#d4af37", base: "#241a03", emblem: "crown" },
  { primary: "#a7f3d0", secondary: "#10b981", base: "#032117", emblem: "reels" },
  { primary: "#fda4af", secondary: "#e11d48", base: "#2a0410", emblem: "cards" },
  { primary: "#e9d5ff", secondary: "#a855f7", base: "#1c0630", emblem: "dice" },
  { primary: "#bfdbfe", secondary: "#3b82f6", base: "#04142e", emblem: "fish" },
  { primary: "#fed7aa", secondary: "#f97316", base: "#2a1002", emblem: "dragon" },
  { primary: "#a5f3fc", secondary: "#06b6d4", base: "#021c22", emblem: "reels" },
];

/** 与 lobby-games.ts 同样的 31 进制哈希：保证同一名称永远落到同一套品牌色。 */
function hashKey(key: string): number {
  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 2147483647;
  }

  return hash;
}

/**
 * 游戏商名 → URL slug。
 * "PG Soft" → "pg-soft"，"scr888h5" → "scr888h5"。
 * 纯中文等无法转写的名称回退成 "provider-<hash>"，保证每个游戏商都有独立链接。
 */
export function providerSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `provider-${hashKey(name).toString(36)}`;
}

/**
 * 展馆地址：品牌墙点击 / 服务端解析都走这一个函数，避免两边规则不一致。
 *
 * `tenantKey` 非空时（后台【预览前台】的预览模式）会把租户标识带进 URL，
 * 否则从预览大厅点进品牌馆就会丢掉租户上下文 —— 那是「代登录 abc 却看到
 * winvora」同类 Bug 的另一半。
 */
export function providerHallHref(name: string, tenantKey?: string | null): string {
  const href = `${PROVIDER_HALL_PREFIX}/${providerSlug(name)}`;
  const key = typeof tenantKey === "string" ? tenantKey.trim() : "";

  if (!key) {
    return href;
  }

  return `${href}?tenant=${encodeURIComponent(key)}`;
}

/** 品牌缩写：多词取首字母（PG Soft → PG），单词取前两位（scr888h5 → SC）。 */
export function providerInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }

  return name.trim().slice(0, 2).toUpperCase() || "DB";
}

export function providerBrand(name: string): ProviderBrand {
  const preset =
    PROVIDER_BRAND_PRESETS[hashKey(`brand-${name}`) % PROVIDER_BRAND_PRESETS.length];

  return { ...preset, initials: providerInitials(name) };
}
