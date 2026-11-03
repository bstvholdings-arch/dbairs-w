/**
 * 活动海报（Hero Banner）的尺寸规范与「比例体检」。
 *
 * 为什么需要这份规范：
 * - 大厅主视觉（Hero）的舞台高度是**统一**的（手机 200 / 平板 290 / 桌面 400，见
 *   storefront-presets.ts 的 HERO_HEIGHT_TOKENS + globals.css 的 [data-hero-stage]），
 *   5 套排版模板共用同一块舞台；
 * - 前台按断点分两套口径（见 components/lobby/hero-poster-image.tsx）：
 *   电脑端「双层渲染」（底层 object-cover + 模糊铺满，顶层 object-contain 完整露出，
 *   所以**任何图都不会被裁掉**），手机端是一张 200px 高的**圆角卡片**、
 *   单层 object-cover 铺满（比例越方 / 越竖，被裁掉的内容越多）；
 * - 但比例太方 / 竖图的素材，电脑端顶层只剩中间窄窄一条、两侧全是模糊底色，观感很差。
 *   因此后台在上传处就把「推荐 1920×600（约 3.2:1）」说清楚，并在检测到方图时提示。
 *
 * 本文件是纯 TS（不 import React / 不 import prisma），服务端与客户端都能用，
 * 保证「后台提示的尺寸」与「前台舞台的假设」永远来自同一份常量。
 */

/** 推荐上传尺寸：21:9 再宽一点的超宽横图，桌面 1600×400 的舞台几乎刚好铺满 */
export const RECOMMENDED_BANNER_WIDTH = 1920;
export const RECOMMENDED_BANNER_HEIGHT = 600;

/**
 * 「够宽」的下限：16:9 ≈ 1.78，21:9 ≈ 2.33。
 * 低于 1.6 时，桌面舞台（常见 1200–1600 宽 / 400 高 ≈ 3–4:1）两侧会留出明显模糊边，
 * 所以从 1.6 开始提示商户换宽图（只是提示，不阻断保存）。
 */
export const MIN_BANNER_ASPECT_RATIO = 1.6;

export type BannerImageSize = {
  width: number;
  height: number;
};

/** wide = 推荐；square = 偏方；portrait = 竖图 */
export type BannerAspectVerdict = "wide" | "square" | "portrait";

/**
 * 比例判定。脏数据（0 / NaN / 负数）按 "square" 处理：
 * 宁可多提示一句换宽图，也不要把检测失败的图当成合格图放过去。
 */
export function classifyBannerAspectRatio(
  width: number,
  height: number,
): BannerAspectVerdict {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "square";
  }

  const ratio = width / height;

  if (ratio >= MIN_BANNER_ASPECT_RATIO) {
    return "wide";
  }

  return ratio < 1 ? "portrait" : "square";
}

/** 比例文案（保留两位小数，例如 "3.20"），用于提示里的「3.20:1」 */
export function formatBannerAspectRatio(width: number, height: number): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "—";
  }

  return (width / height).toFixed(2);
}

/**
 * 手机端专用海报（PromotionBanner.mobileImageUrl）的尺寸规范。
 *
 * 与电脑图的关键差异：**手机图是用 object-cover 铺满圆角卡片的**（唯一实现见
 * components/lobby/hero-poster-image.tsx）—— 手机卡片只有 200px 高，
 * 卡片内部**没有模糊底**（不像电脑端双层），所以图片必须自己填满：
 * 用 contain 会上下留出生硬黑边，用 cover 才能出「一张干净横幅」的观感。
 * 代价是：比例离手机卡片越远，被裁掉的内容越多，所以这里给一个「安全区间」
 * 做**提示**（只提示，不阻断保存 —— 与电脑图的比例体检同一口径）。
 */
export const RECOMMENDED_MOBILE_BANNER_WIDTH = 1080;
export const RECOMMENDED_MOBILE_BANNER_HEIGHT = 500;

/**
 * 手机卡片典型尺寸 ≈ 358 × 200 ≈ 1.8:1（390px 屏幕去掉两侧 16px 留白）。
 * 安全区间：1.2 ~ 3.2 ——
 * - 1:1 方图（800 × 800）在 cover 下会左右裁掉约四成，文字容易被切，需要提示；
 * - 比 3.2 更宽的图（把 1920 × 600 的电脑图直接塞进手机位）会左右裁掉太多，
 *   手机上大字基本保不住，建议单独出一张。
 */
export const MOBILE_BANNER_SAFE_MIN_RATIO = 1.2;
export const MOBILE_BANNER_SAFE_MAX_RATIO = 3.2;

/** ok = 手机上会满屏且几乎不裁；warn = 能显示但会被裁掉一部分，建议换图 */
export type MobileBannerAspectVerdict = "ok" | "warn";

/** 手机图比例体检（脏数据按 warn 处理：宁可多提示一句，也不要放一张会切字的图过去） */
export function classifyMobileBannerAspectRatio(
  width: number,
  height: number,
): MobileBannerAspectVerdict {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "warn";
  }

  const ratio = width / height;

  return ratio >= MOBILE_BANNER_SAFE_MIN_RATIO &&
    ratio <= MOBILE_BANNER_SAFE_MAX_RATIO
    ? "ok"
    : "warn";
}

/**
 * 读取图片的原始像素尺寸（仅浏览器端可用）。
 *
 * 为什么不用 <img> 的 onLoad：弹窗里图片地址可能是商户直接粘的外站图，
 * 我们只是想在「保存前」量一下比例，用不到像素数据，也不画 canvas，
 * 因此不需要 crossOrigin —— 外站图床没配 CORS 头也能读到 naturalWidth。
 *
 * 任何失败（404 / 超时 / 非图片 / SSR）都返回 null：检测失败绝不阻断上传。
 */
export function measureImageSize(
  src: string,
  timeoutMs = 8000,
): Promise<BannerImageSize | null> {
  const trimmed = src.trim();

  if (!trimmed || typeof window === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const image = new window.Image();
    let settled = false;

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    function finish(size: BannerImageSize | null) {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);
      // 断开引用，避免图床慢速响应时把回调留在内存里
      image.onload = null;
      image.onerror = null;
      resolve(size);
    }

    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;

      finish(
        width > 0 && height > 0
          ? { width, height }
          : null,
      );
    };
    image.onerror = () => finish(null);
    image.src = trimmed;
  });
}
