"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { TenantPayoutEngineSnapshot } from "@/lib/auto-payout";
import { formatDisplayAmount } from "@/lib/currency";
import { formatDate, formatInteger } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n-types";
import type {
  TenantWithdrawalBoard,
  TenantWithdrawalRow,
} from "@/lib/tenant-console";

import { TenantPayoutEnginePanel } from "./tenant-payout-engine-panel";

const STATUS_KEYS: Record<string, TranslationKey> = {
  success: "tenantWithdrawals.status.success",
  pending: "tenantWithdrawals.status.pending",
  processing: "tenantWithdrawals.status.processing",
  failed: "tenantWithdrawals.status.failed",
};

/**
 * 路由原因 → 文案 key。
 *
 * 商户最需要一眼看懂的是「这单为什么没自动出」：
 * 没有代付 API / 超出单笔上限 / 日额度熔断 / 红利流水未打满 / 自动打款失败。
 * 认不出来的值（历史单 riskStatus=null）直接不渲染，不猜。
 */
const RISK_KEYS: Record<string, TranslationKey> = {
  auto_queued: "tenantWithdrawals.risk.autoQueued",
  auto_paid: "tenantWithdrawals.risk.autoPaid",
  auto_payout_failed: "tenantWithdrawals.risk.autoPayoutFailed",
  auto_payout_unsettled: "tenantWithdrawals.risk.autoPayoutUnsettled",
  manual_disabled: "tenantWithdrawals.risk.manualDisabled",
  manual_no_payout_api: "tenantWithdrawals.risk.manualNoPayoutApi",
  manual_over_single_limit: "tenantWithdrawals.risk.manualOverSingleLimit",
  manual_daily_limit: "tenantWithdrawals.risk.manualDailyLimit",
  manual_kyc_pending: "tenantWithdrawals.risk.manualKycPending",
  manual_bonus_turnover: "tenantWithdrawals.risk.manualBonusTurnover",
};

function riskTone(riskStatus: string | null) {
  if (!riskStatus) {
    return "border-white/10 bg-white/5 text-neutral-400";
  }

  if (riskStatus === "auto_paid" || riskStatus === "auto_queued") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  }

  if (
    riskStatus === "auto_payout_failed" ||
    riskStatus === "auto_payout_unsettled"
  ) {
    return "border-red-400/25 bg-red-400/10 text-red-200";
  }

  return "border-amber-400/20 bg-amber-400/10 text-amber-200";
}

function statusKey(status: string): TranslationKey {
  return STATUS_KEYS[status] ?? "tenantWithdrawals.status.pending";
}

/** 路由原因小胶囊（币种无关，纯文案；认不出来的值不渲染，避免瞎猜） */
function WithdrawalRiskCell({ riskStatus }: { riskStatus: string | null }) {
  const { t } = useLanguage();
  const key = riskStatus ? RISK_KEYS[riskStatus] : undefined;

  if (!riskStatus || !key) {
    return <span className="text-[10px] text-neutral-600">—</span>;
  }

  return (
    <span
      className={`inline-flex max-w-[190px] items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-medium ${riskTone(
        riskStatus,
      )}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{t(key)}</span>
    </span>
  );
}

function statusTone(status: string) {
  if (status === "success") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }

  if (status === "failed") {
    return "border-red-400/20 bg-red-400/10 text-red-300";
  }

  return "border-amber-400/20 bg-amber-400/10 text-amber-200";
}

type ReviewAction = "approve" | "reject";

export function TenantWithdrawalsView({
  tenantName,
  board,
  engine,
}: {
  tenantName: string;
  board: TenantWithdrawalBoard;
  engine: TenantPayoutEngineSnapshot;
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
    document.title = t("tenantWithdrawals.documentTitle");
  }, [t]);

  const currency = board.currency;
  const pendingCount = board.pending.length;

  const cards = [
    {
      key: "pendingCount",
      label: t("tenantWithdrawals.cards.pendingCount"),
      value: formatInteger(pendingCount),
      tone: pendingCount > 0 ? "text-amber-200" : "text-emerald-300",
    },
    {
      key: "pendingAmount",
      label: t("tenantWithdrawals.cards.pendingAmount"),
      value: formatDisplayAmount(board.pendingTotalAmount, currency),
      tone: "text-[#f0d27c]",
    },
    {
      key: "recent",
      label: t("tenantWithdrawals.cards.recent"),
      value: formatInteger(board.recent.length),
      tone: "text-neutral-200",
    },
  ];

  async function review(row: TenantWithdrawalRow, action: ReviewAction) {
    const name = row.playerName ?? t("tenantWithdrawals.table.anonymous");
    const amount = formatDisplayAmount(row.amount, currency);

    const confirmed = window.confirm(
      t(
        action === "approve"
          ? "tenantWithdrawals.actions.confirmApprove"
          : "tenantWithdrawals.actions.confirmReject",
        { name, amount },
      ),
    );

    if (!confirmed) {
      return;
    }

    setBusy({ id: row.id, action });
    setBanner(null);

    try {
      const response = await fetch(`/api/tenant/withdrawals/${row.id}`, {
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
          text: payload?.error || t("tenantWithdrawals.error.actionFailed"),
        });
        return;
      }

      setBanner({
        tone: "ok",
        text: t(
          action === "approve"
            ? "tenantWithdrawals.banner.approved"
            : "tenantWithdrawals.banner.rejected",
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
          {t("tenantWithdrawals.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantWithdrawals.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          {t("tenantWithdrawals.subtitle", {
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

      {/* 自动出款引擎：开关 / 限额 / 各通道代付 API / 今日额度与熔断状态 */}
      <TenantPayoutEnginePanel initial={engine} />

      {pendingCount === 0 ? (
        <section className="mt-4 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] px-6 py-12 text-center">
          <p className="text-sm font-semibold text-emerald-200">
            {t("tenantWithdrawals.empty.title")}
          </p>
          <p className="mt-2 text-xs leading-5 text-neutral-400">
            {t("tenantWithdrawals.empty.hint")}
          </p>
        </section>
      ) : (
        <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/25 bg-[#0a0a0a]/70">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-3">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-[#f0d27c]">
              {t("tenantWithdrawals.pending.title")}
            </p>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 font-mono text-[10px] text-amber-200">
              {formatInteger(pendingCount)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-400">
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.time")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.player")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.gateway")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.routing")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.amount")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.account")}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t("tenantWithdrawals.table.actions")}
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
                    <td className="px-4 py-3 text-xs font-medium text-neutral-100">
                      {row.playerName ?? t("tenantWithdrawals.table.anonymous")}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      {row.gatewayName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <WithdrawalRiskCell riskStatus={row.riskStatus} />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-[#f0d27c]">
                      {formatDisplayAmount(row.amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      <span className="inline-block max-w-[220px] truncate align-middle font-mono text-[10px]">
                        {row.account || "—"}
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
                            ? t("tenantWithdrawals.actions.working")
                            : t("tenantWithdrawals.actions.approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => review(row, "reject")}
                          disabled={busy !== null}
                          className="inline-flex h-9 items-center rounded-lg border border-red-400/30 bg-red-500/10 px-4 text-[11px] font-semibold text-red-200 transition-colors hover:border-red-400/60 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy?.id === row.id && busy.action === "reject"
                            ? t("tenantWithdrawals.actions.working")
                            : t("tenantWithdrawals.actions.reject")}
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

      {board.processing.length > 0 ? (
        <section className="mt-4 overflow-hidden rounded-2xl border border-sky-400/20 bg-[#0a0a0a]/70">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] px-4 py-3">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-sky-200">
              {t("tenantWithdrawals.processing.title")}
            </p>
            <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 font-mono text-[10px] text-sky-200">
              {t("tenantWithdrawals.processing.badge", {
                count: formatInteger(board.processing.length),
                amount: formatDisplayAmount(board.processingTotalAmount, currency),
              })}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-400">
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.time")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.player")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.amount")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.gateway")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("tenantWithdrawals.table.status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.processing.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[10px] text-neutral-400">
                      {formatDate(row.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-neutral-100">
                      {row.playerName ?? t("tenantWithdrawals.table.anonymous")}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-[#f0d27c]">
                      {formatDisplayAmount(row.amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      {row.gatewayName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${statusTone(
                          row.status,
                        )}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {t(statusKey(row.status))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-white/[0.04] px-4 py-2.5 text-[10px] leading-5 text-neutral-500">
            {t("tenantWithdrawals.processing.note")}
          </p>
        </section>
      ) : null}

      <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="border-b border-white/[0.05] px-4 py-3">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-neutral-300">
            {t("tenantWithdrawals.recent.title")}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-500">
                <th className="px-4 py-3 font-medium">
                  {t("tenantWithdrawals.table.reviewedAt")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantWithdrawals.table.player")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantWithdrawals.table.amount")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantWithdrawals.table.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {board.recent.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-xs text-neutral-500"
                  >
                    {t("tenantWithdrawals.recent.empty")}
                  </td>
                </tr>
              ) : (
                board.recent.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[10px] text-neutral-400">
                      {formatDate(row.processedAt ?? row.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-200">
                      {row.playerName ?? t("tenantWithdrawals.table.anonymous")}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-200">
                      {formatDisplayAmount(row.amount, currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${statusTone(
                          row.status,
                        )}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {t(statusKey(row.status))}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-3 text-[10px] leading-5 text-neutral-500">
        {t("tenantWithdrawals.note")}
      </p>

      <p className="mt-2 text-[10px] text-neutral-500">
        <Link
          href="/tenant/finance?kind=withdraw"
          className="text-[#f0d27c] underline-offset-4 hover:underline"
        >
          {t("tenantWithdrawals.ledgerLink")}
        </Link>
      </p>
    </div>
  );
}
