"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { HeroPosterImage } from "@/components/lobby/hero-poster-image";
import {
  classifyBannerAspectRatio,
  classifyMobileBannerAspectRatio,
  formatBannerAspectRatio,
  measureImageSize,
  type BannerImageSize,
} from "@/lib/promotion-banner-image";
import type {
  PromotionBannerView,
  PromotionCategoryView,
} from "@/lib/promotions";

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

const labelClass = "text-[10px] uppercase tracking-[0.16em] text-neutral-600";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** 两路海报：电脑端（必填）/ 手机端（可选）。上传、比例体检、错误提示都按它区分 */
type BannerImageField = "desktop" | "mobile";

type PromotionFormValues = {
  categoryId: string;
  title: string;
  imageUrl: string;
  mobileImageUrl: string;
  linkUrl: string;
  sortOrder: string;
  isActive: boolean;
};

function initialValues(
  banner: PromotionBannerView | null,
  categories: PromotionCategoryView[],
): PromotionFormValues {
  return {
    categoryId: banner?.categoryId ?? categories[0]?.id ?? "",
    title: banner?.title ?? "",
    imageUrl: banner?.imageUrl ?? "",
    mobileImageUrl: banner?.mobileImageUrl ?? "",
    linkUrl: banner?.linkUrl ?? "",
    sortOrder: String(banner?.sortOrder ?? 0),
    isActive: banner?.isActive ?? true,
  };
}

/**
 * 活动 Banner 的新增 / 编辑弹窗。
 *
 * - 图片支持两种来源：本地上传（POST /api/tenant/promotions/upload，
 *   落 .promotion-storage/ 并返回 /api/promotions/banners/<key>）或直接填写外站地址；
 * - **双图分离**：电脑端海报（必填，imageUrl）+ 手机端海报（可选，mobileImageUrl）。
 *   手机只有 220px 高的舞台，1920 × 600 的宽图缩下去字会看不清，所以单独给一格。
 *   手机图留空时前台自动回落成「电脑图模糊底 + 完整显示」，不裁切、不留黑边；
 * - 提交永远是「完整对象」：POST 新建 / PATCH 覆盖，避免部分更新把字段清空
 *   （注意：漏传 mobileImageUrl 等于把手机图清空）；
 * - 图片与跳转地址的最终合法性由服务端 parsePromotionBannerInput 再校验一次
 *   （只认 http(s) 与站内 / 路径）。
 */
export function TenantPromotionFormModal({
  banner,
  categories,
  onClose,
  onSaved,
}: {
  banner: PromotionBannerView | null;
  categories: PromotionCategoryView[];
  onClose: () => void;
  onSaved: (banner: PromotionBannerView, mode: "create" | "edit") => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const desktopFileInput = useRef<HTMLInputElement | null>(null);
  const mobileFileInput = useRef<HTMLInputElement | null>(null);
  const isEdit = Boolean(banner);

  const [form, setForm] = useState<PromotionFormValues>(() =>
    initialValues(banner, categories),
  );
  /** 哪一路正在上传：两路互不影响，商户可以一边传手机图一边查看电脑图体检结果 */
  const [uploadingField, setUploadingField] = useState<BannerImageField | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<BannerImageField, string>>
  >({});

  /**
   * 海报比例体检结果：记「被测的地址 + 原始像素」，按电脑端 / 手机端分开存。
   *
   * 渲染时再和当前地址比对（probed.src === 当前值才算数），
   * 这样改地址后还没测完时不会拿上一张图的尺寸给出错误提示，
   * 也不用在 effect 里同步 setState（会触发 react-hooks/set-state-in-effect）。
   */
  const [probedSizes, setProbedSizes] = useState<
    Partial<Record<BannerImageField, BannerImageSize & { src: string }>>
  >({});

  // 弹窗打开时锁定背景滚动，关闭后恢复（与其它后台弹窗一致）
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const imageUrl = form.imageUrl.trim();
  const mobileImageUrl = form.mobileImageUrl.trim();

  // 只有「量过的就是当前这张图」才展示尺寸 / 比例提示，换图后旧结果自动失效
  const imageSize =
    probedSizes.desktop?.src === imageUrl ? probedSizes.desktop : null;
  const imageVerdict = imageSize
    ? classifyBannerAspectRatio(imageSize.width, imageSize.height)
    : null;

  const mobileImageSize =
    probedSizes.mobile?.src === mobileImageUrl ? probedSizes.mobile : null;
  const mobileImageVerdict = mobileImageSize
    ? classifyMobileBannerAspectRatio(
        mobileImageSize.width,
        mobileImageSize.height,
      )
    : null;

  /**
   * 上传完 / 粘贴外站地址后量一次原始像素，用于「传了方图 / 竖图」的防呆提示。
   * 电脑图与手机图各量各的（手机图是 cover 铺满，判定标准与电脑图不同）。
   *
   * - 400ms 防抖：粘贴地址时是逐字符变化的，不去抖会对着图床连打十几个请求；
   * - 检测失败（404 / 图床慢 / 跨域限制）一律静默：防呆提示绝不能阻断保存。
   */
  useEffect(() => {
    const targets: Array<[BannerImageField, string]> = [
      ["desktop", imageUrl],
      ["mobile", mobileImageUrl],
    ];
    const timers: number[] = [];
    let cancelled = false;

    for (const [field, url] of targets) {
      if (!url) {
        continue;
      }

      timers.push(
        window.setTimeout(() => {
          void measureImageSize(url).then((size) => {
            if (cancelled || !size) {
              return;
            }

            setProbedSizes((current) => ({
              ...current,
              [field]: { src: url, ...size },
            }));
          });
        }, 400),
      );
    }

    return () => {
      cancelled = true;
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [imageUrl, mobileImageUrl]);

  function patch(values: Partial<PromotionFormValues>) {
    setForm((current) => ({ ...current, ...values }));
  }

  function setUploadError(field: BannerImageField, message: string | null) {
    setUploadErrors((current) => {
      const next = { ...current };

      if (message) {
        next[field] = message;
      } else {
        delete next[field];
      }

      return next;
    });
  }

  /**
   * 上传一张海报（电脑端 / 手机端共用同一个接口，只是回填到不同字段）。
   * 两路上传各自维护「上传中 / 错误」，互不覆盖 —— 商户先传电脑图、再传手机图时，
   * 第一张的提示不会被第二张冲掉。
   */
  async function handleUpload(file: File, field: BannerImageField) {
    setUploadError(field, null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError(field, t("tenantPromotions.form.error.fileType"));
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setUploadError(field, t("tenantPromotions.form.error.fileTooLarge"));
      return;
    }

    setUploadingField(field);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/tenant/promotions/upload", {
        method: "POST",
        body,
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.url) {
        setUploadError(
          field,
          payload?.error ?? t("tenantPromotions.form.error.uploadFailed"),
        );
        return;
      }

      patch(
        field === "desktop"
          ? { imageUrl: payload.url }
          : { mobileImageUrl: payload.url },
      );
    } catch {
      setUploadError(field, t("tenantPromotions.form.error.uploadFailed"));
    } finally {
      setUploadingField(null);

      const input =
        field === "desktop" ? desktopFileInput.current : mobileFileInput.current;

      if (input) {
        input.value = "";
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!form.categoryId) {
      setError(t("tenantPromotions.form.error.categoryRequired"));
      return;
    }

    if (!form.imageUrl.trim()) {
      setError(t("tenantPromotions.form.error.imageRequired"));
      return;
    }

    setSubmitting(true);

    try {
      const endpoint = isEdit
        ? `/api/tenant/promotions/banners/${banner?.id}`
        : "/api/tenant/promotions/banners";
      const response = await fetch(endpoint, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          categoryId: form.categoryId,
          title: form.title,
          imageUrl: form.imageUrl,
          // 手机图是可选字段：留空 → 服务端存 null → 手机端回落成电脑图的模糊底 + 完整显示
          mobileImageUrl: form.mobileImageUrl.trim(),
          linkUrl: form.linkUrl,
          sortOrder: Number(form.sortOrder) || 0,
          isActive: form.isActive,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        banner?: PromotionBannerView;
        error?: string;
      } | null;

      if (!response.ok || !payload?.banner) {
        setError(payload?.error ?? t("common.networkError"));
        return;
      }

      onSaved(payload.banner, isEdit ? "edit" : "create");
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_120px_-30px_rgba(212,175,55,0.35)] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <p className="text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/60">
              {t("tenantPromotions.eyebrow")}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
              {t(
                isEdit
                  ? "tenantPromotions.form.titleEdit"
                  : "tenantPromotions.form.titleCreate",
              )}
            </h2>
            <p className="mt-1 text-[10px] leading-5 text-neutral-600">
              {t("tenantPromotions.form.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-200 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>
                  {t("tenantPromotions.form.category")}
                </span>
                <select
                  value={form.categoryId}
                  onChange={(event) => patch({ categoryId: event.target.value })}
                  className={inputClass}
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={labelClass}>
                  {t("tenantPromotions.form.sort")}
                </span>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(event) => patch({ sortOrder: event.target.value })}
                  className={inputClass}
                />
              </label>
            </div>

            <label className="block">
              <span className={labelClass}>
                {t("tenantPromotions.form.title")}
              </span>
              <input
                value={form.title}
                onChange={(event) => patch({ title: event.target.value })}
                placeholder={t("tenantPromotions.form.titlePlaceholder")}
                maxLength={80}
                className={inputClass}
              />
            </label>


            {/* ── 电脑端海报（必填）──────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className={labelClass}>
                  {t("tenantPromotions.form.image")}
                </span>
                <button
                  type="button"
                  onClick={() => desktopFileInput.current?.click()}
                  disabled={uploadingField !== null}
                  className="rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-2.5 py-1 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:border-[#d4af37]/50 disabled:opacity-60"
                >
                  {uploadingField === "desktop"
                    ? t("tenantPromotions.form.uploading")
                    : t("tenantPromotions.form.upload")}
                </button>
              </div>

              {/* 防呆 #1：推荐尺寸写在【上传图片】按钮正下方（醒目黄字）。
                  前台舞台高度是锁死的（桌面 400 / 手机 220），宽图才撑得满；
                  但前台已做双层自适应，所以这里只提示、不阻断。 */}
              <p className="mt-2 rounded-lg border border-amber-400/35 bg-amber-400/[0.08] px-2.5 py-2 text-[10px] font-semibold leading-4 text-amber-200">
                {t("tenantPromotions.form.imageSizeHint")}
              </p>

              <input
                ref={desktopFileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void handleUpload(file, "desktop");
                  }
                }}
              />
              <input
                value={form.imageUrl}
                onChange={(event) => patch({ imageUrl: event.target.value })}
                placeholder={t("tenantPromotions.form.imageUrlPlaceholder")}
                className={inputClass}
              />
              {uploadErrors.desktop ? (
                <p className="mt-1.5 text-[10px] text-red-300">
                  {uploadErrors.desktop}
                </p>
              ) : null}

              {imageUrl ? (
                <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                  {/* 后台预览 = 玩家端真实效果：直接用同一份双层渲染组件，
                      商户不必「保存后去前台看」，在这就能看出两侧会不会留模糊边。
                      这里**故意不传 mobileSrc** —— 这块要看的就是电脑端的画面
                      （≥768px 的实际呈现：电脑图完整显示），手机端在下面单独一块预览。 */}
                  <p className="border-b border-white/10 px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] text-neutral-500">
                    {t("tenantPromotions.form.previewDesktop")}
                  </p>
                  <div className="relative h-32 w-full overflow-hidden sm:h-40">
                    <HeroPosterImage
                      src={imageUrl}
                      alt={t("tenantPromotions.form.preview")}
                      eager
                    />
                  </div>
                  <p className="border-t border-white/10 px-2.5 py-1.5 text-[9px] leading-4 text-neutral-500">
                    {t("tenantPromotions.form.previewStage")}
                  </p>
                </div>
              ) : null}

              {/* 防呆 #2：现场比例体检。方图 / 竖图不再「看起来没问题」，
                  直接告诉商户「太方了」并给出推荐尺寸。 */}
              {imageSize && imageVerdict === "wide" ? (
                <p className="mt-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] px-2.5 py-1.5 text-[10px] leading-4 text-emerald-300">
                  {t("tenantPromotions.form.imageRatioOk", {
                    width: imageSize.width,
                    height: imageSize.height,
                    ratio: formatBannerAspectRatio(
                      imageSize.width,
                      imageSize.height,
                    ),
                  })}
                </p>
              ) : null}

              {imageSize && imageVerdict && imageVerdict !== "wide" ? (
                <p className="mt-1.5 rounded-lg border border-red-400/35 bg-red-400/[0.08] px-2.5 py-2 text-[10px] font-semibold leading-4 text-red-300">
                  {t(
                    imageVerdict === "portrait"
                      ? "tenantPromotions.form.imageRatioPortrait"
                      : "tenantPromotions.form.imageRatioSquare",
                    {
                      width: imageSize.width,
                      height: imageSize.height,
                      ratio: formatBannerAspectRatio(
                        imageSize.width,
                        imageSize.height,
                      ),
                    },
                  )}
                </p>
              ) : null}

              {/* 说明：为什么宽图更好（前台怎么处理这张图）。
                  文案已随「双层渲染」更新，不再提「顶部裁剪」—— 现在不裁图。 */}
              <p className="mt-1.5 text-[10px] leading-4 text-neutral-500">
                {t("tenantPromotions.form.imageHint")}
              </p>
            </div>

            {/* ── 手机端海报（可选）────────────────────────────────────────────
                手机舞台只有 220px 高，1920 × 600 的电脑图缩下去字就看不清了，
                所以单独给一格「手机专用图」。不填照样能用：前台会拿电脑图做
                「模糊底 + 完整显示」，一像素都不裁（见 hero-poster-image.tsx）。 */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className={labelClass}>
                  {t("tenantPromotions.form.imageMobile")}
                </span>
                <button
                  type="button"
                  onClick={() => mobileFileInput.current?.click()}
                  disabled={uploadingField !== null}
                  className="rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-2.5 py-1 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:border-[#d4af37]/50 disabled:opacity-60"
                >
                  {uploadingField === "mobile"
                    ? t("tenantPromotions.form.uploading")
                    : t("tenantPromotions.form.upload")}
                </button>
              </div>

              <p className="mt-2 rounded-lg border border-amber-400/35 bg-amber-400/[0.08] px-2.5 py-2 text-[10px] font-semibold leading-4 text-amber-200">
                {t("tenantPromotions.form.mobileImageSizeHint")}
              </p>

              <input
                ref={mobileFileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void handleUpload(file, "mobile");
                  }
                }}
              />
              <input
                value={form.mobileImageUrl}
                onChange={(event) =>
                  patch({ mobileImageUrl: event.target.value })
                }
                placeholder={t(
                  "tenantPromotions.form.mobileImageUrlPlaceholder",
                )}
                className={inputClass}
              />
              {uploadErrors.mobile ? (
                <p className="mt-1.5 text-[10px] text-red-300">
                  {uploadErrors.mobile}
                </p>
              ) : null}

              {mobileImageSize && mobileImageVerdict === "ok" ? (
                <p className="mt-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] px-2.5 py-1.5 text-[10px] leading-4 text-emerald-300">
                  {t("tenantPromotions.form.mobileRatioOk", {
                    width: mobileImageSize.width,
                    height: mobileImageSize.height,
                    ratio: formatBannerAspectRatio(
                      mobileImageSize.width,
                      mobileImageSize.height,
                    ),
                  })}
                </p>
              ) : null}

              {mobileImageSize && mobileImageVerdict === "warn" ? (
                <p className="mt-1.5 rounded-lg border border-amber-400/35 bg-amber-400/[0.08] px-2.5 py-2 text-[10px] font-semibold leading-4 text-amber-200">
                  {t("tenantPromotions.form.mobileRatioWarn", {
                    width: mobileImageSize.width,
                    height: mobileImageSize.height,
                    ratio: formatBannerAspectRatio(
                      mobileImageSize.width,
                      mobileImageSize.height,
                    ),
                  })}
                </p>
              ) : null}

              <p className="mt-1.5 text-[10px] leading-4 text-neutral-500">
                {t("tenantPromotions.form.mobileImageFallback")}
              </p>

              {imageUrl || mobileImageUrl ? (
                <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                  <p className="border-b border-white/10 px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] text-neutral-500">
                    {t("tenantPromotions.form.previewMobile")}
                  </p>
                  {/* 手机端真实画面（≈390 × 200 的圆角卡片，约 2:1）的小窗预览：
                      forceMobile 让它在桌面浏览器里也按手机卡片口径渲染（单层 cover 铺满、
                      重心偏上裁切、没有模糊底）—— 有专用图用专用图，没有就用电脑图。 */}
                  <div className="relative mx-auto my-2 aspect-[39/20] w-full max-w-[280px] overflow-hidden rounded-lg border border-white/10">
                    <HeroPosterImage
                      src={imageUrl || mobileImageUrl}
                      mobileSrc={mobileImageUrl}
                      alt={t("tenantPromotions.form.previewMobile")}
                      eager
                      forceMobile
                    />
                  </div>
                  <p className="border-t border-white/10 px-2.5 py-1.5 text-[9px] leading-4 text-neutral-500">
                    {mobileImageUrl
                      ? t("tenantPromotions.form.previewMobileStage")
                      : t("tenantPromotions.form.previewMobileOff")}
                  </p>
                </div>
              ) : null}
            </div>

            <label className="block">
              <span className={labelClass}>
                {t("tenantPromotions.form.link")}
              </span>
              <input
                value={form.linkUrl}
                onChange={(event) => patch({ linkUrl: event.target.value })}
                placeholder={t("tenantPromotions.form.linkPlaceholder")}
                className={inputClass}
              />
            </label>

            <label className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => patch({ isActive: event.target.checked })}
                className="h-4 w-4 accent-[#d4af37]"
              />
              <span className="text-[11px] text-neutral-300">
                {t("tenantPromotions.form.active")}
              </span>
            </label>

            {error ? (
              <p className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[11px] text-red-300">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[#d4af37]/10 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-10 rounded-xl border border-white/10 px-4 text-xs font-semibold text-neutral-400 transition-colors hover:border-white/20 hover:text-neutral-200 disabled:opacity-60"
            >
              {t("tenantPromotions.form.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || uploadingField !== null}
              className="h-10 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting
                ? t("tenantPromotions.form.saving")
                : t("tenantPromotions.form.save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

