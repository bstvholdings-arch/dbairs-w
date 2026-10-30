"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatPoint } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n-types";

import type {
  Banner,
  ProviderFormValues,
  ProviderMutationResponse,
  ProviderRow,
  ProviderSyncResponse,
} from "./types";

const POINT_PATTERN = /^(?:0|1)(?:\.\d{1,4})?$/;

function validateForm(form: ProviderFormValues): TranslationKey | "" {
  const name = form.name.trim();
  const upstreamText = form.upstreamPoint.trim();
  const markupText = form.platformMarkup.trim();

  if (!name) {
    return "providers.error.nameRequired";
  }

  if (name.length > 80) {
    return "providers.error.nameTooLong";
  }

  if (!POINT_PATTERN.test(upstreamText)) {
    return "providers.error.upstreamFormat";
  }

  if (!POINT_PATTERN.test(markupText)) {
    return "providers.error.markupFormat";
  }

  const upstream = Number(upstreamText);
  const markup = Number(markupText);

  if (upstream <= 0) {
    return "providers.error.upstreamPositive";
  }

  if (markup >= upstream) {
    return "providers.error.markupLessThanUpstream";
  }

  return "";
}

function ProviderModal({
  mode,
  provider,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  provider?: ProviderRow;
  onClose: () => void;
  onSaved: (provider: ProviderRow) => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ProviderFormValues>({
    name: provider?.name ?? "",
    upstreamPoint: provider ? formatPoint(provider.upstreamPoint) : "0.9400",
    platformMarkup: provider ? formatPoint(provider.platformMarkup) : "0.0200",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, submitting]);

  const previewDownstream =
    POINT_PATTERN.test(form.upstreamPoint.trim()) &&
    POINT_PATTERN.test(form.platformMarkup.trim())
      ? Number(form.upstreamPoint) - Number(form.platformMarkup)
      : Number.NaN;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validation = validateForm(form);

    if (validation) {
      setError(t(validation));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        mode === "create"
          ? "/api/admin/providers"
          : `/api/admin/providers/${provider?.id}`,
        {
          // 新建使用 POST；编辑使用 PATCH（后端同时兼容 PUT）。
          method: mode === "create" ? "POST" : "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            upstreamPoint: form.upstreamPoint.trim(),
            platformMarkup: form.platformMarkup.trim(),
          }),
        },
      );
      const data: ProviderMutationResponse = await response
        .json()
        .catch(() => ({}) as ProviderMutationResponse);

      if (response.status === 401) {
        router.replace("/login?next=/admin/providers");
        return;
      }

      if (!response.ok || !data.success || !data.provider) {
        setError(data.error || t("providers.error.saveFailed"));
        return;
      }

      onSaved(data.provider);
    } catch {
      setError(t("providers.error.network"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label={t("providers.modal.backdropAria")}
        onClick={onClose}
        disabled={submitting}
        className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f0d27c]/80 to-transparent" />
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] uppercase tracking-[0.22em] text-[#d4af37]/60">
                  {t("providers.modal.eyebrow")}
                </p>
                <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
                  {mode === "create"
                    ? t("providers.modal.createTitle")
                    : t("providers.modal.editTitle")}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-white/20 hover:text-neutral-200 disabled:opacity-50"
                aria-label={t("common.close")}
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("providers.modal.name")}
                </span>
                <input
                  ref={nameRef}
                  value={form.name}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  maxLength={80}
                  placeholder={t("providers.modal.namePlaceholder")}
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("providers.modal.upstream")}
                  </span>
                  <input
                    value={form.upstreamPoint}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        upstreamPoint: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder="0.9400"
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                  />
                  <span className="mt-1 block text-[10px] text-neutral-600">
                    {t("providers.modal.upstreamHint")}
                  </span>
                </label>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("providers.modal.markup")}
                  </span>
                  <input
                    value={form.platformMarkup}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        platformMarkup: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder="0.0200"
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                  />
                  <span className="mt-1 block text-[10px] text-neutral-600">
                    {t("providers.modal.markupHint")}
                  </span>
                </label>
              </div>


              <div className="flex items-center justify-between rounded-xl border border-[#d4af37]/10 bg-[#d4af37]/[0.03] px-4 py-3">
                <span className="text-[10px] text-neutral-500">
                  {t("providers.modal.downstream")}
                </span>
                <span className="font-mono text-sm text-[#f0d27c]">
                  {Number.isFinite(previewDownstream) && previewDownstream > 0
                    ? formatPoint(previewDownstream)
                    : "—"}
                </span>
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-[11px] leading-5 text-red-300">
                  <span className="mt-0.5">!</span>
                  <span>{error}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-[#d4af37]/10 bg-[#080808]/80 px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-10 rounded-xl border border-white/[0.08] px-4 text-xs text-neutral-400 transition-colors hover:border-[#d4af37]/20 hover:text-neutral-200 disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ProvidersClient({
  initialProviders,
}: {
  initialProviders: ProviderRow[];
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [providers, setProviders] = useState(initialProviders);
  const [modal, setModal] = useState<{
    mode: "create" | "edit";
    provider?: ProviderRow;
  } | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** 正在同步游戏 / 正在保存排序或上架开关的游戏商 id */
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);

  function handleSaved(saved: ProviderRow) {
    setProviders((current) => {
      const exists = current.some((provider) => provider.id === saved.id);

      if (!exists) {
        return [saved, ...current];
      }

      return current.map((provider) =>
        provider.id === saved.id ? saved : provider,
      );
    });
    setBanner({
      type: "success",
      text:
        modal?.mode === "create"
          ? t("providers.banner.created")
          : t("providers.banner.saved"),
    });
    setModal(null);
    router.refresh();
  }


  async function handleToggleStatus(provider: ProviderRow) {
    const nextStatus = provider.status === "active" ? "suspended" : "active";
    setStatusUpdatingId(provider.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/providers/${provider.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data: ProviderMutationResponse = await response
        .json()
        .catch(() => ({}) as ProviderMutationResponse);

      if (response.status === 401) {
        router.replace("/login?next=/admin/providers");
        return;
      }

      if (!response.ok || !data.success || !data.provider) {
        setBanner({
          type: "error",
          text: data.error || t("providers.error.statusFailed"),
        });
        return;
      }

      setProviders((current) =>
        current.map((row) =>
          row.id === data.provider?.id ? data.provider : row,
        ),
      );
      setBanner({
        type: "success",
        text:
          nextStatus === "active"
            ? t("providers.banner.enabled", { name: provider.name })
            : t("providers.banner.disabled", { name: provider.name }),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("providers.error.statusNetwork") });
    } finally {
      setStatusUpdatingId(null);
    }
  }

  /** 统一的 PATCH 封装：排序 / 上架开关共用，失败时把错误写进 banner。 */
  async function patchProvider(
    provider: ProviderRow,
    body: Record<string, unknown>,
  ): Promise<ProviderRow | null> {
    const response = await fetch(`/api/admin/providers/${provider.id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: ProviderMutationResponse = await response
      .json()
      .catch(() => ({}) as ProviderMutationResponse);

    if (response.status === 401) {
      router.replace("/login?next=/admin/providers");
      return null;
    }

    if (!response.ok || !data.success || !data.provider) {
      setBanner({
        type: "error",
        text: data.error || t("providers.error.statusFailed"),
      });
      return null;
    }

    setProviders((current) =>
      current.map((row) => (row.id === data.provider?.id ? data.provider : row)),
    );
    router.refresh();

    return data.provider;
  }

  /** 上架 / 下架：只控制大厅展示，不影响历史注单结算。 */
  async function handleToggleActive(provider: ProviderRow) {
    const nextActive = !provider.isActive;
    setSavingFieldId(provider.id);
    setBanner(null);

    try {
      const saved = await patchProvider(provider, { isActive: nextActive });

      if (saved) {
        setBanner({
          type: "success",
          text: nextActive
            ? t("providers.banner.listed", { name: provider.name })
            : t("providers.banner.unlisted", { name: provider.name }),
        });
      }
    } catch {
      setBanner({ type: "error", text: t("providers.error.statusNetwork") });
    } finally {
      setSavingFieldId(null);
    }
  }

  /** 排序权重：失焦或回车时提交，值非法时回滚输入框。 */
  async function handleSortOrderCommit(
    provider: ProviderRow,
    input: HTMLInputElement,
  ) {
    const nextOrder = Number(input.value);

    if (
      !Number.isInteger(nextOrder) ||
      nextOrder < 0 ||
      nextOrder > 999999
    ) {
      input.value = String(provider.sortOrder);
      setBanner({ type: "error", text: t("providers.error.orderInvalid") });
      return;
    }

    if (nextOrder === provider.sortOrder) {
      return;
    }

    setSavingFieldId(provider.id);
    setBanner(null);

    try {
      const saved = await patchProvider(provider, { sortOrder: nextOrder });

      if (saved) {
        setBanner({
          type: "success",
          text: t("providers.banner.orderSaved", {
            name: provider.name,
            order: saved.sortOrder,
          }),
        });
      } else {
        input.value = String(provider.sortOrder);
      }
    } catch {
      input.value = String(provider.sortOrder);
      setBanner({ type: "error", text: t("providers.error.statusNetwork") });
    } finally {
      setSavingFieldId(null);
    }
  }

  /** 从游戏商同步游戏列表到 Game 表（当前为 Mock 数据源）。 */
  async function handleSync(provider: ProviderRow) {
    setSyncingId(provider.id);
    setBanner(null);

    try {
      const response = await fetch("/api/admin/games/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as ProviderSyncResponse;

      if (response.status === 401) {
        router.replace("/login?next=/admin/providers");
        return;
      }

      if (!response.ok || !data.success || !data.result) {
        setBanner({
          type: "error",
          text: data.error || t("providers.error.syncFailed"),
        });
        return;
      }

      setBanner({
        type: "success",
        text: t("providers.banner.synced", {
          name: provider.name,
          created: data.result.created,
          updated: data.result.updated,
        }),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("providers.error.syncNetwork") });
    } finally {
      setSyncingId(null);
    }
  }

  async function handleDelete(provider: ProviderRow) {
    // 有历史注单时不能硬删除，否则会破坏历史结算快照；给出明确提示，
    // 而不是让按钮静默禁用导致“点了没反应”。
    if (provider.betRecordCount > 0) {
      setBanner({
        type: "error",
        text: t("providers.error.hasBets", {
          name: provider.name,
          count: provider.betRecordCount,
        }),
      });
      return;
    }

    const confirmed = window.confirm(
      t("providers.confirm.delete", { name: provider.name }),
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(provider.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/providers/${provider.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (response.status === 401) {
        router.replace("/login?next=/admin/providers");
        return;
      }

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("providers.error.deleteFailed"),
        });
        return;
      }

      setProviders((current) =>
        current.filter((row) => row.id !== provider.id),
      );
      setBanner({
        type: "success",
        text: t("providers.banner.deleted", { name: provider.name }),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("providers.error.deleteNetwork") });
    } finally {
      setDeletingId(null);
    }
  }


  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("providers.header.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("providers.header.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            {t("providers.header.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 sm:self-auto"
        >
          <span className="text-base leading-none">+</span>
          {t("providers.actions.create")}
        </button>
      </header>

      {banner ? (
        <div
          role="status"
          className={`mt-5 rounded-xl border px-4 py-3 text-[11px] leading-5 ${
            banner.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-red-400/20 bg-red-400/[0.06] text-red-300"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left">
            <thead>
              <tr className="border-b border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3.5 font-medium">
                  {t("providers.table.provider")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("providers.table.upstream")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("providers.table.markup")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("providers.table.downstream")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("providers.table.status")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("providers.table.games")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("providers.table.storefront")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("providers.table.overrides")}
                </th>
                <th className="px-5 py-3.5 text-right font-medium">
                  {t("providers.table.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-5 py-12 text-center text-xs text-neutral-600"
                  >
                    {t("providers.table.empty")}
                  </td>
                </tr>
              ) : (
                providers.map((provider) => {
                  const statusUpdating = statusUpdatingId === provider.id;
                  const deleting = deletingId === provider.id;
                  const syncing = syncingId === provider.id;
                  const savingField = savingFieldId === provider.id;
                  const locked =
                    statusUpdating || deleting || syncing || savingField;

                  return (
                    <tr
                      key={provider.id}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"
                    >

                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-neutral-200">
                          {provider.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                          {provider.id.slice(0, 8)} ·{" "}
                          {t("providers.row.betCount", {
                            count: provider.betRecordCount,
                          })}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-neutral-300">
                        {formatPoint(provider.upstreamPoint)}
                        <p className="mt-0.5 text-[9px] text-neutral-600">
                          {t("providers.row.providerShare", {
                            percent: (
                              100 -
                              Number(provider.upstreamPoint) * 100
                            ).toFixed(2),
                          })}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-neutral-300">
                        {formatPoint(provider.platformMarkup)}
                        <p className="mt-0.5 text-[9px] text-neutral-600">
                          {t("providers.row.platformShare", {
                            percent: (
                              Number(provider.platformMarkup) * 100
                            ).toFixed(2),
                          })}
                        </p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-2.5 py-1 font-mono text-xs text-[#f0d27c]">
                          {formatPoint(provider.downstreamPoint)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          onClick={() => void handleToggleStatus(provider)}
                          disabled={locked}
                          title={t("providers.row.toggleTitle")}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            provider.status === "active"
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300 hover:border-emerald-400/40"
                              : "border-red-400/20 bg-red-400/10 text-red-300 hover:border-red-400/40"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {provider.status === "active"
                            ? t("providers.row.disable")
                            : t("providers.row.enable")}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="font-mono text-xs text-neutral-300">
                          {provider.gameCount}
                        </p>
                        <Link
                          href={`/admin/games?providerId=${provider.id}`}
                          className="mt-0.5 inline-block text-[9px] text-[#d4af37]/80 underline-offset-2 hover:text-[#f0d27c] hover:underline"
                        >
                          {t("providers.row.manageGames")}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col items-start gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(provider)}
                            disabled={locked}
                            title={t("providers.row.activeTitle")}
                            className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              provider.isActive
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300 hover:border-emerald-400/40"
                                : "border-white/10 bg-white/[0.03] text-neutral-500 hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
                            }`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {provider.isActive
                              ? t("providers.row.listed")
                              : t("providers.row.unlisted")}
                          </button>
                          <label className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-neutral-600">
                            {t("providers.row.sortOrder")}
                            <input
                              type="number"
                              min={0}
                              max={999999}
                              defaultValue={provider.sortOrder}
                              disabled={locked}
                              onBlur={(event) =>
                                void handleSortOrderCommit(
                                  provider,
                                  event.currentTarget,
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                              aria-label={t("providers.row.sortOrderAria", {
                                name: provider.name,
                              })}
                              className="h-7 w-16 rounded-md border border-white/10 bg-black/40 px-2 text-center font-mono text-[11px] text-neutral-200 focus:border-[#d4af37]/40 focus:outline-none disabled:opacity-50"
                            />
                          </label>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">
                        {provider.tenantOverrideCount}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSync(provider)}
                            disabled={locked}
                            title={t("providers.row.syncTitle")}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M20 12a8 8 0 1 1-2.3-5.6" />
                              <path d="M20 4v4h-4" />
                            </svg>
                            {syncing
                              ? t("providers.row.syncing")
                              : t("providers.row.sync")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setModal({ mode: "edit", provider })
                            }
                            disabled={locked}
                            className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 disabled:opacity-50"
                          >
                            {t("common.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(provider)}
                            disabled={locked}
                            title={
                              provider.betRecordCount > 0
                                ? t("providers.row.deleteLocked", {
                                    count: provider.betRecordCount,
                                  })
                                : t("providers.row.deleteTitle")
                            }
                            aria-disabled={provider.betRecordCount > 0}
                            className="inline-flex h-8 items-center rounded-lg border border-red-400/20 px-3 text-[10px] text-red-300 transition-colors hover:border-red-400/40 hover:bg-red-400/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {deleting
                              ? t("common.deleting")
                              : t("common.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d4af37]/10 px-5 py-3 text-[10px] text-neutral-600">
          <span>
            {t("providers.footer.count", { count: providers.length })}
          </span>
          <span>{t("providers.footer.deleteNote")}</span>
        </div>
      </section>

      {modal ? (
        <ProviderModal
          mode={modal.mode}
          provider={modal.provider}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

