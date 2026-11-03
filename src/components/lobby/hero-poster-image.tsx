/**
 * 大厅主视觉（Hero）海报渲染引擎 —— 一份组件，5 套模板共用。
 *
 * 两个断点、两套完全不同的口径（产品定稿，见 AGENTS.md 第 4 条）：
 *
 * ── 手机（<768px）：**精致卡片** ────────────────────────────────────────────
 * - 舞台本身就是一张圆角卡片：横向留白（main 的 px-3 + 模块的 mx-1 = 16px）、
 *   固定 200px 高（globals.css 的 [data-hero-stage]），**绝不撑满手机屏幕**；
 *   海报下面紧跟着功能岛 / 品牌墙 / 游戏列表，可以正常上下滚动。
 * - 卡片内部**只有一层图**：原图 object-cover 铺满 + object-[center_30%]，
 *   把裁切重心压在上三分之一（人物面部与主标题通常在那里），
 *   没有模糊底、没有黑色蒙版 —— 手机端要的是一张干净的横幅，不是氛围画布。
 *
 * ── 电脑（≥768px）：**大气满版** ────────────────────────────────────────────
 * - 舞台 350–450px 高（同样由 [data-hero-stage] 给）。
 * - 为什么电脑必须双层：舞台比例（如 1440 × 400 ≈ 3.6:1）与常见的 16:9 / 方图
 *   几乎不可能刚好相等 —— 单层 cover 会切掉人物头部与标题，单层 contain 会留黑边。
 *   所以：底层 object-cover + object-top + 高斯模糊 + 黑色遮罩把留白填满
 *   （空出来的地方是模糊底色，不是黑边），顶层 object-contain 等比完整露出、
 *   **永不裁剪 / 永不拉伸**。
 *
 * ── 双图分离（手机专用海报）────────────────────────────────────────────────
 * 手机卡片只有 200px 高、约 1.8:1，1920 × 600 的宽图缩下去字就看不清，所以支持
 * 给同一张活动单独配一张**手机端海报**（PromotionBanner.mobileImageUrl）：
 * - <768px 且配了手机图 → 用手机图铺满卡片（专用图按手机比例出，裁得最少）；
 * - <768px 但**没配**手机图 → 用电脑图铺满卡片（cover + center 30%：比例差多少
 *   裁多少，但绝不会出现黑边或破图；后台上传处会现场研判提示，只提示不阻断，
 *   见 lib/promotion-banner-image.ts 的 classifyMobileBannerAspectRatio）；
 * - ≥768px → 永远用电脑图 + 双层（顶层 contain 不裁切）。
 *
 * 为什么用 <picture> + <source media> 而不是「两个 <img> + Tailwind 的
 * md:hidden / hidden md:block」：后者两个 img 都在文档流里，**手机端会连电脑大图
 * 一起下载**（1920 × 600 动辄几百 KB），首屏 LCP 直接被拖垮。用 <picture> 时浏览器
 * 只按断点挑一张下载。断点必须与 Tailwind 的 md（768px）严格一致，
 * 否则会出现「按手机图布局、按电脑图取图」的错位。
 *
 * 铁律：
 * - 这层逻辑只能有一份。promo-hero-carousel.tsx（玩家端）、后台弹窗预览、
 *   后台活动列表缩略图、玩家端活动列表共用本组件，禁止各自复制一遍 <img> 叠加逻辑；
 * - 两层都用原生 <img>（商户上传 + 外站图床，next/image 的域名白名单管不住）；
 * - 同一断点下所有层都挂同一组 <picture>/<source>：解析出同一个 URL，浏览器按地址去重，
 *   只下载一次（手机端被 display:none 隐藏的桌面模糊层同样不会额外下载）。
 */

/** 手机图切换断点 —— 必须与 Tailwind 的 md（768px）保持一致 */
export const HERO_MOBILE_MEDIA = "(max-width: 767px)";

export function HeroPosterImage({
  src,
  /** 手机端专用海报：可选。空 / 与 src 相同都按「没配」处理 */
  mobileSrc = null,
  alt,
  /** 首屏第一张走 eager + high，其余懒加载 */
  eager = false,
  /** 图片 404 / 图床被墙时，调用方据此降级成「品牌色底 + 标题」 */
  onError,
  /**
   * 后台预览用：强制按**手机端**的样子渲染（不跟随当前窗口宽度）。
   * 商户在电脑上编辑时也能看到手机端到底长什么样，不用拿手机去试。
   */
  forceMobile = false,
}: {
  src: string;
  mobileSrc?: string | null;
  alt: string;
  eager?: boolean;
  onError?: () => void;
  forceMobile?: boolean;
}) {
  const loading = eager ? "eager" : "lazy";
  const fetchPriority = eager ? "high" : "auto";

  const desktopSrc = src.trim();
  const phoneSrc = mobileSrc?.trim() ?? "";
  // 两张图地址相同就当成「没配手机图」，避免多一层无意义的 <source>
  const hasPhoneSrc = Boolean(phoneSrc) && phoneSrc !== desktopSrc;

  const frontSrc = forceMobile && hasPhoneSrc ? phoneSrc : desktopSrc;
  // forceMobile 时直接把手机图写进 <img src>，不再走媒体查询
  const showPhoneSource = hasPhoneSrc && !forceMobile;

  /**
   * 顶层适配（改之前先把文件头的「两个断点两套口径」读完）：
   * - 手机 → 单层 object-cover 铺满卡片，裁切重心 center 30%
   *   （人物面部与主标题通常在上三分之一，居中裁会切到下半身/留白）；
   * - ≥768px → md:object-contain + md:object-center，回到「完整显示、不裁切」；
   * - forceMobile → 无论窗口多宽都按手机卡片口径渲染（后台预览用）。
   * object-fit / object-position **只能走 class**：内联 style 会盖掉 md 断点切换。
   */
  const frontFit = forceMobile
    ? "object-cover object-[center_30%]"
    : "object-cover object-[center_30%] md:object-contain md:object-center";

  /**
   * 桌面氛围层（模糊底 + 黑色蒙版）在手机上不需要：单层 cover 已经填满卡片。
   * 用 class 隐藏而不是「按条件不渲染」：SSR 拿不到断点，而且两层挂的是同一个
   * <picture>/<source>，被隐藏的 img 命中的 URL 与顶层完全相同，浏览器按地址去重，
   * 手机端不会因此多下一张图。
   */
  const backLayerVisible = forceMobile ? "hidden" : "hidden md:block";

  return (
    <>
      {/* 底层（**仅电脑端**）：铺满 + 顶部对齐 + 高斯模糊。scale-110 让模糊边缘被舞台
          裁掉，不会在四角露出「羽化白边」。alt 留空 + aria-hidden：同一张图不重复朗读。
          手机上这一层 display:none —— 卡片里只有顶层那一张 cover 图。
          <picture> 只是给浏览器挑图用的包裹层（display:contents，不产生盒子），
          绝对定位仍然相对外面的舞台，不受它影响。 */}
      <picture className="contents">
        {showPhoneSource ? (
          <source media={HERO_MOBILE_MEDIA} srcSet={phoneSrc} />
        ) : null}
        <img
          src={frontSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          loading={loading}
          fetchPriority={fetchPriority}
          onError={onError}
          className={`pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover object-top blur-xl ${backLayerVisible}`}
        />
      </picture>

      {/* 黑色半透明遮罩：压暗模糊底，保证顶层图片与圆点 / 箭头的对比度。手机端不需要 */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-black/60 ${backLayerVisible}`}
      />

      {/* 顶层：手机 = cover 铺满圆角卡片（center 30% 保住面部 / 标题）；
          电脑 = contain 完整显示。**不能**写内联 style.objectFit，
          否则会盖掉 md: 断点切换（手机永远 cover / 桌面永远 contain）。 */}
      <picture className="contents">
        {showPhoneSource ? (
          <source media={HERO_MOBILE_MEDIA} srcSet={phoneSrc} />
        ) : null}
        <img
          src={frontSrc}
          alt={alt}
          draggable={false}
          loading={loading}
          fetchPriority={fetchPriority}
          onError={onError}
          className={`absolute inset-0 h-full w-full ${frontFit}`}
        />
      </picture>
    </>
  );
}

