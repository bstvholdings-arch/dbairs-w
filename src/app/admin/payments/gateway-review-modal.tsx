"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import type {
  GatewayMutationResponse,
  GatewayRow,
} from "@/app/admin/gateways/types";
import { useLanguage } from "@/components/LanguageProvider";

export function GatewayReviewModal({
  gateway,
  decision,
  onClose,
  onReviewed,
}: {
  gateway: GatewayRow;
  decision: "APPROVED" | "REJECTED";
  onClose: () => void;
  onReviewed: (gateway: GatewayRow) => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const titleId = useId();
  const [note, setNote] = useState(gateway.reviewNote ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const approving = decision === "APPROVED";

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

  async function handleSubmit() {
    setError("");

    if (!approving && !note.trim()) {
      setError(t("reviewModal.error.noteRequired"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/admin/gateways/${gateway.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewStatus: decision,
          reviewNote: note.trim(),
          isActive: approving,
        }),
      });
      const data: GatewayMutationResponse = await response
        .json()
        .catch(() => ({}) as GatewayMutationResponse);

      if (response.status === 401) {
        router.replace("/login?next=/admin/payments");
        return;
      }

      if (!response.ok || !data.success || !data.gateway) {
        setError(data.error || t("reviewModal.error.failed"));
        return;
      }

      onReviewed(data.gateway);
    } catch {
      setError(t("reviewModal.error.network"));
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
        className="w-full max-w-lg rounded-t-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_120px_-30px_rgba(212,175,55,0.35)] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <p className="text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/60">
              {t("reviewModal.eyebrow")}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
              {approving
                ? t("reviewModal.approveTitle")
                : t("reviewModal.rejectTitle")}
            </h2>
            <p className="mt-1 text-[10px] text-neutral-600">
              {gateway.ownerName ?? t("reviewModal.unknownTenant")} ·{" "}
              {gateway.name}
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

        <div className="space-y-4 px-5 py-5">
          <div
            className={`rounded-xl border px-4 py-3 text-[11px] leading-5 ${
              approving
                ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
                : "border-red-400/20 bg-red-400/[0.06] text-red-300"
            }`}
          >
            {approving
              ? t("reviewModal.approveHint")
              : t("reviewModal.rejectHint")}
          </div>

          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
              {approving
                ? t("reviewModal.noteOptional")
                : t("reviewModal.noteRequired")}
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={4}
              placeholder={
                approving
                  ? t("reviewModal.notePlaceholderApprove")
                  : t("reviewModal.notePlaceholderReject")
              }
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-neutral-200 outline-none transition-colors focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
            />
            <span className="mt-1.5 block text-right font-mono text-[9px] text-neutral-700">
              {note.length}/500
            </span>
          </label>

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-[11px] leading-5 text-red-300">
              <span className="mt-0.5">!</span>
              <span>{error}</span>
            </div>
          ) : null}
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
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className={`h-10 rounded-xl px-5 text-xs font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${
              approving
                ? "bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] hover:opacity-90"
                : "bg-red-500/90 text-white hover:bg-red-500"
            }`}
          >
            {submitting
              ? t("reviewModal.submitting")
              : approving
                ? t("reviewModal.confirmApprove")
                : t("reviewModal.confirmReject")}
          </button>
        </div>
      </section>
    </div>
  );
}
