"use client";

import { useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { IntegrationProviderRow } from "@/lib/integrations";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { IntegrationCard } from "./integration-card";
import { ProviderCredentialModal } from "./provider-credential-modal";
import { SearchBox } from "./search-box";
import { matchesSearch, searchDebounceDelay } from "./types";

/**
 * 页签 2：Game Providers（游戏商对接）。
 *
 * 一行为一个游戏商，展示对接凭据的「是否已配置」与掩码；
 * 搜索框实时过滤（游戏商名 / API Endpoint / Merchant ID 都参与匹配），
 * 【编辑】打开弹窗修改 Endpoint / Merchant ID / Secret。
 */
export function GameProvidersTab({
  providers,
  onSaved,
}: {
  providers: IntegrationProviderRow[];
  onSaved: (provider: IntegrationProviderRow) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<IntegrationProviderRow | null>(null);

  const debouncedQuery = useDebouncedValue(
    query,
    searchDebounceDelay(providers.length),
  );

  const filtered = useMemo(
    () =>
      providers.filter((provider) =>
        matchesSearch(debouncedQuery, [
          provider.name,
          provider.apiEndpoint,
          provider.merchantId,
          provider.status,
        ]),
      ),
    [providers, debouncedQuery],
  );

  return (
    <>
      <IntegrationCard
        title={t("integrations.providers.title")}
        hint={t("integrations.providers.hint")}
        actions={
          <span className="rounded-full border border-[#d4af37]/15 bg-white/[0.02] px-2.5 py-1 text-[10px] text-neutral-500">
            {t("integrations.providers.count", { count: providers.length })}
          </span>
        }
      >
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={t("integrations.providers.searchPlaceholder")}
            ariaLabel={t("integrations.providers.searchAria")}
            className="w-full sm:max-w-sm"
          />
          <span className="text-[10px] text-neutral-600">
            {t("integrations.search.matched", {
              shown: filtered.length,
              total: providers.length,
            })}
          </span>
        </div>

        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full min-w-[880px] text-left">
            <thead>
              <tr className="border-y border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3 font-medium">
                  {t("integrations.providers.column.name")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("integrations.providers.column.endpoint")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("integrations.providers.column.merchantId")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("integrations.providers.column.secret")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("integrations.providers.column.status")}
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  {t("integrations.table.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-xs text-neutral-600"
                  >
                    {providers.length === 0
                      ? t("integrations.providers.empty")
                      : t("integrations.search.noMatch")}
                  </td>
                </tr>
              ) : (
                filtered.map((provider) => (
                  <tr
                    key={provider.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"
                  >
                    <td className="px-5 py-3.5">
                      <p
                        className="truncate text-sm font-medium text-neutral-200"
                        title={provider.name}
                      >
                        {provider.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                        {provider.id}
                      </p>
                    </td>
                    <td className="max-w-[260px] px-5 py-3.5">
                      {provider.apiEndpoint ? (
                        <a
                          href={provider.apiEndpoint}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all font-mono text-[11px] text-neutral-300 transition-colors hover:text-[#f0d27c]"
                        >
                          {provider.apiEndpoint}
                        </a>
                      ) : (
                        <span className="text-[11px] text-amber-300/70">
                          {t("integrations.providers.notConfigured")}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {provider.merchantId ? (
                        <span className="font-mono text-[11px] text-neutral-300">
                          {provider.merchantId}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-300/70">
                          {t("integrations.providers.notConfigured")}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {provider.hasSecret ? (
                        <>
                          <span className="font-mono text-[11px] text-[#f0d27c]">
                            {provider.maskedSecret}
                          </span>
                          <p className="mt-0.5 text-[10px] text-emerald-300/70">
                            {t("integrations.providers.secretConfigured")}
                          </p>
                        </>
                      ) : (
                        <span className="text-[11px] text-neutral-600">
                          {t("integrations.providers.noSecret")}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] ${
                          provider.isActive
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                            : "border-white/10 bg-white/[0.03] text-neutral-500"
                        }`}
                      >
                        {provider.isActive
                          ? t("integrations.providers.status.active")
                          : t("integrations.providers.status.inactive")}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(provider)}
                        className="h-8 rounded-lg border border-white/10 px-2.5 text-[10px] font-medium text-neutral-300 transition-colors hover:border-[#d4af37]/40 hover:text-[#f0d27c]"
                      >
                        {t("integrations.action.edit")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </IntegrationCard>

      {editing ? (
        <ProviderCredentialModal
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={(provider) => {
            setEditing(null);
            onSaved(provider);
          }}
        />
      ) : null}
    </>
  );
}
