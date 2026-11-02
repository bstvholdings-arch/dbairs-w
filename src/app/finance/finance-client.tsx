"use client";

import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  formatAmount,
  formatDate,
  toNumber,
} from "@/lib/format";

type FinanceTotals = {
  deposit: number;
  withdraw: number;
  payinProfit: number;
  payoutProfit: number;
  paymentProfit: number;
  ggr: number;
  platformFee: number;
};

type FinanceTenantRow = FinanceTotals & {
  tenantId: string;
  tenantName: string;
};

type FinanceDepositRow = {
  id: string;
  amount: number;
  currency: string;
  createdAt: string;
  txHash: string | null;
  tenantName: string;
  playerUsername: string;
  gatewayName: string;
};

type FinanceViewProps = {
  /** true = 平台范围（super_admin / finance），false = 单个租户视角 */
  isPlatformScope: boolean;
  tenantName?: string;
  paymentSpreadLabel: string;
  monthStart: string;
  monthEnd: string;
  totals: FinanceTotals;
  tenantRows: FinanceTenantRow[];
  recentDeposits: FinanceDepositRow[];
};

function formatSignedAmount(value: number) {
  const number = toNumber(value);

  return number < 0
    ? `-$${formatAmount(Math.abs(number))}`
    : `$${formatAmount(number)}`;
}

export function FinanceView({
  isPlatformScope,
  tenantName,
  paymentSpreadLabel,
  monthStart,
  monthEnd,
  totals,
  tenantRows,
  recentDeposits,
}: FinanceViewProps) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const scopeLabel = isPlatformScope
    ? t("finance.scope.platform")
    : (tenantName ?? t("finance.scope.tenant"));
  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(monthStart));

  useEffect(() => {
    document.title = t("finance.documentTitle");
  }, [t]);

  const cards = [
    {
      label: t("finance.cards.deposit.label"),
      value: formatSignedAmount(totals.deposit),
      hint: t("finance.cards.deposit.hint"),
    },
    {
      label: t("finance.cards.withdraw.label"),
      value: formatSignedAmount(totals.withdraw),
      hint: t("finance.cards.withdraw.hint"),
    },
    {
      label: t("finance.cards.paymentProfit.label"),
      value: formatSignedAmount(totals.paymentProfit),
      hint: t("finance.cards.paymentProfit.hint", {
        payin: formatAmount(totals.payinProfit),
        payout: formatAmount(totals.payoutProfit),
        rate: paymentSpreadLabel,
      }),
    },
    {
      label: t("finance.cards.ggr.label"),
      value: formatSignedAmount(totals.ggr),
      hint: t("finance.cards.ggr.hint"),
    },
    {
      label: t("finance.cards.platformFee.label"),
      value: formatSignedAmount(totals.platformFee),
      hint: t("finance.cards.platformFee.hint"),
    },
  ];

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("finance.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("finance.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            {t("finance.subtitle", {
              month: monthLabel,
              scope: scopeLabel,
              rate: paymentSpreadLabel,
            })}
          </p>
        </div>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <article
            key={card.label}
            className="relative overflow-hidden rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] via-[#0b0b0b] to-[#080808] p-5"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/60 to-transparent" />
            <p className="text-xs text-neutral-500">{card.label}</p>
            <p className="mt-4 font-mono text-2xl font-semibold text-[#f5e6b8]">
              {card.value}
            </p>
            <p className="mt-4 text-[11px] leading-5 text-neutral-600">
              {card.hint}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <h2 className="text-sm font-medium text-neutral-200">
              {t("finance.tenants.title")}
            </h2>
            <p className="mt-1 text-[10px] text-neutral-600">
              {t("finance.tenants.subtitle")}
            </p>
          </div>
          <span className="text-[10px] text-neutral-600">
            {monthStart.slice(0, 10)} – {monthEnd.slice(0, 10)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3 font-medium">
                  {t("finance.tenants.table.tenant")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("finance.tenants.table.deposit")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("finance.tenants.table.withdraw")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("finance.tenants.table.paymentProfit")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("finance.tenants.table.ggr")}
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  {t("finance.tenants.table.platformFee")}
                </th>
              </tr>
            </thead>
            <tbody>
              {tenantRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-xs text-neutral-600"
                  >
                    {t("finance.tenants.empty")}
                  </td>
                </tr>
              ) : (
                tenantRows.map((row) => (
                  <tr
                    key={row.tenantId}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-5 py-3.5 text-xs text-neutral-300">
                      {row.tenantName}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">
                      ${formatAmount(row.deposit)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">
                      ${formatAmount(row.withdraw)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#f0d27c]">
                      {formatSignedAmount(row.paymentProfit)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">
                      {formatSignedAmount(row.ggr)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-xs text-[#f0d27c]">
                      {formatSignedAmount(row.platformFee)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d4af37]/10 px-5 py-3 text-[10px] text-neutral-600">
          <span>
            {t("finance.tenants.footerTotals", {
              deposit: formatAmount(totals.deposit),
              withdraw: formatAmount(totals.withdraw),
              profit: formatAmount(totals.paymentProfit),
            })}
          </span>
          <span>
            {t("finance.tenants.footerNote", { rate: paymentSpreadLabel })}
          </span>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="border-b border-[#d4af37]/10 px-5 py-4">
          <h2 className="text-sm font-medium text-neutral-200">
            {t("finance.deposits.title")}
          </h2>
          <p className="mt-1 text-[10px] text-neutral-600">
            {t("finance.deposits.subtitle")}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3 font-medium">
                  {t("finance.deposits.table.time")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("finance.deposits.table.tenant")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("finance.deposits.table.player")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("finance.deposits.table.gateway")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("finance.deposits.table.amount")}
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  {t("finance.deposits.table.txHash")}
                </th>
              </tr>
            </thead>
            <tbody>
              {recentDeposits.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-xs text-neutral-600"
                  >
                    {t("finance.deposits.empty")}
                  </td>
                </tr>
              ) : (
                recentDeposits.map((deposit) => (
                  <tr
                    key={deposit.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-5 py-3.5 font-mono text-[10px] text-neutral-600">
                      {formatDate(deposit.createdAt, locale)}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-neutral-300">
                      {deposit.tenantName}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-neutral-400">
                      {deposit.playerUsername}
                    </td>
                    <td className="px-5 py-3.5 text-[10px] text-neutral-500">
                      {deposit.gatewayName}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#f0d27c]">
                      ${formatAmount(deposit.amount)}{" "}
                      <span className="text-[9px] text-neutral-600">
                        {deposit.currency}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-[10px] text-neutral-600">
                      <span title={deposit.txHash ?? ""}>
                        {deposit.txHash
                          ? `${deposit.txHash.slice(0, 10)}...${deposit.txHash.slice(-6)}`
                          : "—"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

