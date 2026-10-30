"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { ProviderBrandMark } from "@/components/lobby/provider-brand";
import { moveShowcaseProvider, withShowcaseSortOrder } from "@/lib/provider-showcase";

import type { ProviderReorderResponse, StorefrontProviderRow } from "./types";
import { ArrowIcon, SectionTitle } from "./ui";

/** 用于判断「商标网格有没有未保存改动」的指纹：顺序 + 开关都算 */
function signature(rows: StorefrontProviderRow[]) {
  return rows.map((row) => `${row.id}:${row.showInShowcase ? 1 : 0}`).join("|");
}

/**
 * 【游戏商商标网格 (Provider Showcase)】编排面板。
 *
 * - 每张卡片：Logo（按名称稳定推导）+ 名称 + 游戏数 + 显示开关 + 上移 / 下移；
 * - 点【保存商标排列】后调用 PATCH /api/admin/providers/reorder，
 *   一次写入全部 GameProvider.sortOrder / showInShowcase（全局配置，对所有租户前台生效）；
 * - 保存成功会回调 onSaved()，让右侧真实前台 iframe 立即重载，看到新的品牌墙顺序。
 */
export function ProviderShowcasePanel({
  initialProviders,
  onSaved,
}: {
  initialProviders: StorefrontProviderRow[];
  /** 保存成功后通知外层刷新大厅预览 */
  onSaved?: () => void;
}) {
  const { t } = useLanguage();

  const [providers, setProviders] = useState(initialProviders);
  const [baseline, setBaseline] = useState(() => signature(initialProviders));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");

  const dirty = useMemo(() => signature(providers) !== baseline, [baseline, providers]);
  const shownCount = providers.filter((provider) => provider.showInShowcase).length;

  function toggleProvider(id: string) {
    setProviders((current) =>
      current.map((provider) =>
        provider.id === id
          ? { ...provider, showInShowcase: !provider.showInShowcase }
          : provider,
      ),
    );
  }

  function moveProvider(id: string, direction: -1 | 1) {
    setProviders((current) => moveShowcaseProvider(current, id, direction));
  }

  const save = useCallback(async () => {
    setSaving(true);
    setError("");

    try {
      // 按当前列表顺序倒排 sortOrder：第一张最大，前台 orderBy desc 读出来顺序一致
      const ordered = withShowcaseSortOrder(providers);
      const response = await fetch("/api/admin/providers/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: ordered.map((row) => ({
            id: row.id,
            sortOrder: row.sortOrder,
            showInShowcase: row.showInShowcase,
          })),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | ProviderReorderResponse
        | null;

      if (!response.ok || !payload?.providers) {
        setError(payload?.error ?? t("storefront.providers.saveError"));
        return;
      }

      // 以数据库返回的顺序 / 开关为准重建列表（本地其它字段保留原值）
      const local = new Map(providers.map((row) => [row.id, row]));
      const saved = payload.providers
        .map((row) => {
          const current = local.get(row.id);

          return current
            ? {
                ...current,
                name: row.name,
                sortOrder: row.sortOrder,
                showInShowcase: row.showInShowcase,
              }
            : null;
        })
        .filter((row): row is StorefrontProviderRow => row !== null);
      const returnedIds = new Set(saved.map((row) => row.id));
      const merged = [...saved, ...providers.filter((row) => !returnedIds.has(row.id))];

      setProviders(merged);
      setBaseline(signature(merged));
      setSavedAt(
        new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      onSaved?.();
    } catch {
      setError(t("storefront.providers.saveError"));
    } finally {
      setSaving(false);
    }
  }, [onSaved, providers, t]);

  return (
    <section
      data-provider-showcase
      className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SectionTitle
          title={t("storefront.providers.title")}
          hint={t("storefront.providers.hint")}
        />

        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300">
              {t("storefront.providers.unsaved")}
            </span>
          ) : savedAt ? (
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
              {t("storefront.providers.savedAt", { time: savedAt })}
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-1.5 text-[10px] text-neutral-500">
        <span>{t("storefront.providers.scope")}</span>
        <span aria-hidden="true" className="text-neutral-700">
          ·
        </span>
        <span className="font-semibold text-brand-soft/90">
          {t("storefront.providers.count", {
            shown: shownCount,
            total: providers.length,
          })}
        </span>
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300"
        >
          {error}
        </div>
      ) : null}

      {providers.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center">
          <p className="text-[11px] text-neutral-400">{t("storefront.providers.empty")}</p>
          <Link
            href="/admin/providers"
            className="mt-3 inline-flex h-8 items-center rounded-lg border border-brand/30 px-3 text-[10px] font-semibold text-brand-soft transition-colors hover:bg-brand/10"
          >
            {t("storefront.providers.emptyAction")}
          </Link>
        </div>
      ) : (
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider, index) => (
            <li
              key={provider.id}
              data-provider-row={provider.name}
              data-provider-shown={provider.showInShowcase ? "1" : "0"}
              className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors ${
                provider.showInShowcase
                  ? "border-brand/20 bg-brand/[0.05]"
                  : "border-white/[0.06] bg-white/[0.01]"
              }`}
            >
              <span className="w-4 shrink-0 text-center font-mono text-[10px] text-neutral-600">
                {index + 1}
              </span>
              <ProviderBrandMark name={provider.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-[11px] font-semibold ${
                    provider.showInShowcase ? "text-neutral-200" : "text-neutral-500"
                  }`}
                >
                  {provider.name}
                </p>
                <p className="truncate text-[10px] text-neutral-500">
                  {t("storefront.providers.games", { count: provider.gameCount })}
                  {provider.isActive ? null : (
                    <span className="ml-1 text-rose-300/80">
                      · {t("storefront.providers.inactive")}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveProvider(provider.id, -1)}
                  disabled={index === 0}
                  aria-label={`${t("storefront.order.up")} ${provider.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] text-neutral-400 transition-colors hover:border-brand/40 hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
                >
                  <ArrowIcon direction="up" />
                </button>
                <button
                  type="button"
                  onClick={() => moveProvider(provider.id, 1)}
                  disabled={index === providers.length - 1}
                  aria-label={`${t("storefront.order.down")} ${provider.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] text-neutral-400 transition-colors hover:border-brand/40 hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
                >
                  <ArrowIcon direction="down" />
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={provider.showInShowcase}
                  aria-label={`${
                    provider.showInShowcase
                      ? t("storefront.providers.toggleHide")
                      : t("storefront.providers.toggleShow")
                  } ${provider.name}`}
                  onClick={() => toggleProvider(provider.id)}
                  className={`relative ml-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 ${
                    provider.showInShowcase
                      ? "border-brand/50 bg-brand/70"
                      : "border-white/15 bg-white/[0.06]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
                      provider.showInShowcase
                        ? "left-[18px] bg-brand-ink"
                        : "left-0.5 bg-neutral-400"
                    }`}
                  />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <p className="text-[10px] leading-relaxed text-neutral-600">
          {t("storefront.providers.saveHint")}
        </p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || providers.length === 0}
          className="h-9 rounded-lg bg-gradient-to-r from-brand-soft via-brand to-brand-deep px-4 text-[11px] font-bold text-brand-ink shadow-[0_10px_26px_-12px_var(--sf-a85)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
        >
          {saving ? t("storefront.providers.saving") : t("storefront.providers.save")}
        </button>
      </div>
    </section>
  );
}

