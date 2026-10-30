"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatAmount, formatDate, formatInteger } from "@/lib/format";

type RecentBet = {
  id: string;
  providerName: string;
  betAmount: number;
  payoutAmount: number;
  ggrAmount: number;
  createdAt: string;
};

type TenantDashboardViewProps = {
  tenantName: string;
  playerCount: number;
  agentCount: number;
  totalBets: number;
  totalPayouts: number;
  ggrValue: string;
  pendingCount: number;
  pendingTotal: number;
  recentBets: RecentBet[];
};

export function TenantDashboardView({
  tenantName,
  playerCount,
  agentCount,
  totalBets,
  totalPayouts,
  ggrValue,
  pendingCount,
  pendingTotal,
  recentBets,
}: TenantDashboardViewProps) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  useEffect(() => {
    document.title = t("tenantDashboard.documentTitle");
  }, [t]);

  const cards = [
    {
      label: t("tenantDashboard.cards.players.label"),
      value: formatInteger(playerCount),
      hint: t("tenantDashboard.cards.players.hint"),
    },
    {
      label: t("tenantDashboard.cards.agents.label"),
      value: formatInteger(agentCount),
      hint: t("tenantDashboard.cards.agents.hint"),
    },
    {
      label: t("tenantDashboard.cards.ggr.label"),
      value: ggrValue,
      hint: t("tenantDashboard.cards.ggr.hint", {
        bets: formatAmount(totalBets),
        payouts: formatAmount(totalPayouts),
      }),
    },
    {
      label: t("tenantDashboard.cards.pending.label"),
      value: formatInteger(pendingCount),
      hint: t("tenantDashboard.cards.pending.hint", {
        amount: formatAmount(pendingTotal),
      }),
    },
  ];

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("tenantDashboard.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("tenantDashboard.title")}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {t("tenantDashboard.subtitle", { tenant: tenantName })}
          </p>
        </div>
        <Link
          href="/tenant/providers"
          className="inline-flex h-9 items-center self-start rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-3 text-[11px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 sm:self-auto"
        >
          {t("tenantDashboard.actions.rates")}
        </Link>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        <div className="flex items-center justify-between border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <h2 className="text-sm font-medium text-neutral-200">
              {t("tenantDashboard.recent.title")}
            </h2>
            <p className="mt-1 text-[10px] text-neutral-600">
              {t("tenantDashboard.recent.subtitle")}
            </p>
          </div>
          <Link
            href="/finance"
            className="text-[10px] text-[#d4af37]/80 hover:text-[#f0d27c]"
          >
            {t("tenantDashboard.recent.viewBilling")}
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3 font-medium">
                  {t("tenantDashboard.recent.table.provider")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("tenantDashboard.recent.table.bet")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("tenantDashboard.recent.table.payout")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("tenantDashboard.recent.table.ggr")}
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  {t("tenantDashboard.recent.table.time")}
                </th>
              </tr>
            </thead>
            <tbody>
              {recentBets.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-xs text-neutral-600"
                  >
                    {t("tenantDashboard.recent.empty")}
                  </td>
                </tr>
              ) : (
                recentBets.map((bet) => (
                  <tr
                    key={bet.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-5 py-3 text-xs text-neutral-300">
                      {bet.providerName}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-neutral-400">
                      ${formatAmount(bet.betAmount)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-neutral-400">
                      ${formatAmount(bet.payoutAmount)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-[#f0d27c]">
                      ${formatAmount(bet.ggrAmount)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[10px] text-neutral-600">
                      {formatDate(bet.createdAt, locale)}
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
