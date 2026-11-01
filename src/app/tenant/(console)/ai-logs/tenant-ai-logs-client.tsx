"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate, formatInteger } from "@/lib/format";
import type { TenantAiLogPage } from "@/lib/tenant-console";

function buildHref(params: { q: string; playerId: string; page: number }) {
  const search = new URLSearchParams();

  if (params.q) {
    search.set("q", params.q);
  }

  if (params.playerId) {
    search.set("playerId", params.playerId);
  }

  if (params.page > 1) {
    search.set("page", String(params.page));
  }

  const qs = search.toString();

  return qs ? `/tenant/ai-logs?${qs}` : "/tenant/ai-logs";
}

export function TenantAiLogsView({
  tenantName,
  data,
  query,
}: {
  tenantName: string;
  data: TenantAiLogPage;
  query: { q: string; playerId: string };
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  useEffect(() => {
    document.title = t("tenantAiLogs.documentTitle");
  }, [t]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("tenantAiLogs.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantAiLogs.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          {t("tenantAiLogs.subtitle", { tenant: tenantName })}
        </p>
      </header>

      <form
        action="/tenant/ai-logs"
        method="get"
        className="mt-6 flex flex-col gap-2 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-3 sm:flex-row sm:items-center"
      >
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={64}
          placeholder={t("tenantAiLogs.search.placeholder")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/40 px-3 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-[#d4af37]/45 focus:outline-none"
        />
        <select
          name="playerId"
          defaultValue={query.playerId}
          className="h-9 max-w-[240px] rounded-lg border border-white/[0.08] bg-black/40 px-3 text-xs text-neutral-300 focus:border-[#d4af37]/45 focus:outline-none"
        >
          <option value="">{t("tenantAiLogs.filter.playerAll")}</option>
          {data.players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.username}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-4 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20"
        >
          {t("tenantAiLogs.search.submit")}
        </button>
        <Link
          href="/tenant/ai-logs"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-white/[0.08] px-3 text-[11px] text-neutral-400 transition-colors hover:text-neutral-200"
        >
          {t("tenantAiLogs.search.reset")}
        </Link>
      </form>

      <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <ul className="divide-y divide-white/[0.04]">
          {data.items.length === 0 ? (
            <li className="px-5 py-12 text-center text-xs text-neutral-600">
              {t("tenantAiLogs.empty")}
            </li>
          ) : (
            data.items.map((log) => {
              const fromPlayer = log.role !== "assistant";

              return (
                <li key={log.id} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[9px] ${
                          fromPlayer
                            ? "border-white/[0.08] text-neutral-400"
                            : "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]"
                        }`}
                      >
                        {fromPlayer
                          ? t("tenantAiLogs.roles.user")
                          : t("tenantAiLogs.roles.assistant")}
                      </span>
                      <span className="truncate text-[11px] text-neutral-400">
                        {log.playerName ?? t("tenantAiLogs.guest")}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[9px] text-neutral-600">
                      {formatDate(log.createdAt, locale)}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-6 text-neutral-300">
                    {log.content}
                  </p>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <p className="mt-3 text-[10px] leading-5 text-neutral-600">
        {t("tenantAiLogs.note")}
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
            href={buildHref({
              q: query.q,
              playerId: query.playerId,
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
              playerId: query.playerId,
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

