"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDisplayAmount } from "@/lib/currency";
import { formatDate, formatInteger } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n-types";
import type {
  TenantDepositReviewBoard,
  TenantDepositReviewRow,
} from "@/lib/tenant-console";

type ReviewAction = "approve" | "reject";

/** 通道形态标签：只有静态码 / 银行转账会进这个页面，其它类型不该出现。 */
const TYPE_KEYS: Record<string, TranslationKey> = {
  STATIC_QR: "tenantDeposits.type.staticQr",
  BANK_TRANSFER: "tenantDeposits.type.bankTransfer",
};

const STATUS_KEYS: Record<string, TranslationKey> = {
  pending: "tenantDeposits.status.pending",
  approved: "tenantDeposits.status.approved",
  rejected: "tenantDeposits.status.rejected",
};

function typeKey(gatewayType: string): TranslationKey {
  return TYPE_KEYS[gatewayType] ?? "tenantDeposits.type.staticQr";
}

function statusKey(status: string): TranslationKey {
  return STATUS_KEYS[status] ?? "tenantDeposits.status.pending";
}

function statusTone(status: string) {
  if (status === "approved") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }

  if (status === "rejected") {
    return "border-red-400/20 bg-red-400/10 text-red-300";
  }

  return "border-amber-400/20 bg-amber-400/10 text-amber-200";
}

export function TenantDepositsView({
  tenantName,
  board,
}: {
  tenantName: string;
  board: TenantDepositReviewBoard;
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const router = useRouter();

  const [banner, setBanner] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<{
    id: string;
    action: ReviewAction;
  } | null>(null);

  useEffect(() => {
    document.title = t("tenantDeposits.documentTitle");
  }, [t]);

  const currency = board.currency;
  const pendingCount = board.pending.length;

  const cards = [
    {
      key: "pendingCount",
      label: t("tenantDeposits.cards.pendingCount"),
      value: formatInteger(pendingCount),
      tone: pendingCount > 0 ? "text-amber-200" : "text-emerald-300",
    },
    {
      key: "pendingAmount",
      label: t("tenantDeposits.cards.pendingAmount"),
      value: formatDisplayAmount(board.pendingTotalAmount, currency),
      tone: "text-[#f0d27c]",
    },
    {
      key: "recent",
      label: t("tenantDeposits.cards.recent"),
      value: formatInteger(board.recent.length),
      tone: "text-neutral-200",
    },
  ];

  async function review(row: TenantDepositReviewRow, action: ReviewAction) {
    const name = row.playerName ?? t("tenantDeposits.table.anonymous");
    const amount = formatDisplayAmount(row.amount, currency);

    const confirmed = window.confirm(
      t(
        action === "approve"
          ? "tenantDeposits.actions.confirmApprove"
          : "tenantDeposits.actions.confirmReject",
        { name, amount },
      ),
    );

    if (!confirmed) {
      return;
    }

    setBusy({ id: row.id, action });
    setBanner(null);

    try {
      const response = await fetch(`/api/tenant/deposits/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setBanner({
          tone: "error",
          text: payload?.error || t("tenantDeposits.error.actionFailed"),
        });
        return;
      }

      setBanner({
        tone: "ok",
        text: t(
          action === "approve"
            ? "tenantDeposits.banner.approved"
            : "tenantDeposits.banner.rejected",
          { name, amount },
        ),
      });
      router.refresh();
    } catch {
      setBanner({ tone: "error", text: t("common.networkError") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("tenantDeposits.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantDeposits.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          {t("tenantDeposits.subtitle", {
            tenant: tenantName,
            count: formatInteger(pendingCount),
            total: formatDisplayAmount(board.pendingTotalAmount, currency),
          })}
        </p>
      </header>

      {banner ? (
        <div
          role="status"
          className={`mt-4 rounded-xl border px-4 py-3 text-xs ${
            banner.tone === "ok"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/25 bg-red-400/10 text-red-200"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      <section className="mt-4 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.05] px-4 py-3 text-[11px] leading-5 text-[#e8cf8a]">
        {t("tenantDeposits.manualNotice")}
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <article
            key={card.key}
            className="rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] to-[#080808] p-5"
          >
            <p className="text-[11px] text-neutral-400">{card.label}</p>
            <p className={`mt-3 font-mono text-xl font-semibold ${card.tone}`}>
              {card.value}
            </p>
          </article>
        ))}
      </section>


      {pendingCount === 0 ? (
        <section className="mt-4 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] px-6 py-12 text-center">
          <p className="text-sm font-semibold text-emerald-200">
            {t("tenantDeposits.empty.title")}
          </p>
          <p className="mt-2 text-xs leading-5 text-neutral-400">
            {t("tenantDeposits.empty.hint")}
          </p>
        </section>
      ) : (
        <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/25 bg-[#0a0a0a]/70">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-3">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-[#f0d27c]">
              {t("tenantDeposits.pending.title")}
            </p>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 font-mono text-[10px] text-amber-200">
              {formatInteger(pendingCount)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left">
              <thead>
                <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-400">
                  <th className="px-4 py-3 font-medium">
                    {t("tenantDeposits.table.time")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantDeposits.table.signal")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantDeposits.table.player")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantDeposits.table.gateway")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantDeposits.table.amount")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantDeposits.table.callbackAmount")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantDeposits.table.reference")}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t("tenantDeposits.table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.pending.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[10px] text-neutral-400">
                      {formatDate(row.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] ${
                          row.signalReceived
                            ? "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]"
                            : "border-neutral-500/25 bg-white/[0.03] text-neutral-400"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {row.signalReceived
                          ? t("tenantDeposits.signal.received")
                          : t("tenantDeposits.signal.missing")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-neutral-100">
                      {row.playerName ?? t("tenantDeposits.table.anonymous")}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      <span className="inline-flex flex-col gap-1">
                        <span>{row.gatewayName}</span>
                        <span className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] text-neutral-400">
                          {t(typeKey(row.gatewayType))}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-[#f0d27c]">
                      {formatDisplayAmount(row.amount, row.currency)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-neutral-300">
                      {row.callbackAmount === null
                        ? t("tenantDeposits.table.noCallbackAmount")
                        : formatDisplayAmount(row.callbackAmount, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      <span className="inline-block max-w-[200px] truncate align-middle font-mono text-[10px]">
                        {row.callbackTxHash || row.orderNo || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => review(row, "approve")}
                          disabled={busy !== null}
                          className="inline-flex h-9 items-center rounded-lg bg-gradient-to-b from-[#f0d27c] to-[#c9a02f] px-4 text-[11px] font-bold text-black shadow-[0_8px_20px_-10px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy?.id === row.id && busy.action === "approve"
                            ? t("tenantDeposits.actions.working")
                            : t("tenantDeposits.actions.approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => review(row, "reject")}
                          disabled={busy !== null}
                          className="inline-flex h-9 items-center rounded-lg border border-red-400/30 bg-red-500/10 px-4 text-[11px] font-semibold text-red-200 transition-colors hover:border-red-400/60 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy?.id === row.id && busy.action === "reject"
                            ? t("tenantDeposits.actions.working")
                            : t("tenantDeposits.actions.reject")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}


      <section className="mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0a0a]/70">
        <div className="border-b border-white/[0.05] px-4 py-3">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-neutral-300">
            {t("tenantDeposits.recent.title")}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-400">
                <th className="px-4 py-3 font-medium">
                  {t("tenantDeposits.table.time")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantDeposits.table.player")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantDeposits.table.gateway")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantDeposits.table.amount")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantDeposits.table.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {board.recent.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-xs text-neutral-500"
                  >
                    {t("tenantDeposits.recent.empty")}
                  </td>
                </tr>
              ) : (
                board.recent.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[10px] text-neutral-500">
                      {formatDate(
                        row.callbackReceivedAt ?? row.createdAt,
                        locale,
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      {row.playerName ?? t("tenantDeposits.table.anonymous")}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {row.gatewayName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#f0d27c]">
                      {formatDisplayAmount(row.amount, row.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${statusTone(
                          row.manualReviewStatus,
                        )}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {t(statusKey(row.manualReviewStatus))}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-3 text-[10px] leading-5 text-neutral-600">
        {t("tenantDeposits.note")}
      </p>
    </div>
  );
}

