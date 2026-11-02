import type { GameCardStyleId } from "@/lib/game-card-styles";
import type { StorefrontModule } from "@/lib/storefront";
import type { StorefrontPresetId } from "@/lib/storefront-presets";


/** 后台装修页用的租户行（只在装修页读取装修相关字段） */
export type StorefrontTenantRow = {
  id: string;
  name: string;
  domain: string;
  subdomain: string;
  status: string;
  /** 已归一化的十六进制主色 */
  themeColor: string;
  /** 深浅调节：0-100，50 = 色号原样 */
  themeBrightness: number;
  /** 已归一化的排版模板（一套组件 + 5 组 layout token） */
  preset: StorefrontPresetId;
  /** 已归一化的游戏封面风格（一套 GameCard + 3 组 token） */
  gameCardStyle: GameCardStyleId;
  /** 已归一化的模块开关与顺序 */
  modules: StorefrontModule[];
  /** 顶栏语言按钮左侧是否显示 AI 客服图标 */
  showTopbarChat: boolean;
  /** 侧边栏「斗鸡」下方是否显示娱乐场动态卡片 */
  showSidebarCasinoAnim: boolean;
  /** 语言按钮文案，形如 CH/EN */
  languageStyle: string;
};

export type StorefrontSaveResponse = {
  success?: boolean;
  error?: string;
  tenant?: StorefrontTenantRow;
};

/**
 * 后台装修页【游戏商商标网格】用的游戏商行。
 * 游戏商是全局配置（不是按租户区分），因此单独一个类型。
 */
export type StorefrontProviderRow = {
  id: string;
  name: string;
  /** 品牌墙顺序：数字越大越靠前 */
  sortOrder: number;
  /** 是否在首页品牌墙展示 */
  showInShowcase: boolean;
  /** 是否上架；false 时前台任何位置都不展示，后台顺手标出来 */
  isActive: boolean;
  /** 已同步的游戏数量 */
  gameCount: number;
};

export type ProviderReorderResponse = {
  success?: boolean;
  error?: string;
  providers?: Array<{
    id: string;
    name: string;
    sortOrder: number;
    showInShowcase: boolean;
  }>;
};
