"use client";

import { useCallback, useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  summarizeFailureBuckets,
  successRate,
  type FailureSummary,
} from "@/lib/ai/constants";
import type {
  AiAgentConfigSnapshot,
  SerializedLeadRecord,
  WarRoomSnapshot,
} from "@/lib/ai/records";
import { formatDate, formatInteger, formatPercent } from "@/lib/format";

import { TacticsPanel } from "./tactics-panel";
import {
  LEAD_FILTERS,
  LEAD_FILTER_LABEL_KEYS,
  LEAD_STATUS_LABEL_KEYS,
  type LeadFilter,
  type LeadsResponse,
} from "./types";

/**
 * 「战败分析看板」Tab。
 *
 * 首屏数据由 Server Component 直接注入；切换筛选 / 点刷新时走
 * GET /api/ai/leads，接口与 SSR 使用同一套 loadWarRoomSnapshot 聚合结果。
 */
export function WarRoomTab({
  initialSnapshot,
  initialConfig,
  onOpenChat,
}: {
  initialSnapshot: WarRoomSnapshot;
  initialConfig: AiAgentConfigSnapshot;
  onOpenChat: (lead: SerializedLeadRecord) => void;
}) {
  const { t, language } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [config, setConfig] = useState(initialConfig);
  const [filter, setFilter] = useState<LeadFilter>("open");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextFilter: LeadFilter) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/ai/leads?status=${nextFilter}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as LeadsResponse;

        if (
          !response.ok ||
          !data.leads ||
          !data.statusCounts ||
          !data.reasonCounts
        ) {
          throw new Error(data.error ?? t("aiConsole.loadError"));
        }

        setSnapshot({
          leads: data.leads,
          statusCounts: data.statusCounts,
          reasonCounts: data.reasonCounts,
        });

        return true;
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("aiConsole.loadError"),
        );

        return false;
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // 首屏快照由 Server Component 按 "open" 注入，只有用户切换筛选时才请求，
  // 因此不需要在 effect 里再拉一次（也避免 setState-in-effect 的级联渲染）。
  async function selectFilter(nextFilter: LeadFilter) {
    if (nextFilter === filter || loading) {
      return;
    }

    // 请求成功后再切高亮，避免失败时「筛选项已变、列表还是旧数据」。
    const ok = await load(nextFilter);

    if (ok) {
      setFilter(nextFilter);
    }
  }

  const { statusCounts } = snapshot;
  const total = statusCounts.failed + statusCounts.pending + statusCounts.success;
  const winRate = successRate(statusCounts.success, total);
  const summary = useMemo(
    () => summarizeFailureBuckets(snapshot.reasonCounts),
    [snapshot.reasonCounts],
  );
  const topReason = snapshot.reasonCounts[0] ?? null;

  const visibleLeads = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) {
      return snapshot.leads;
    }

    return snapshot.leads.filter(
      (lead) =>
        lead.brandName.toLowerCase().includes(keyword) ||
        lead.tgOrEmail.toLowerCase().includes(keyword) ||
        (lead.failReason ?? "").toLowerCase().includes(keyword),
    );
  }, [snapshot.leads, query]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">
            {t("aiConsole.war.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-neutral-500">
            {t("aiConsole.war.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(filter)}
          disabled={loading}
          className="h-9 shrink-0 rounded-xl border border-white/[0.08] px-3 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/25 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? t("aiConsole.refreshing") : t("aiConsole.refresh")}
        </button>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2.5 text-[11px] text-red-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load(filter)}
            className="rounded-lg border border-red-400/30 px-2.5 py-1 text-[10px] transition-colors hover:bg-red-400/10"
          >
            {t("aiConsole.retry")}
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label={t("aiConsole.war.total")} value={formatInteger(total)} />
        <Kpi
          label={t("aiConsole.war.failed")}
          value={formatInteger(statusCounts.failed)}
          accent="text-red-300"
        />
        <Kpi
          label={t("aiConsole.war.pending")}
          value={formatInteger(statusCounts.pending)}
          accent="text-[#f0d27c]"
        />
        <Kpi
          label={t("aiConsole.war.success")}
          value={formatInteger(statusCounts.success)}
          accent="text-emerald-300"
        />
        <Kpi
          label={t("aiConsole.war.successRate")}
          value={formatPercent(winRate)}
          accent="text-emerald-300"
        />
        <Kpi
          label={t("aiConsole.war.topReason")}
          value={topReason?.reason ?? t("aiConsole.war.none")}
          hint={
            topReason
              ? t("aiConsole.war.count", {
                  count: formatInteger(topReason.count),
                })
              : undefined
          }
          accent="text-[#f0d27c]"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-neutral-100">
            {t("aiConsole.war.chartTitle")}
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-neutral-500">
            {t("aiConsole.war.chartSubtitle")}
          </p>

          {summary.total === 0 ? (
            <p className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-6 text-center text-[10px] leading-5 text-neutral-600">
              {t("aiConsole.war.chartEmpty")}
            </p>
          ) : (
            <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row">
              <FailureDonut
                summary={summary}
                caption={t("aiConsole.war.chartTotal")}
              />
              <ul className="min-w-0 flex-1 space-y-2.5">
                {summary.buckets.map((bucket) => (
                  <li key={bucket.key}>
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-neutral-300">
                        <span
                          className="h-2 w-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: bucket.color }}
                        />
                        <span className="truncate">{t(bucket.labelKey)}</span>
                      </span>
                      <span className="shrink-0 font-mono text-neutral-400">
                        {formatInteger(bucket.count)} ·{" "}
                        {formatPercent(bucket.ratio)}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-3.5 text-[9px] leading-4 text-neutral-600">
                      {t(bucket.hintKey)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-neutral-100">
            {t("aiConsole.war.barTitle")}
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-neutral-500">
            {t("aiConsole.war.barSubtitle")}
          </p>

          {summary.total === 0 ? (
            <p className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-6 text-center text-[10px] leading-5 text-neutral-600">
              {t("aiConsole.war.chartEmpty")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {summary.buckets.map((bucket) => (
                <div key={bucket.key}>
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="flex items-center gap-1.5 text-neutral-300">
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: bucket.color }}
                      />
                      {t(bucket.labelKey)}
                    </span>
                    <span className="font-mono text-neutral-400">
                      {formatInteger(bucket.count)} ·{" "}
                      {formatPercent(bucket.ratio)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${Math.round(bucket.ratio * 100)}%`,
                        backgroundColor: bucket.color,
                      }}
                    />
                  </div>
                  {bucket.examples.length > 0 ? (
                    <p className="mt-1 truncate text-[9px] text-neutral-600">
                      {bucket.examples.join(" / ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <TacticsPanel
        config={config}
        onConfigChange={setConfig}
        reasonCounts={snapshot.reasonCounts}
      />

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015]">
        <div className="flex flex-col justify-between gap-2 border-b border-white/[0.06] p-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">
              {t("aiConsole.war.listTitle")}
            </h3>
            <p className="mt-1 text-[10px] leading-4 text-neutral-600">
              {t("aiConsole.war.listHint")}
            </p>
          </div>
          <span className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-neutral-400">
            {t("aiConsole.war.count", {
              count: formatInteger(visibleLeads.length),
            })}
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("aiConsole.war.searchPlaceholder")}
              aria-label={t("aiConsole.war.searchPlaceholder")}
              className="h-9 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[#d4af37]/30 lg:max-w-xs"
            />
            <div
              role="group"
              aria-label={t("aiConsole.war.filterLabel")}
              className="flex flex-wrap gap-1.5"
            >
              {LEAD_FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={filter === option}
                  onClick={() => void selectFilter(option)}
                  disabled={loading}
                  className={`h-8 rounded-lg border px-2.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    filter === option
                      ? "border-[#d4af37]/30 bg-[#d4af37]/10 text-[#f0d27c]"
                      : "border-white/[0.06] text-neutral-500 hover:border-white/10 hover:text-neutral-300"
                  }`}
                >
                  {t(LEAD_FILTER_LABEL_KEYS[option])}
                </button>
              ))}
            </div>
          </div>

          <div
            className={`overflow-x-auto rounded-xl border border-white/[0.06] transition-opacity ${
              loading ? "opacity-60" : ""
            }`}
            aria-busy={loading}
          >
            <table className="w-full min-w-[760px] text-left text-[11px]">
              <thead className="bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <tr>
                  <th className="px-3 py-2.5 font-medium">
                    {t("aiConsole.war.tableBrand")}
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    {t("aiConsole.war.tableContact")}
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    {t("aiConsole.war.tableStatus")}
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    {t("aiConsole.war.tableReason")}
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    {t("aiConsole.war.tableUpdated")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {t("aiConsole.war.tableAction")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {visibleLeads.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-[10px] text-neutral-600"
                    >
                      {t("aiConsole.war.tableEmpty")}
                    </td>
                  </tr>
                ) : (
                  visibleLeads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="transition-colors hover:bg-white/[0.02]"
                    >
                      <td
                        className="max-w-[180px] truncate px-3 py-2.5 font-medium text-neutral-200"
                        title={lead.brandName}
                      >
                        {lead.brandName}
                      </td>
                      <td
                        className="max-w-[200px] truncate px-3 py-2.5 font-mono text-[10px] text-neutral-400"
                        title={lead.tgOrEmail}
                      >
                        {lead.tgOrEmail}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusPill status={lead.status} />
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-2.5 text-neutral-400">
                        {lead.failReason ?? t("aiConsole.war.noReason")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[10px] text-neutral-600">
                        {formatDate(lead.updatedAt, locale)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenChat(lead)}
                          className="h-8 rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-2.5 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/15"
                        >
                          {t("aiConsole.war.actionGo")}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-3">
      <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-600">
        {label}
      </p>
      <p
        className={`mt-1.5 truncate text-lg font-semibold ${
          accent ?? "text-neutral-100"
        }`}
        title={value}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[9px] text-neutral-600">{hint}</p>
      ) : null}
    </div>
  );
}

function FailureDonut({
  summary,
  caption,
}: {
  summary: FailureSummary;
  caption: string;
}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const visibleBuckets = summary.buckets.filter((bucket) => bucket.count > 0);

  // 用前面扇区的比例和累加 offset，避免在渲染期间修改可变变量。
  const segments = visibleBuckets.map((bucket, index) => {
    const dash = bucket.ratio * circumference;
    const offset = visibleBuckets
      .slice(0, index)
      .reduce((sum, item) => sum + item.ratio * circumference, 0);

    return {
      key: bucket.key,
      color: bucket.color,
      dash,
      offset,
    };
  });

  return (
    <div className="relative h-40 w-40 shrink-0">
      <svg
        viewBox="0 0 140 140"
        className="h-40 w-40 -rotate-90"
        role="img"
        aria-label={caption}
      >
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="14"
        />
        {segments.map((segment) => (
          <circle
            key={segment.key}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="14"
            strokeDasharray={`${segment.dash} ${
              circumference - segment.dash
            }`}
            strokeDashoffset={-segment.offset}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold text-neutral-100">
          {formatInteger(summary.total)}
        </span>
        <span className="mt-0.5 max-w-[92px] text-center text-[9px] uppercase leading-4 tracking-[0.12em] text-neutral-600">
          {caption}
        </span>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: SerializedLeadRecord["status"] }) {
  const { t } = useLanguage();

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] ${statusPillClass(
        status,
      )}`}
    >
      {t(LEAD_STATUS_LABEL_KEYS[status])}
    </span>
  );
}

function statusPillClass(status: SerializedLeadRecord["status"]) {
  switch (status) {
    case "success":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
    case "failed":
      return "border-red-400/20 bg-red-400/10 text-red-300";
    default:
      return "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]";
  }
}
