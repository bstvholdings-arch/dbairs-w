"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatPercent, formatPoint, toNumber } from "@/lib/format";

import type {
  TenantPointMutationResponse,
  TenantProviderPointRow,
} from "./types";

/**
 * 租户 × 游戏商专属点数表格。
 * 点击行内金色 Edit 打开黑金弹窗，保存成功后整页刷新，保证数字与后端一致。
 */
export function TenantPointsEditor({
  tenantId,
  initialRows,
}: {
  tenantId: string;
  initialRows: TenantProviderPointRow[];
}) {
  const { t } = useLanguage();
  const router = useRouter();

  // ==== 弹窗状态：表格按钮负责 currentProvider + isModalOpen ====
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentProvider, setCurrentProvider] =
    useState<TenantProviderPointRow | null>(null);

  const [customPoint, setCustomPoint] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  /** 点击表格里的金色 Edit：把当前行交给 currentProvider，再打开弹窗。 */
  function openEditModal(row: TenantProviderPointRow) {
    setCurrentProvider(row);
    setCustomPoint(row.customPoint ?? "");
    setError("");
    setSaving(false);
    setIsModalOpen(true);
  }

  function closeEditModal() {
    if (saving) {
      return;
    }

    setIsModalOpen(false);
    setCurrentProvider(null);
    setError("");
  }

  // Esc 关闭 + 锁背景滚动，避免弹窗打开时页面还能滚动。
  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsModalOpen(false);
        setCurrentProvider(null);
        setError("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isModalOpen]);

  // 打开弹窗后把焦点放进输入框并全选，方便直接覆盖旧值。
  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    const element = inputRef.current;

    if (!element) {
      return;
    }

    element.focus();
    element.select();
  }, [isModalOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentProvider) {
      return;
    }

    const text = customPoint.trim();

    // 留空 = 删除覆盖记录，回退全局默认点数。
    if (text === "") {
      await savePoint(null);
      return;
    }

    if (!/^\d(\.\d{1,4})?$|^\.\d{1,4}$/.test(text)) {
      setError(t("tenantPoints.error.format"));
      return;
    }

    const value = Number(text);

    if (!Number.isFinite(value) || value <= 0) {
      setError(t("tenantPoints.error.positive"));
      return;
    }

    if (value > 1) {
      setError(t("tenantPoints.error.format"));
      return;
    }

    const upstream = toNumber(currentProvider.upstreamPoint);

    if (upstream > 0 && value > upstream) {
      setError(
        t("tenantPoints.error.aboveUpstream", {
          value: formatPoint(currentProvider.upstreamPoint),
        }),
      );
      return;
    }

    await savePoint(text);
  }

  async function savePoint(value: string | null) {
    if (!currentProvider) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/providers/${currentProvider.providerId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customPoint: value }),
        },
      );

      const data: TenantPointMutationResponse = await response
        .json()
        .catch(() => ({}) as TenantPointMutationResponse);

      if (response.status === 401) {
        router.replace(`/login?next=/admin/tenants/${tenantId}`);
        return;
      }

      if (!response.ok || data.success === false) {
        setError(data.error || t("tenantPoints.error.saveFailed"));
        setSaving(false);
        return;
      }

      alert("Saved!");
      window.location.reload();
    } catch {
      setError(t("tenantPoints.error.network"));
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className="border-b border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
              <th className="px-5 py-3.5 font-medium">
                {t("tenantPoints.table.provider")}
              </th>
              <th className="px-5 py-3.5 font-medium">
                {t("tenantPoints.table.upstream")}
              </th>
              <th className="px-5 py-3.5 font-medium">
                {t("tenantPoints.table.markup")}
              </th>
              <th className="px-5 py-3.5 font-medium">
                {t("tenantPoints.table.global")}
              </th>
              <th className="px-5 py-3.5 font-medium">
                {t("tenantPoints.table.custom")}
              </th>
              <th className="px-5 py-3.5 font-medium">
                {t("tenantPoints.table.effective")}
              </th>
              <th className="px-5 py-3.5 text-right font-medium">
                {t("tenantPoints.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((row) => (
              <tr
                key={row.providerId}
                className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.02]"
              >
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-200">
                      {row.providerName}
                    </span>
                    {row.providerStatus === "active" ? null : (
                      <span className="rounded-full border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-red-300">
                        {row.providerStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-neutral-600">
                    {t("tenantPoints.row.providerShare", {
                      percent: formatPercent(row.upstreamPoint),
                    })}
                  </p>
                </td>
                <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">
                  {formatPoint(row.upstreamPoint)}
                </td>
                <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">
                  {formatPoint(row.platformMarkup)}
                </td>
                <td className="px-5 py-3.5 font-mono text-xs text-neutral-500">
                  {formatPoint(row.downstreamPoint)}
                </td>
                <td className="px-5 py-3.5">
                  {row.customPoint === null ? (
                    <span className="text-[11px] text-neutral-600">
                      {t("tenantPoints.row.usingGlobal")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/25 bg-[#d4af37]/10 px-2 py-0.5 font-mono text-[11px] text-[#f0d27c]">
                      {formatPoint(row.customPoint)}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <span className="font-mono text-xs font-semibold text-[#f0d27c]">
                    {formatPoint(row.effectivePoint)}
                  </span>
                  <p className="mt-0.5 text-[9px] text-neutral-600">
                    {row.isCustom
                      ? t("tenantPoints.badge.custom")
                      : t("tenantPoints.badge.global")}
                  </p>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button
                    type="button"
                    onClick={() => openEditModal(row)}
                    title={t("tenantPoints.actions.editTitle")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#d4af37]/30 bg-gradient-to-r from-[#b8912f]/90 via-[#f0d27c] to-[#b8912f]/90 px-3 py-1.5 text-[11px] font-bold text-[#171105] shadow-[0_8px_20px_-10px_rgba(212,175,55,0.9)] transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0d27c]/70"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    {t("tenantPoints.actions.edit")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ==== 黑金弹窗：由 isModalOpen + currentProvider 驱动 ==== */}
      {isModalOpen && currentProvider ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8">
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={closeEditModal}
            className="absolute inset-0 h-full w-full cursor-default bg-black/80 backdrop-blur-sm"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#d4af37]/25 bg-[#0a0a0a] shadow-[0_40px_120px_-30px_rgba(212,175,55,0.45)]"
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f0d27c] to-transparent"
            />
            <form onSubmit={handleSubmit}>
              <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
                <div className="min-w-0">
                  <p className="text-[9px] uppercase tracking-[0.22em] text-[#d4af37]/60">
                    {t("tenantPoints.modal.eyebrow")}
                  </p>
                  <h2
                    id={titleId}
                    className="mt-1 truncate text-sm font-semibold text-neutral-100"
                  >
                    {t("tenantPoints.modal.title", {
                      name: currentProvider.providerName,
                    })}
                  </h2>
                  <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                    {t("tenantPoints.modal.description")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditModal}
                  aria-label={t("common.close")}
                  className="shrink-0 rounded-lg border border-white/[0.08] p-1.5 text-neutral-500 transition-colors hover:border-[#d4af37]/25 hover:text-[#f0d27c]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3 px-5 pb-5">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2">
                    <p className="text-[8px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("tenantPoints.modal.upstream")}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-neutral-300">
                      {formatPoint(currentProvider.upstreamPoint)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2">
                    <p className="text-[8px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("tenantPoints.modal.global")}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-neutral-300">
                      {formatPoint(currentProvider.downstreamPoint)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-2 py-2">
                    <p className="text-[8px] uppercase tracking-[0.16em] text-[#d4af37]/60">
                      {t("tenantPoints.modal.current")}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-[#f0d27c]">
                      {currentProvider.customPoint === null
                        ? "—"
                        : formatPoint(currentProvider.customPoint)}
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="tenant-custom-point"
                    className="block text-[10px] uppercase tracking-[0.16em] text-neutral-500"
                  >
                    {t("tenantPoints.table.custom")}
                  </label>
                  <input
                    id="tenant-custom-point"
                    ref={inputRef}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={customPoint}
                    onChange={(event) => setCustomPoint(event.target.value)}
                    placeholder={t("tenantPoints.row.placeholder", {
                      point: formatPoint(currentProvider.downstreamPoint),
                    })}
                    className="mt-2 w-full rounded-lg border border-[#d4af37]/20 bg-black px-3 py-2.5 font-mono text-sm text-[#f0d27c] placeholder:text-neutral-700 focus:border-[#f0d27c]/60 focus:outline-none focus:ring-1 focus:ring-[#f0d27c]/30"
                  />
                  <p className="mt-2 text-[10px] text-neutral-600">
                    {currentProvider.customPoint === null
                      ? t("tenantPoints.modal.unset")
                      : t("tenantPoints.modal.preview", {
                          point: formatPoint(currentProvider.effectivePoint),
                          percent: formatPercent(
                            currentProvider.effectivePlatformMarkup ??
                              currentProvider.platformMarkup,
                          ),
                        })}
                  </p>
                </div>

                {error ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-[11px] leading-5 text-red-300"
                  >
                    <span className="mt-0.5">!</span>
                    <span>{error}</span>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-[#d4af37]/10 bg-[#080808]/80 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={saving}
                  className="h-10 rounded-xl border border-white/[0.08] px-4 text-xs text-neutral-400 transition-colors hover:border-[#d4af37]/20 hover:text-neutral-200 disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-10 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export default TenantPointsEditor;
