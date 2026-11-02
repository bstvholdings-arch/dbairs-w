"use client";

import { useLanguage } from "@/components/LanguageProvider";
import type {
  IntegrationEndpointView,
  IntegrationIpRow,
} from "@/lib/integrations";

import { IntegrationCard } from "./integration-card";

/**
 * 页签 1：Global Settings（全局设置）。
 *
 * 三块内容：
 *   A. 系统回调地址（交给游戏商 / 支付商配置的 webhook，可一键复制）
 *   B. 全局 IP 白名单（批量粘贴 IPv4 / IPv6 / CIDR）
 *   C. 白名单来源 IP 汇总提示
 *
 * 全部状态由页面外壳持有（ipInput / ipNote / addingIp / busyIp / copiedId），
 * 这样切到其它页签再切回来，用户已经粘贴好的内容不会丢。
 */
export function GlobalSettingsTab({
  baseUrl,
  endpoints,
  ipWhitelist,
  copiedId,
  onCopy,
  ipInput,
  ipNote,
  onIpInputChange,
  onIpNoteChange,
  addingIp,
  onAddIps,
  busyIp,
  onRemoveIp,
}: {
  baseUrl: string;
  endpoints: IntegrationEndpointView[];
  ipWhitelist: IntegrationIpRow[];
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
  ipInput: string;
  ipNote: string;
  onIpInputChange: (value: string) => void;
  onIpNoteChange: (value: string) => void;
  addingIp: boolean;
  onAddIps: () => void;
  busyIp: string | null;
  onRemoveIp: (row: IntegrationIpRow) => void;
}) {
  const { t } = useLanguage();
  const activeEndpoints = endpoints.filter(
    (endpoint) => endpoint.status === "active",
  ).length;

  return (
    <div className="space-y-4">
      <IntegrationCard
        title={t("integrations.sectionA.title")}
        hint={t("integrations.sectionA.hint")}
        actions={
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-[10px] text-emerald-300">
              {t("integrations.global.activeEndpoints", {
                count: activeEndpoints,
              })}
            </span>
            <button
              type="button"
              onClick={() => onCopy("base-url", baseUrl)}
              className="h-8 rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-3 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20"
            >
              {copiedId === "base-url"
                ? t("integrations.sectionA.copied")
                : t("integrations.global.copyBaseUrl")}
            </button>
          </div>
        }
      >
        <p className="mb-3 break-all rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[11px] text-neutral-400">
          {t("integrations.global.baseUrl", { url: baseUrl })}
        </p>

        <ul className="divide-y divide-white/[0.05]">
          {endpoints.map((endpoint) => {
            const live = endpoint.status === "active";

            return (
              <li
                key={endpoint.id}
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-neutral-200">
                      {t(endpoint.labelKey)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] ${
                        live
                          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                          : "border-[#d4af37]/20 bg-[#d4af37]/10 text-[#f0d27c]"
                      }`}
                    >
                      {t(
                        live
                          ? "integrations.endpoint.status.active"
                          : "integrations.endpoint.status.planned",
                      )}
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-neutral-400">
                    {endpoint.url}
                  </p>
                  <p className="mt-1 max-w-2xl text-[10px] leading-4 text-neutral-600">
                    {t(endpoint.descKey)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onCopy(endpoint.id, endpoint.url)}
                  className="h-8 shrink-0 rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-3 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20"
                >
                  {copiedId === endpoint.id
                    ? t("integrations.sectionA.copied")
                    : t("integrations.sectionA.copy")}
                </button>
              </li>
            );
          })}
        </ul>
      </IntegrationCard>

      <IntegrationCard
        title={t("integrations.sectionB.title")}
        hint={t("integrations.sectionB.hint")}
        actions={
          <span className="rounded-full border border-[#d4af37]/15 bg-white/[0.02] px-2.5 py-1 text-[10px] text-neutral-500">
            {t("integrations.sectionB.count", { count: ipWhitelist.length })}
          </span>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <textarea
              value={ipInput}
              onChange={(event) => onIpInputChange(event.target.value)}
              rows={4}
              spellCheck={false}
              placeholder={t("integrations.sectionB.placeholder")}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs leading-6 text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
            />
            <input
              type="text"
              value={ipNote}
              maxLength={120}
              onChange={(event) => onIpNoteChange(event.target.value)}
              placeholder={t("integrations.sectionB.notePlaceholder")}
              className="h-9 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
            />
            <button
              type="button"
              onClick={onAddIps}
              disabled={addingIp}
              className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-[11px] font-bold text-[#171105] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {addingIp
                ? t("integrations.sectionB.adding")
                : t("integrations.sectionB.add")}
            </button>
          </div>

          <div className="min-w-0">
            {ipWhitelist.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-[11px] leading-5 text-neutral-600">
                {t("integrations.sectionB.empty")}
              </p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {ipWhitelist.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-neutral-200">
                        {row.ip}
                      </p>
                      {row.note ? (
                        <p className="truncate text-[10px] text-neutral-600">
                          {row.note}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveIp(row)}
                      disabled={busyIp === row.id}
                      aria-label={t("integrations.sectionB.removeAria", {
                        ip: row.ip,
                      })}
                      className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-neutral-500 transition-colors hover:border-red-400/30 hover:text-red-300 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </IntegrationCard>
    </div>
  );
}
