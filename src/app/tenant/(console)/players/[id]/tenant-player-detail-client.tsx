"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatAmount, formatDate, formatInteger } from "@/lib/format";
import type { TenantPlayerDetail } from "@/lib/tenant-console";

export function TenantPlayerDetailView({
  player,
}: {
  player: TenantPlayerDetail;
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = player.status === "active";

  useEffect(() => {
    document.title = t("tenantPlayers.detail.documentTitle");
  }, [t]);

  async function toggleStatus() {
    setPending(true);
    setError("");

    try {
      const response = await fetch(`/api/tenant/players/${player.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ status: active ? "banned" : "active" }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(payload?.error || t("tenantPlayers.error.updateFailed"));
        return;
      }

      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setPending(false);
    }
  }

  const facts = [
    { label: t("tenantPlayers.detail.phone"), value: player.phone ?? "—" },
    { label: t("tenantPlayers.detail.email"), value: player.email ?? "—" },
    {
      label: t("tenantPlayers.detail.referral"),
      value: player.referralCode,
    },
    {
      label: t("tenantPlayers.detail.wallet"),
      value: player.walletAddress ?? "—",
    },
    {
      label: t("tenantPlayers.detail.betCount"),
      value: formatInteger(player.betCount),
    },
    {
      label: t("tenantPlayers.detail.createdAt"),
      value: formatDate(player.createdAt, locale),
    },
    {
      label: t("tenantPlayers.detail.lastLogin"),
      value: player.lastLoginAt ? formatDate(player.lastLoginAt, locale) : "—",
    },
  ];

  const cards = [
    {
      key: "deposit",
      label: t("tenantPlayers.detail.deposit"),
      value: `$${formatAmount(player.depositTotal)}`,
    },
    {
      key: "withdraw",
      label: t("tenantPlayers.detail.withdraw"),
      value: `$${formatAmount(player.withdrawTotal)}`,
    },
    {
      key: "pending",
      label: t("tenantPlayers.detail.pendingWithdraw"),
      value: formatInteger(player.pendingWithdrawCount),
    },
  ];

  return (
    <div>
      <Link
        href="/tenant/players"
        className="text-[11px] text-[#d4af37]/80 transition-colors hover:text-[#f0d27c]"
      >
        {t("tenantPlayers.detail.back")}
      </Link>

      <header className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {player.username}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${
                active
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                  : "border-red-400/20 bg-red-400/10 text-red-300"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {active
                ? t("tenantPlayers.status.active")
                : t("tenantPlayers.status.banned")}
            </span>
          </div>
          <p className="mt-2 font-mono text-[10px] text-neutral-600">
            {player.id}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void toggleStatus()}
          disabled={pending}
          className={`inline-flex h-9 items-center self-start rounded-lg border px-4 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto ${
            active
              ? "border-red-400/25 text-red-300 hover:bg-red-400/10"
              : "border-emerald-400/25 text-emerald-300 hover:bg-emerald-400/10"
          }`}
        >
          {pending
            ? t("tenantPlayers.actions.working")
            : active
              ? t("tenantPlayers.actions.ban")
              : t("tenantPlayers.actions.unban")}
        </button>
      </header>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
          {error}
        </p>
      ) : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <article
            key={card.key}
            className="rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] to-[#080808] p-5"
          >
            <p className="text-[11px] text-neutral-500">{card.label}</p>
            <p className="mt-3 font-mono text-xl font-semibold text-[#f5e6b8]">
              {card.value}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-5 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-5">
        <h2 className="text-sm font-medium text-neutral-200">
          {t("tenantPlayers.detail.profile")}
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {fact.label}
              </dt>
              <dd className="mt-1 truncate text-xs text-neutral-300">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
          <h2 className="border-b border-[#d4af37]/10 px-5 py-3 text-xs font-medium text-neutral-200">
            {t("tenantPlayers.detail.transactions")}
          </h2>
          <ul className="divide-y divide-white/[0.04]">
            {player.recentTransactions.length === 0 ? (
              <li className="px-5 py-8 text-center text-[11px] text-neutral-600">
                {t("tenantPlayers.detail.empty")}
              </li>
            ) : (
              player.recentTransactions.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-neutral-300">
                      {item.type === "deposit"
                        ? t("tenantFinance.tabs.deposit")
                        : t("tenantFinance.tabs.withdraw")}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] text-neutral-600">
                      {formatDate(item.createdAt, locale)}
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
          <h2 className="border-b border-[#d4af37]/10 px-5 py-3 text-xs font-medium text-neutral-200">
            {t("tenantPlayers.detail.aiLogs")}
          </h2>
          <ul className="divide-y divide-white/[0.04]">
            {player.recentAiLogs.length === 0 ? (
              <li className="px-5 py-8 text-center text-[11px] text-neutral-600">
                {t("tenantPlayers.detail.empty")}
              </li>
            ) : (
              player.recentAiLogs.map((log) => (
                <li key={log.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-[#d4af37]/80">
                      {log.role === "assistant"
                        ? t("tenantAiLogs.roles.assistant")
                        : t("tenantAiLogs.roles.user")}
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

