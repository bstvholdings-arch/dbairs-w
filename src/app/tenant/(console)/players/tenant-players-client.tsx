"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatAmount, formatDate, formatInteger } from "@/lib/format";
import type { TenantPlayerPage, TenantPlayerRow } from "@/lib/tenant-console";

import { PlayerDepositButton } from "./player-deposit-button";

function buildHref(params: { q: string; status: string; page: number }) {
  const search = new URLSearchParams();

  if (params.q) {
    search.set("q", params.q);
  }

  if (params.status) {
    search.set("status", params.status);
  }

  if (params.page > 1) {
    search.set("page", String(params.page));
  }

  const qs = search.toString();

  return qs ? `/tenant/players?${qs}` : "/tenant/players";
}

export function TenantPlayersView({
  tenantName,
  data,
  query,
}: {
  tenantName: string;
  data: TenantPlayerPage;
  query: { q: string; status: string };
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const router = useRouter();
  const [pendingId, setPendingId] = useState("");
  const [banner, setBanner] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    document.title = t("tenantPlayers.documentTitle");
  }, [t]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filters = [
    { value: "", label: t("tenantPlayers.filter.all") },
    { value: "active", label: t("tenantPlayers.filter.active") },
    { value: "banned", label: t("tenantPlayers.filter.banned") },
  ];

  async function toggleStatus(player: TenantPlayerRow) {
    const nextStatus = player.status === "active" ? "banned" : "active";

    setPendingId(player.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/tenant/players/${player.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setBanner({
          tone: "error",
          text: payload?.error || t("tenantPlayers.error.updateFailed"),
        });
        return;
      }

      setBanner({
        tone: "ok",
        text:
          nextStatus === "banned"
            ? t("tenantPlayers.banner.banned", { name: player.username })
            : t("tenantPlayers.banner.unbanned", { name: player.username }),
      });
      router.refresh();
    } catch {
      setBanner({ tone: "error", text: t("common.networkError") });
    } finally {
      setPendingId("");
    }
  }

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("tenantPlayers.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantPlayers.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          {t("tenantPlayers.subtitle", {
            tenant: tenantName,
            count: formatInteger(data.total),
          })}
        </p>
      </header>

      <form
        action="/tenant/players"
        method="get"
        className="mt-6 flex flex-col gap-2 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-3 sm:flex-row sm:items-center"
      >
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={64}
          placeholder={t("tenantPlayers.search.placeholder")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/40 px-3 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-[#d4af37]/45 focus:outline-none"
        />
        <select
          name="status"
          defaultValue={query.status}
          className="h-9 rounded-lg border border-white/[0.08] bg-black/40 px-3 text-xs text-neutral-300 focus:border-[#d4af37]/45 focus:outline-none"
        >
          {filters.map((filter) => (
            <option key={filter.value || "all"} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-4 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20"
        >
          {t("tenantPlayers.search.submit")}
        </button>
        <Link
          href="/tenant/players"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-white/[0.08] px-3 text-[11px] text-neutral-400 transition-colors hover:text-neutral-200"
        >
          {t("tenantPlayers.search.reset")}
        </Link>
      </form>

      {banner ? (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-[11px] ${
            banner.tone === "ok"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/25 bg-red-400/10 text-red-200"
          }`}
        >
          {banner.text}
        </p>
      ) : null}

      <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-4 py-3 font-medium">
                  {t("tenantPlayers.table.username")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantPlayers.table.balance")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantPlayers.table.status")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantPlayers.table.bets")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantPlayers.table.deposit")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantPlayers.table.actions")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("tenantPlayers.table.createdAt")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-xs text-neutral-600"
                  >
                    {t("tenantPlayers.table.empty")}
                  </td>
                </tr>
              ) : (
                data.items.map((player) => {
                  const active = player.status === "active";

                  return (
                    <tr
                      key={player.id}
                      className="border-b border-white/[0.04] last:border-0"
                    >
                      <td className="px-4 py-3.5">
                        <p className="text-sm text-neutral-200">
                          {player.username}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                          {player.phone ?? player.email ?? player.id.slice(0, 8)}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-[#f0d27c]">
                        ${formatAmount(player.balance)}
                      </td>
                      <td className="px-4 py-3.5">
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
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-neutral-400">
                        {formatInteger(player.betCount)}
                      </td>
                      <td className="px-4 py-3.5">
                        <PlayerDepositButton
                          playerId={player.id}
                          playerName={player.username}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/tenant/players/${player.id}`}
                            className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/20 px-2.5 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
                          >
                            {t("tenantPlayers.actions.view")}
                          </Link>
                          <button
                            type="button"
                            onClick={() => void toggleStatus(player)}
                            disabled={pendingId === player.id}
                            className={`inline-flex h-8 items-center rounded-lg border px-2.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              active
                                ? "border-red-400/25 text-red-300 hover:bg-red-400/10"
                                : "border-emerald-400/25 text-emerald-300 hover:bg-emerald-400/10"
                            }`}
                          >
                            {pendingId === player.id
                              ? t("tenantPlayers.actions.working")
                              : active
                                ? t("tenantPlayers.actions.ban")
                                : t("tenantPlayers.actions.unban")}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-[10px] text-neutral-600">
                        {formatDate(player.createdAt, locale)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>


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
            href={buildHref({
              q: query.q,
              status: query.status,
              page: Math.max(1, data.page - 1),
            })}
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
            href={buildHref({
              q: query.q,
              status: query.status,
              page: Math.min(totalPages, data.page + 1),
            })}
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

