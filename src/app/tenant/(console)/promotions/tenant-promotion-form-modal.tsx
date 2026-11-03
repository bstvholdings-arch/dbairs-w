"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type {
  PromotionBannerView,
  PromotionCategoryView,
} from "@/lib/promotions";

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

const labelClass = "text-[10px] uppercase tracking-[0.16em] text-neutral-600";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type PromotionFormValues = {
  categoryId: string;
  title: string;
  imageUrl: string;
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
 * - 提交永远是「完整对象」：POST 新建 / PATCH 覆盖，避免部分更新把字段清空；
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
  const fileInput = useRef<HTMLInputElement | null>(null);
  const isEdit = Boolean(banner);

  const [form, setForm] = useState<PromotionFormValues>(() =>
    initialValues(banner, categories),
  );
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 弹窗打开时锁定背景滚动，关闭后恢复（与其它后台弹窗一致）
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  function patch(values: Partial<PromotionFormValues>) {
    setForm((current) => ({ ...current, ...values }));
  }

  async function handleUpload(file: File) {
    setUploadError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError(t("tenantPromotions.form.error.fileType"));
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setUploadError(t("tenantPromotions.form.error.fileTooLarge"));
      return;
    }

    setUploading(true);

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
          payload?.error ?? t("tenantPromotions.form.error.uploadFailed"),
        );
        return;
      }

      patch({ imageUrl: payload.url });
    } catch {
      setUploadError(t("tenantPromotions.form.error.uploadFailed"));
    } finally {
      setUploading(false);

      if (fileInput.current) {
        fileInput.current.value = "";
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


            <div>
              <div className="flex items-center justify-between gap-3">
                <span className={labelClass}>
                  {t("tenantPromotions.form.image")}
                </span>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-2.5 py-1 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:border-[#d4af37]/50 disabled:opacity-60"
                >
                  {uploading
                    ? t("tenantPromotions.form.uploading")
                    : t("tenantPromotions.form.upload")}
                </button>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void handleUpload(file);
                  }
                }}
              />
              <input
                value={form.imageUrl}
                onChange={(event) => patch({ imageUrl: event.target.value })}
                placeholder={t("tenantPromotions.form.imageUrlPlaceholder")}
                className={inputClass}
              />
              {uploadError ? (
                <p className="mt-1.5 text-[10px] text-red-300">{uploadError}</p>
              ) : null}

              {form.imageUrl ? (
                <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                  {/* 预览用商户自己的图（外站或本站上传），不走 next/image */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.imageUrl}
                    alt={t("tenantPromotions.form.preview")}
                    className="block max-h-44 w-full object-contain"
                  />
                </div>
              ) : null}

              {/* 比例提示：大厅 Hero 在主视觉里做 object-cover 居中裁剪，
                  21:9 / 16:9 的图在 5 套模板下都只裁掉少量边缘，竖图会被裁得很惨。 */}
              <p className="mt-1.5 text-[10px] leading-4 text-neutral-500">
                {t("tenantPromotions.form.imageHint")}
              </p>
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
              disabled={submitting || uploading}
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

