"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDisplayAmount } from "@/lib/currency";
import { formatDate, formatInteger } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n-types";
import type { TenantFinancePage } from "@/lib/tenant-console";

const STATUS_KEYS: Record<string, TranslationKey> = {
  success: "tenantFinance.status.success",
  pending: "tenantFinance.status.pending",
  failed: "tenantFinance.status.failed",
};

function statusKey(status: string): TranslationKey {
  return STATUS_KEYS[status] ?? "tenantFinance.status.pending";
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

export function TenantFinanceView({
  tenantName,
  data,
  pendingWithdrawalCount,
}: {
  tenantName: string;
  data: TenantFinancePage;
  /** 待审批提现笔数（本页只提示 + 跳转，审批在 /tenant/withdrawals） */
  pendingWithdrawalCount: number;
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  useEffect(() => {
    document.title = t("tenantFinance.documentTitle");
  }, [t]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const tabs = [
    { kind: "deposit" as const, label: t("tenantFinance.tabs.deposit") },
    { kind: "withdraw" as const, label: t("tenantFinance.tabs.withdraw") },
  ];
  const cards = [
    {
      key: "success",
      label: t("tenantFinance.cards.success"),
      value: formatDisplayAmount(data.summary.successTotal, data.currency),
      tone: "text-emerald-300",
    },
    {
      key: "pending",
      label: t("tenantFinance.cards.pending"),
      value: formatDisplayAmount(data.summary.pendingTotal, data.currency),
      tone: "text-amber-200",
    },
    {
      key: "failed",
      label: t("tenantFinance.cards.failed"),
      value: formatDisplayAmount(data.summary.failedTotal, data.currency),
      tone: "text-red-300",
    },
  ];

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("tenantFinance.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantFinance.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          {t("tenantFinance.subtitle", { tenant: tenantName })}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.kind}
            href={`/tenant/finance?kind=${tab.kind}`}
            className={`inline-flex h-9 items-center rounded-lg border px-4 text-[11px] transition-colors ${
              data.kind === tab.kind
                ? "border-[#d4af37]/35 bg-[#d4af37]/10 text-[#f0d27c]"
                : "border-white/[0.07] text-neutral-500 hover:text-neutral-200"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {pendingWithdrawalCount > 0 ? (
        <Link
          href="/tenant/withdrawals"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d4af37]/35 bg-[#d4af37]/[0.08] px-5 py-4 transition-colors hover:border-[#d4af37]/60 hover:bg-[#d4af37]/[0.14]"
        >
          <span className="flex items-center gap-2.5 text-sm font-semibold text-[#f7e0a1]">
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#d4af37] px-1.5 text-[11px] font-bold text-black">
              {formatInteger(pendingWithdrawalCount)}
            </span>
            {t("tenantFinance.approvalPending", {
              count: formatInteger(pendingWithdrawalCount),
            })}
          </span>
          <span className="text-[11px] font-medium text-neutral-300">
            {t("tenantFinance.approvalCtaAction")}
          </span>
        </Link>
      ) : null}

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <article
            key={card.key}
            className="rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] to-[#080808] p-5"
          >
            <p className="text-[11px] text-neutral-500">{card.label}</p>
            <p className={`mt-3 font-mono text-xl font-semibold ${card.tone}`}>
              {card.value}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-4 py-3 font-medium">
                  {t("tenantFinance.table.time")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantFinance.table.player")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantFinance.table.gateway")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantFinance.table.amount")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantFinance.table.status")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("tenantFinance.table.reference")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-xs text-neutral-600"
                  >
                    {t("tenantFinance.empty")}
                  </td>
                </tr>
              ) : (
                data.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[10px] text-neutral-500">
                      {formatDate(item.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      {item.playerName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {item.gatewayName ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#f0d27c]">
                      {formatDisplayAmount(item.amount, item.currency)}
                      {/*
                       * 通道费 / 实际入账（只记账，玩家上分金额永远等于 amount）。
                       * 口径由服务端 resolveDepositFeeBreakdown 统一算出，
                       * 历史单（没走过费率链路）展示为「通道费 0、实际入账 = 全额」。
                       */}
                      {item.kind === "deposit" ? (
                        <span className="mt-1 block text-[9px] font-normal text-neutral-500">
                          {t("tenantFinance.feeBreakdown", {
                            fee: formatDisplayAmount(
                              item.feeAmount ?? 0,
                              item.currency,
                            ),
                            net: formatDisplayAmount(
                              item.actualReceived ?? item.amount,
                              item.currency,
                            ),
                          })}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${statusTone(
                          item.status,
                        )}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {t(statusKey(item.status))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[9px] text-neutral-600">
                      <span className="inline-block max-w-[220px] truncate align-middle">
                        {item.reference ?? "—"}
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
        {t("tenantFinance.note")}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[10px] text-neutral-500">
        <span>
          {t("tenantPlayers.pagination.summary", {
            page: formatInteger(data.page),
            pages: formatInteger(totalPages),
            total: formatInteger(data.total),
          })}
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={`/tenant/finance?kind=${data.kind}&page=${Math.max(1, data.page - 1)}`}
            aria-disabled={data.page <= 1}
            className={`inline-flex h-8 items-center rounded-lg border px-3 transition-colors ${
              data.page <= 1
                ? "pointer-events-none border-white/[0.05] text-neutral-700"
                : "border-[#d4af37]/20 text-[#f0d27c] hover:bg-[#d4af37]/10"
            }`}
          >
            {t("tenantPlayers.pagination.prev")}
          </Link>
          <Link
            href={`/tenant/finance?kind=${data.kind}&page=${Math.min(totalPages, data.page + 1)}`}
            aria-disabled={data.page >= totalPages}
            className={`inline-flex h-8 items-center rounded-lg border px-3 transition-colors ${
              data.page >= totalPages
                ? "pointer-events-none border-white/[0.05] text-neutral-700"
                : "border-[#d4af37]/20 text-[#f0d27c] hover:bg-[#d4af37]/10"
            }`}
          >
            {t("tenantPlayers.pagination.next")}
          </Link>
        </div>
      </div>
    </div>
  );
}
