"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatAmount, formatDate, formatInteger } from "@/lib/format";
import type { TenantOverview } from "@/lib/tenant-console";

/**
 * 商户数据概览（黑金风格）。
 *
 * 只负责渲染服务端已经按 tenantId 过滤好的数据，不做任何数据拼装，
 * 因此前端看不到、也拿不到其它商户的数据。
 */
export function TenantOverviewView({
  tenantName,
  overview,
}: {
  tenantName: string;
  overview: TenantOverview;
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  useEffect(() => {
    document.title = t("tenantOverview.documentTitle");
  }, [t]);

  const ggrValue =
    overview.ggr < 0
      ? `-$${formatAmount(Math.abs(overview.ggr))}`
      : `$${formatAmount(overview.ggr)}`;

  const cards = [
    {
      key: "players",
      label: t("tenantOverview.cards.players.label"),
      value: formatInteger(overview.playerCount),
      hint: t("tenantOverview.cards.players.hint", {
        active: formatInteger(overview.activePlayerCount),
        banned: formatInteger(overview.bannedPlayerCount),
      }),
    },
    {
      key: "deposit",
      label: t("tenantOverview.cards.deposit.label"),
      value: `$${formatAmount(overview.depositTotal)}`,
      hint: t("tenantOverview.cards.deposit.hint"),
    },
    {
      key: "withdraw",
      label: t("tenantOverview.cards.withdraw.label"),
      value: `$${formatAmount(overview.withdrawTotal)}`,
      hint: t("tenantOverview.cards.withdraw.hint", {
        pending: formatInteger(overview.pendingWithdrawCount),
        amount: formatAmount(overview.pendingWithdrawTotal),
      }),
    },
    {
      key: "ggr",
      label: t("tenantOverview.cards.ggr.label"),
      value: ggrValue,
      hint: t("tenantOverview.cards.ggr.hint", {
        bets: formatAmount(overview.betTotal),
        payouts: formatAmount(overview.payoutTotal),
      }),
    },
    {
      key: "fee",
      label: t("tenantOverview.cards.platformFee.label"),
      value: `$${formatAmount(overview.platformFee)}`,
      hint: t("tenantOverview.cards.platformFee.hint"),
    },
  ];

  const modules = [
    {
      key: "players",
      href: "/tenant/players",
      label: t("nav.tenantPlayers"),
      description: t("tenantOverview.modules.players.description"),
      meta: t("tenantOverview.cards.players.label"),
      value: formatInteger(overview.playerCount),
    },
    {
      key: "finance",
      href: "/tenant/finance",
      label: t("nav.tenantFinance"),
      description: t("tenantOverview.modules.finance.description"),
      meta: t("tenantOverview.cards.deposit.label"),
      value: `$${formatAmount(overview.depositTotal)}`,
    },
    {
      key: "ai",
      href: "/tenant/ai-logs",
      label: t("nav.tenantAiLogs"),
      description: t("tenantOverview.modules.ai.description"),
      meta: t("tenantOverview.recentAi.title"),
      value: formatInteger(overview.aiMessageCount),
    },
    {
      key: "settings",
      href: "/tenant/settings",
      label: t("nav.tenantSettings"),
      description: t("tenantOverview.modules.settings.description"),
      meta: t("tenantOverview.actions.settings"),
      value: "→",
    },
  ];

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("tenantOverview.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("tenantOverview.title")}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {t("tenantOverview.subtitle", { tenant: tenantName })}
          </p>
        </div>
        <Link
          href="/tenant/settings"
          className="inline-flex h-9 items-center self-start rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-3 text-[11px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 sm:self-auto"
        >
          {t("tenantOverview.actions.settings")}
        </Link>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <article
            key={card.key}
            className="relative overflow-hidden rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] via-[#0b0b0b] to-[#080808] p-5"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/60 to-transparent" />
            <p className="text-[11px] text-neutral-500">{card.label}</p>
            <p className="mt-3 break-all font-mono text-xl font-semibold text-[#f5e6b8]">
              {card.value}
            </p>
            <p className="mt-3 text-[10px] leading-5 text-neutral-600">
              {card.hint}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-neutral-200">
          {t("tenantOverview.modules.title")}
        </h2>
        <p className="mt-1 text-[10px] text-neutral-600">
          {t("tenantOverview.modules.subtitle")}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {modules.map((module) => (
            <Link
              key={module.key}
              href={module.href}
              className="group rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-4 transition-colors hover:border-[#d4af37]/35 hover:bg-[#d4af37]/[0.04]"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-[#f0d27c]">
                  {module.label}
                </p>
                <span className="font-mono text-sm text-neutral-400 group-hover:text-[#f5e6b8]">
                  {module.value}
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-5 text-neutral-600">
                {module.meta} · {module.description}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <section className="overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
          <div className="flex items-center justify-between border-b border-[#d4af37]/10 px-4 py-3">
            <h2 className="text-xs font-medium text-neutral-200">
              {t("tenantOverview.recentPlayers.title")}
            </h2>
            <Link
              href="/tenant/players"
              className="text-[10px] text-[#d4af37]/80 hover:text-[#f0d27c]"
            >
              {t("tenantOverview.viewAll")}
            </Link>
          </div>
          <ul className="divide-y divide-white/[0.04]">
            {overview.recentPlayers.length === 0 ? (
              <li className="px-4 py-8 text-center text-[11px] text-neutral-600">
                {t("tenantOverview.recentPlayers.empty")}
              </li>
            ) : (
              overview.recentPlayers.map((player) => (
                <li
                  key={player.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs text-neutral-300">
                      {player.username}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] text-neutral-600">
                      {formatDate(player.createdAt, locale)}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-[#f0d27c]">
                    ${formatAmount(player.balance)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
          <div className="flex items-center justify-between border-b border-[#d4af37]/10 px-4 py-3">
            <h2 className="text-xs font-medium text-neutral-200">
              {t("tenantOverview.recentTransactions.title")}
            </h2>
            <Link
              href="/tenant/finance"
              className="text-[10px] text-[#d4af37]/80 hover:text-[#f0d27c]"
            >
              {t("tenantOverview.viewAll")}
            </Link>
          </div>
          <ul className="divide-y divide-white/[0.04]">
            {overview.recentTransactions.length === 0 ? (
              <li className="px-4 py-8 text-center text-[11px] text-neutral-600">
                {t("tenantOverview.recentTransactions.empty")}
              </li>
            ) : (
              overview.recentTransactions.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs text-neutral-300">
                      {item.playerName ?? "—"}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] text-neutral-600">
                      {item.type === "deposit"
                        ? t("tenantFinance.tabs.deposit")
                        : t("tenantFinance.tabs.withdraw")}{" "}
                      · {formatDate(item.createdAt, locale)}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-[#f0d27c]">
                    ${formatAmount(item.amount)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
          <div className="flex items-center justify-between border-b border-[#d4af37]/10 px-4 py-3">
            <h2 className="text-xs font-medium text-neutral-200">
              {t("tenantOverview.recentAi.title")}
            </h2>
            <Link
              href="/tenant/ai-logs"
              className="text-[10px] text-[#d4af37]/80 hover:text-[#f0d27c]"
            >
              {t("tenantOverview.viewAll")}
            </Link>
          </div>
          <ul className="divide-y divide-white/[0.04]">
            {overview.recentAiLogs.length === 0 ? (
              <li className="px-4 py-8 text-center text-[11px] text-neutral-600">
                {t("tenantOverview.recentAi.empty")}
              </li>
            ) : (
              overview.recentAiLogs.map((log) => (
                <li key={log.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-[#d4af37]/80">
                      {log.role === "assistant"
                        ? t("tenantAiLogs.roles.assistant")
                        : (log.playerName ?? t("tenantAiLogs.guest"))}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-neutral-600">
                      {formatDate(log.createdAt, locale)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-neutral-400">
                    {log.content}
                  </p>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

