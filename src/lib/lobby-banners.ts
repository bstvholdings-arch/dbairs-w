import type { TranslationKey } from "./i18n-types";

/**
 * 大厅 Hero 轮播数据（Mock）。
 *
 * 现阶段全部是内置占位素材：背景用 CSS 渐变 + 内联 SVG 图形拼出来，
 * 不请求任何外部图片，离线可用、首屏不会被图片拖慢。
 *
 * TODO: 此处需读取后台配置的 Banner 图片和跳转链接。
 *   - 后台配置好之后，把 LOBBY_BANNERS 换成接口返回值（例如 CMS 的 banner 列表），
 *     并给 LobbyBanner 填上 imageUrl / href；
 *   - hero-carousel.tsx 已经支持 imageUrl：有图时用该图当背景（object-cover 的 div 背景），
 *     没有图时回退到内置 SVG 图形，所以后台没配也不会出现空白横幅；
 *   - 跳转链接同理：有 href 时 CTA 走 <Link>，没有 href 时走大厅内的动作（action）。
 */

/** CTA 行为：没有后台链接时的默认落点 */
export type LobbyBannerAction = "play" | "deposit" | "providers";

/** 内置占位图形（后台配了 imageUrl 就不再用它） */
export type LobbyBannerArt = "jackpot" | "slots" | "live";

export type LobbyBanner = {
  id: string;
  /** 英文大写字标：品牌词，和 UI 里的 LIVE / VIP 一样不翻译 */
  kicker: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  ctaKey: TranslationKey;
  action: LobbyBannerAction;
  art: LobbyBannerArt;
  /** 主色（描边 / 字标高亮） */
  accent: string;
  /** 副色（渐变暗部 / 光晕） */
  secondary: string;
  /** 后台配置的横幅图（当前为空 → 用内置 SVG 占位图） */
  imageUrl?: string;
  /** 后台配置的跳转链接（当前为空 → 走 action） */
  href?: string;
};

/** 自动轮播间隔：每 5 秒切换一张 */
export const HERO_ROTATE_MS = 5000;

// TODO: 此处需读取后台配置的 Banner 图片和跳转链接（CMS / banner 表返回 imageUrl + href）。
// 现阶段是 3 张内置 Mock 数据，字段结构与后台一致，接上接口时只需替换下面这个数组。
export const LOBBY_BANNERS: LobbyBanner[] = [
  {
    id: "jackpot",
    kicker: "VIP LOUNGE",
    // 奖池轮播：文案沿用大厅原有的 Hero 主语，标题右侧会挂实时奖池数字
    titleKey: "lobby.hero.title",
    bodyKey: "lobby.hero.subtitle",
    ctaKey: "lobby.playNow",
    action: "play",
    art: "jackpot",
    accent: "#f0d27c",
    secondary: "#7a5a12",
  },
  {
    id: "slots",
    kicker: "HOT SLOTS",
    titleKey: "lobby.hero.slot.title",
    bodyKey: "lobby.hero.slot.body",
    ctaKey: "lobby.deposit",
    action: "deposit",
    art: "slots",
    accent: "#e879f9",
    secondary: "#5b21b6",
  },
  {
    id: "live",
    kicker: "LIVE CASINO",
    titleKey: "lobby.hero.live.title",
    bodyKey: "lobby.hero.live.body",
    ctaKey: "lobby.providers.open",
    action: "providers",
    art: "live",
    accent: "#67e8f9",
    secondary: "#0e7490",
  },
];
