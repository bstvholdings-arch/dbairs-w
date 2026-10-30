"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatAmount, formatDate, formatInteger } from "@/lib/format";
import { TENANT_STATUS_LABEL_KEYS } from "@/lib/i18n-keys";

export type DashboardRecentTenant = {
  id: string;
  name: string;
  domain: string;
  status: string;
  players: number;
  createdAt: string;
};

export type DashboardPendingWithdrawal = {
  id: string;
  amount: number;
  walletAddress: string;
  approvals: number;
  requiredApprovals: number;
  createdAt: string;
  tenantName: string;
};

type DashboardViewProps = {
  tenantTotal: number;
  tenantActive: number;
  providerTotal: number;
  providerActive: number;
  totalBets: number;
  totalPayouts: number;
  ggrValue: string;
  pendingCount: number;
  pendingTotal: number;
  recentTenants: DashboardRecentTenant[];
  pendingWithdrawals: DashboardPendingWithdrawal[];
};

export function AdminDashboardView({
  tenantTotal,
  tenantActive,
  providerTotal,
  providerActive,
  totalBets,
  totalPayouts,
  ggrValue,
  pendingCount,
  pendingTotal,
  recentTenants,
  pendingWithdrawals,
}: DashboardViewProps) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  useEffect(() => {
    document.title = t("dashboard.documentTitle");
  }, [t]);

  const cards = [
    {
      label: t("dashboard.cards.tenants.label"),
      value: formatInteger(tenantTotal),
      hint: t("dashboard.cards.tenants.hint", {
        count: formatInteger(tenantActive),
      }),
      unit: t("dashboard.cards.tenants.unit"),
    },
    {
      label: t("dashboard.cards.ggr.label"),
      value: ggrValue,
      hint: t("dashboard.cards.ggr.hint", {
        bets: formatAmount(totalBets),
        payouts: formatAmount(totalPayouts),
      }),
      unit: t("dashboard.cards.ggr.unit"),
    },
    {
      label: t("dashboard.cards.providers.label"),
      value: formatInteger(providerTotal),
      hint: t("dashboard.cards.providers.hint", {
        count: formatInteger(providerActive),
      }),
      unit: t("dashboard.cards.providers.unit"),
    },
    {
      label: t("dashboard.cards.pending.label"),
      value: formatInteger(pendingCount),
      hint: t("dashboard.cards.pending.hint", {
        amount: formatAmount(pendingTotal),
      }),
      unit: t("dashboard.cards.pending.unit"),
    },
  ];

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("dashboard.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("dashboard.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/providers"
            className="inline-flex h-9 items-center rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-3 text-[11px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10"
          >
            {t("dashboard.actions.manageProviders")}
          </Link>
          <Link
            href="/admin/tenants"
            className="inline-flex h-9 items-center rounded-lg border border-white/10 px-3 text-[11px] text-neutral-300 transition-colors hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
          >
            {t("dashboard.actions.manageTenants")}
          </Link>
        </div>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article
            key={card.label}
            className="relative overflow-hidden rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] via-[#0b0b0b] to-[#080808] p-5"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/60 to-transparent" />
            <p className="text-xs text-neutral-500">{card.label}</p>
            <p className="mt-4 flex flex-wrap items-baseline gap-2 font-mono text-2xl font-semibold text-[#f5e6b8]">
              {card.value}
              <span className="font-sans text-[9px] tracking-[0.18em] text-neutral-600">
                {card.unit}
              </span>
            </p>
            <p className="mt-4 text-[11px] leading-5 text-neutral-500">
              {card.hint}
            </p>
          </article>
        ))}
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
          <div className="flex items-center justify-between border-b border-[#d4af37]/10 px-5 py-4">
            <div>
              <h2 className="text-sm font-medium text-neutral-200">
                {t("dashboard.recent.title")}
              </h2>
              <p className="mt-1 text-[10px] text-neutral-600">
                {t("dashboard.recent.subtitle")}
              </p>
            </div>
            <Link
              href="/admin/tenants"
              className="text-[10px] text-[#d4af37]/80 hover:text-[#f0d27c]"
            >
              {t("dashboard.recent.viewAll")}
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  <th className="px-5 py-3 font-medium">
                    {t("dashboard.recent.table.brand")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("dashboard.recent.table.status")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("dashboard.recent.table.players")}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t("dashboard.recent.table.createdAt")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentTenants.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-10 text-center text-xs text-neutral-600"
                    >
                      {t("dashboard.recent.empty")}
                    </td>
                  </tr>
                ) : (
                  recentTenants.map((tenant) => {
                    const statusKey =
                      TENANT_STATUS_LABEL_KEYS[
                        tenant.status as keyof typeof TENANT_STATUS_LABEL_KEYS
                      ];

                    return (
                      <tr
                        key={tenant.id}
                        className="border-b border-white/[0.04] last:border-0"
                      >
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/admin/tenants/${tenant.id}`}
                            className="text-sm text-neutral-200 hover:text-[#f0d27c]"
                          >
                            {tenant.name}
                          </Link>
                          <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                            {tenant.domain}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 text-[11px] text-neutral-400">
                          {statusKey ? t(statusKey) : tenant.status}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">
                          {formatInteger(tenant.players)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-[10px] text-neutral-600">
                          {formatDate(tenant.createdAt, locale)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
          <div className="border-b border-[#d4af37]/10 px-5 py-4">
            <h2 className="text-sm font-medium text-neutral-200">
              {t("dashboard.pending.title")}
            </h2>
            <p className="mt-1 text-[10px] text-neutral-600">
              {t("dashboard.pending.subtitle")}
            </p>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {pendingWithdrawals.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-neutral-600">
                {t("dashboard.pending.empty")}
              </p>
            ) : (
              pendingWithdrawals.map((withdrawal) => (
                <article key={withdrawal.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-neutral-300">
                        {withdrawal.tenantName}
                      </p>
                      <p className="mt-1 truncate font-mono text-[10px] text-neutral-600">
                        {withdrawal.walletAddress}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-sm text-[#f0d27c]">
                      ${formatAmount(withdrawal.amount)}
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-600">
                    <span>
                      {t("dashboard.pending.approvals", {
                        current: withdrawal.approvals,
                        required: withdrawal.requiredApprovals,
                      })}
                    </span>
                    <span>{formatDate(withdrawal.createdAt, locale)}</span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
