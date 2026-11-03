"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type {
  PromotionBannerView,
  PromotionCategoryView,
  PromotionFeed,
} from "@/lib/promotions";

import { TenantPromotionFormModal } from "./tenant-promotion-form-modal";

type CategoryDraft = { name: string; sortOrder: string };

function sortCategories(categories: PromotionCategoryView[]) {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
}

function upsertBanner(
  banners: PromotionBannerView[],
  next: PromotionBannerView,
) {
  const exists = banners.some((banner) => banner.id === next.id);

  if (!exists) {
    return [next, ...banners];
  }

  return banners.map((banner) => (banner.id === next.id ? next : banner));
}

/**
 * 商户后台【活动管理】。
 *
 * 左侧是分类（新增 / 改名 / 排序 / 删除，删除会连带删掉该分类下的活动），
 * 右侧是活动 Banner（上传图片、填跳转链接、启停、删除）。
 *
 * 数据流：首次数据由 Server Component 注入（initialData），
 * 之后每次写操作都用接口返回的对象就地更新，再 router.refresh()
 * 让顶部统计与分类计数跟服务端保持一致。
 */
export function TenantPromotionsClient({
  initialData,
  tenantName,
}: {
  initialData: PromotionFeed;
  tenantName: string;
}) {
  const router = useRouter();
  const { t } = useLanguage();

  const [data, setData] = useState<PromotionFeed>(initialData);
  const [modal, setModal] = useState<
    { mode: "create" } | { mode: "edit"; banner: PromotionBannerView } | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, CategoryDraft>>({});

  const categories = data.categories;
  const banners = data.banners;
  const activeCount = banners.filter((banner) => banner.isActive).length;

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();

    for (const category of categories) {
      map.set(category.id, category.name);
    }

    return map;
  }, [categories]);

  function draftOf(category: PromotionCategoryView): CategoryDraft {
    return (
      drafts[category.id] ?? {
        name: category.name,
        sortOrder: String(category.sortOrder),
      }
    );
  }

  function updateDraft(
    category: PromotionCategoryView,
    patch: Partial<CategoryDraft>,
  ) {
    setDrafts((current) => ({
      ...current,
      [category.id]: { ...draftOf(category), ...patch },
    }));
  }

  function clearDraft(id: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const name = newName.trim();

    if (!name) {
      return;
    }

    setCreating(true);

    try {
      const response = await fetch("/api/tenant/promotions/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ name, sortOrder: categories.length }),
      });
      const payload = (await response.json().catch(() => null)) as {
        category?: PromotionCategoryView;
        error?: string;
      } | null;

      if (!response.ok || !payload?.category) {
        setNotice({
          type: "error",
          text: payload?.error ?? t("common.networkError"),
        });
        return;
      }

      const created = payload.category;

      setData((current) => ({
        ...current,
        categories: sortCategories([...current.categories, created]),
      }));
      setNewName("");
      setNotice({ type: "success", text: t("tenantPromotions.category.created") });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: t("common.networkError") });
    } finally {
      setCreating(false);
    }
  }

  async function saveCategory(category: PromotionCategoryView) {
    const draft = drafts[category.id];

    if (!draft) {
      return;
    }

    setNotice(null);
    setBusyId(category.id);

    try {
      const response = await fetch(
        `/api/tenant/promotions/categories/${category.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({
            name: draft.name,
            sortOrder: Number(draft.sortOrder) || 0,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        category?: { id: string; name: string; sortOrder: number };
        error?: string;
      } | null;

      if (!response.ok || !payload?.category) {
        setNotice({
          type: "error",
          text: payload?.error ?? t("common.networkError"),
        });
        return;
      }

      const saved = payload.category;

      setData((current) => ({
        ...current,
        categories: sortCategories(
          current.categories.map((item) =>
            item.id === saved.id
              ? { ...item, name: saved.name, sortOrder: saved.sortOrder }
              : item,
          ),
        ),
      }));
      clearDraft(category.id);
      setNotice({ type: "success", text: t("tenantPromotions.category.saved") });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: t("common.networkError") });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCategory(category: PromotionCategoryView) {
    const confirmed = window.confirm(
      t("tenantPromotions.category.deleteConfirm", {
        count: category.bannerCount,
      }),
    );

    if (!confirmed) {
      return;
    }

    setNotice(null);
    setBusyId(category.id);

    try {
      const response = await fetch(
        `/api/tenant/promotions/categories/${category.id}`,
        {
          method: "DELETE",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setNotice({
          type: "error",
          text: payload?.error ?? t("common.networkError"),
        });
        return;
      }

      setData((current) => ({
        ...current,
        categories: current.categories.filter(
          (item) => item.id !== category.id,
        ),
        banners: current.banners.filter(
          (banner) => banner.categoryId !== category.id,
        ),
      }));
      clearDraft(category.id);
      setNotice({ type: "success", text: t("tenantPromotions.category.deleted") });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: t("common.networkError") });
    } finally {
      setBusyId(null);
    }
  }


  async function toggleBanner(banner: PromotionBannerView) {
    setNotice(null);
    setBusyId(banner.id);

    try {
      const response = await fetch(
        `/api/tenant/promotions/banners/${banner.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({
            categoryId: banner.categoryId,
            title: banner.title,
            imageUrl: banner.imageUrl,
            linkUrl: banner.linkUrl,
            sortOrder: banner.sortOrder,
            isActive: !banner.isActive,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        banner?: PromotionBannerView;
        error?: string;
      } | null;

      if (!response.ok || !payload?.banner) {
        setNotice({
          type: "error",
          text: payload?.error ?? t("common.networkError"),
        });
        return;
      }

      const saved = payload.banner;

      setData((current) => ({
        ...current,
        banners: upsertBanner(current.banners, saved),
      }));
      setNotice({
        type: "success",
        text: saved.isActive
          ? t("tenantPromotions.banner.enabled")
          : t("tenantPromotions.banner.disabledNotice"),
      });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: t("common.networkError") });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBanner(banner: PromotionBannerView) {
    const confirmed = window.confirm(
      t("tenantPromotions.banner.deleteConfirm", {
        title: banner.title?.trim() || t("tenantPromotions.banner.noTitle"),
      }),
    );

    if (!confirmed) {
      return;
    }

    setNotice(null);
    setBusyId(banner.id);

    try {
      const response = await fetch(
        `/api/tenant/promotions/banners/${banner.id}`,
        { method: "DELETE", credentials: "same-origin", cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setNotice({
          type: "error",
          text: payload?.error ?? t("common.networkError"),
        });
        return;
      }

      setData((current) => ({
        ...current,
        banners: current.banners.filter((item) => item.id !== banner.id),
      }));
      setNotice({ type: "success", text: t("tenantPromotions.banner.deleted") });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: t("common.networkError") });
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(saved: PromotionBannerView, mode: "create" | "edit") {
    setData((current) => ({
      ...current,
      banners: upsertBanner(current.banners, saved),
    }));
    setModal(null);
    setNotice({
      type: "success",
      text: t(
        mode === "create"
          ? "tenantPromotions.banner.created"
          : "tenantPromotions.banner.saved",
      ),
    });
    router.refresh();
  }


  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("tenantPromotions.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("tenantPromotions.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
            {t("tenantPromotions.subtitle", { tenant: tenantName })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          disabled={categories.length === 0}
          title={
            categories.length === 0
              ? t("tenantPromotions.banner.needCategory")
              : undefined
          }
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          <span className="text-base leading-none">+</span>
          {t("tenantPromotions.banner.create")}
        </button>
      </header>

      {notice ? (
        <div
          className={`mt-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            notice.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-red-400/20 bg-red-400/[0.06] text-red-300"
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-current opacity-60 hover:opacity-100"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: t("tenantPromotions.cards.categories"),
            value: String(categories.length),
            hint: t("tenantPromotions.cards.categoriesHint"),
          },
          {
            label: t("tenantPromotions.cards.total"),
            value: String(banners.length),
            hint: t("tenantPromotions.cards.totalHint"),
          },
          {
            label: t("tenantPromotions.cards.active"),
            value: String(activeCount),
            hint: t("tenantPromotions.cards.activeHint"),
          },
          {
            label: t("tenantPromotions.cards.inactive"),
            value: String(banners.length - activeCount),
            hint: t("tenantPromotions.cards.inactiveHint"),
          },
        ].map((card) => (
          <article
            key={card.label}
            className="relative overflow-hidden rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] via-[#0b0b0b] to-[#080808] p-5"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />
            <p className="text-[9px] uppercase tracking-[0.2em] text-neutral-600">
              {card.label}
            </p>
            <p className="mt-2.5 font-mono text-2xl font-semibold text-[#f0d27c]">
              {card.value}
            </p>
            <p className="mt-1.5 text-[10px] leading-5 text-neutral-600">
              {card.hint}
            </p>
          </article>
        ))}
      </section>


      <div className="mt-5 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* 分类管理 */}
        <section className="h-fit rounded-2xl border border-[#d4af37]/15 bg-[#0a0a0a]/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">
              {t("tenantPromotions.category.section")}
            </h2>
            <span className="font-mono text-[10px] text-neutral-600">
              {categories.length}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-5 text-neutral-600">
            {t("tenantPromotions.category.sectionHint")}
          </p>

          <form onSubmit={createCategory} className="mt-3 flex gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t("tenantPromotions.category.placeholder")}
              maxLength={24}
              className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-neutral-200 outline-none placeholder:text-neutral-700 focus:border-[#d4af37]/50"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="h-9 shrink-0 rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 text-[11px] font-semibold text-[#f0d27c] transition-colors hover:border-[#d4af37]/60 disabled:opacity-50"
            >
              {creating
                ? t("tenantPromotions.category.adding")
                : t("tenantPromotions.category.add")}
            </button>
          </form>

          {categories.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[11px] leading-5 text-neutral-600">
              {t("tenantPromotions.category.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {categories.map((category) => {
                const draft = draftOf(category);
                const dirty =
                  draft.name !== category.name ||
                  draft.sortOrder !== String(category.sortOrder);
                const busy = busyId === category.id;

                return (
                  <li
                    key={category.id}
                    className="rounded-xl border border-white/[0.07] bg-black/30 p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={draft.name}
                        onChange={(event) =>
                          updateDraft(category, { name: event.target.value })
                        }
                        maxLength={24}
                        aria-label={t("tenantPromotions.category.nameLabel")}
                        className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/50 px-2.5 text-xs text-neutral-100 outline-none focus:border-[#d4af37]/50"
                      />
                      <input
                        value={draft.sortOrder}
                        onChange={(event) =>
                          updateDraft(category, {
                            sortOrder: event.target.value,
                          })
                        }
                        type="number"
                        aria-label={t("tenantPromotions.category.sortLabel")}
                        className="h-8 w-14 shrink-0 rounded-lg border border-white/10 bg-black/50 px-2 text-center font-mono text-xs text-neutral-200 outline-none focus:border-[#d4af37]/50"
                      />
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[9px] text-neutral-600">
                        {t("tenantPromotions.category.bannerCount", {
                          count: category.bannerCount,
                          active: category.activeBannerCount,
                        })}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void saveCategory(category)}
                          disabled={!dirty || busy}
                          className="rounded-md border border-[#d4af37]/25 px-2 py-1 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:border-[#d4af37]/50 disabled:opacity-40"
                        >
                          {t("tenantPromotions.category.save")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteCategory(category)}
                          disabled={busy}
                          className="rounded-md border border-red-400/20 px-2 py-1 text-[10px] font-semibold text-red-300 transition-colors hover:border-red-400/50 disabled:opacity-40"
                        >
                          {t("tenantPromotions.category.delete")}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>


        {/* 活动列表 */}
        <section className="rounded-2xl border border-[#d4af37]/15 bg-[#0a0a0a]/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">
                {t("tenantPromotions.banner.section")}
              </h2>
              <p className="mt-1 text-[10px] leading-5 text-neutral-600">
                {t("tenantPromotions.banner.sectionHint")}
              </p>
            </div>
            <span className="font-mono text-[10px] text-neutral-600">
              {banners.length}
            </span>
          </div>

          {banners.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-10 text-center text-[11px] leading-5 text-neutral-600">
              {categories.length === 0
                ? t("tenantPromotions.banner.emptyNoCategory")
                : t("tenantPromotions.banner.empty")}
            </p>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {banners.map((banner) => {
                const busy = busyId === banner.id;
                const categoryName =
                  categoryNameById.get(banner.categoryId) ??
                  t("tenantPromotions.banner.unknownCategory");

                return (
                  <li
                    key={banner.id}
                    className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/30"
                  >
                    <div className="relative aspect-[16/7] w-full overflow-hidden bg-black/50">
                      {/* 活动图可能是外站地址，next/image 的域名白名单管不住 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={banner.imageUrl}
                        alt={
                          banner.title?.trim() ||
                          t("tenantPromotions.banner.noTitle")
                        }
                        className="h-full w-full object-cover"
                      />
                      <span
                        className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                          banner.isActive
                            ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-300"
                            : "border-white/15 bg-black/70 text-neutral-400"
                        }`}
                      >
                        {banner.isActive
                          ? t("tenantPromotions.banner.enabled")
                          : t("tenantPromotions.banner.disabled")}
                      </span>
                      <span className="absolute right-2 top-2 rounded-full border border-[#d4af37]/25 bg-black/70 px-2 py-0.5 font-mono text-[9px] text-[#f0d27c]">
                        #{banner.sortOrder}
                      </span>
                    </div>

                    <div className="p-3">
                      <p className="truncate text-xs font-semibold text-neutral-100">
                        {banner.title?.trim() ||
                          t("tenantPromotions.banner.noTitle")}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-neutral-600">
                        {categoryName}
                        {banner.linkUrl ? (
                          <>
                            <span className="mx-1.5 text-neutral-700">·</span>
                            <span className="text-neutral-500">
                              {banner.linkUrl}
                            </span>
                          </>
                        ) : null}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setModal({ mode: "edit", banner })
                          }
                          disabled={busy}
                          className="rounded-md border border-[#d4af37]/25 px-2 py-1 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:border-[#d4af37]/50 disabled:opacity-40"
                        >
                          {t("tenantPromotions.banner.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleBanner(banner)}
                          disabled={busy}
                          className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold text-neutral-300 transition-colors hover:border-white/25 disabled:opacity-40"
                        >
                          {banner.isActive
                            ? t("tenantPromotions.banner.disable")
                            : t("tenantPromotions.banner.enable")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteBanner(banner)}
                          disabled={busy}
                          className="rounded-md border border-red-400/20 px-2 py-1 text-[10px] font-semibold text-red-300 transition-colors hover:border-red-400/50 disabled:opacity-40"
                        >
                          {t("tenantPromotions.banner.delete")}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {modal ? (
        <TenantPromotionFormModal
          banner={modal.mode === "edit" ? modal.banner : null}
          categories={categories}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

