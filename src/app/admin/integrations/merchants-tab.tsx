"use client";

import { useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import type { IntegrationTenantRow } from "@/lib/integrations";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { IntegrationCard } from "./integration-card";
import { SearchBox } from "./search-box";
import { TenantProfileModal } from "./tenant-profile-modal";
import { matchesSearch, searchDebounceDelay } from "./types";

/**
 * 页签 4：Merchant Profiles（商户对接资料）。
 *
 * 一行一个下游商户：Backend IP / Wallet Address / Contact Email /
 * 专属回调地址 / 专属 API Key。搜索框是全页最大的一个（large），
 * 商户名、域名、子域名、IP、钱包、邮箱、密钥后 4 位都参与匹配。
 *
 * 重置密钥 / 发送密钥的网络请求由页面外壳负责，本组件只负责呈现与触发，
 * 这样切页签时 loading 状态不会丢。
 */
export function MerchantsTab({
  tenants,
  busyTenant,
  onResetKey,
  onSendKey,
  onSaved,
}: {
  tenants: IntegrationTenantRow[];
  busyTenant: string | null;
  onResetKey: (tenant: IntegrationTenantRow) => void;
  onSendKey: (tenant: IntegrationTenantRow) => void;
  onSaved: (tenant: IntegrationTenantRow) => void;
}) {
  const { t, language } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<IntegrationTenantRow | null>(null);

  const debouncedQuery = useDebouncedValue(
    query,
    searchDebounceDelay(tenants.length),
  );

  const filtered = useMemo(
    () =>
      tenants.filter((tenant) =>
        matchesSearch(debouncedQuery, [
          tenant.name,
          tenant.domain,
          tenant.subdomain,
          tenant.backendIp,
          tenant.walletAddress,
          tenant.contactEmail,
          tenant.apiCallbackUrl,
          tenant.maskedKey,
          tenant.status,
        ]),
      ),
    [tenants, debouncedQuery],
  );

  return (
    <>
      <IntegrationCard
        title={t("integrations.merchants.title")}
        hint={t("integrations.merchants.hint")}
        actions={
          <span className="rounded-full border border-[#d4af37]/15 bg-white/[0.02] px-2.5 py-1 text-[10px] text-neutral-500">
            {t("integrations.merchants.count", { count: tenants.length })}
          </span>
        }
      >
        <div className="mb-4">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={t("integrations.merchants.searchPlaceholder")}
            ariaLabel={t("integrations.merchants.searchAria")}
            large
            className="w-full"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-neutral-600">
              {t("integrations.search.matched", {
                shown: filtered.length,
                total: tenants.length,
              })}
            </span>
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-[10px] text-neutral-500 transition-colors hover:text-[#f0d27c]"
              >
                {t("integrations.search.clear")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left">
            <thead>
              <tr className="border-y border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3 font-medium">
                  {t("integrations.merchants.column.merchant")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("integrations.merchants.column.backendIp")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("integrations.merchants.column.wallet")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("integrations.table.contactEmail")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("integrations.table.apiKey")}
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
                    {tenants.length === 0
                      ? t("integrations.table.empty")
                      : t("integrations.search.noMatch")}
                  </td>
                </tr>
              ) : (
                filtered.map((tenant) => {
                  const busy = busyTenant === tenant.id;
                  const sending = busyTenant === `send:${tenant.id}`;

                  return (
                    <tr
                      key={tenant.id}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"
                    >
                      <td className="px-5 py-3.5">
                        <p
                          className="truncate text-sm font-medium text-neutral-200"
                          title={tenant.name}
                        >
                          {tenant.name}
                        </p>
                        <p
                          className="mt-0.5 truncate font-mono text-[10px] text-neutral-600"
                          title={`${tenant.subdomain} · ${tenant.domain}`}
                        >
                          {tenant.domain}
                        </p>
                      </td>
                      <td className="px-5 py-3.5">
                        {tenant.backendIp ? (
                          <span className="font-mono text-[11px] text-neutral-300">
                            {tenant.backendIp}
                          </span>
                        ) : (
                          <span className="text-[11px] text-neutral-600">
                            {t("integrations.merchants.empty")}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[180px] px-5 py-3.5">
                        {tenant.walletAddress ? (
                          <span
                            className="block truncate font-mono text-[11px] text-neutral-300"
                            title={tenant.walletAddress}
                          >
                            {tenant.walletAddress}
                          </span>
                        ) : (
                          <span className="text-[11px] text-neutral-600">
                            {t("integrations.merchants.empty")}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {tenant.contactEmail ? (
                          <a
                            href={`mailto:${tenant.contactEmail}`}
                            className="break-all text-[11px] text-neutral-300 transition-colors hover:text-[#f0d27c]"
                          >
                            {tenant.contactEmail}
                          </a>
                        ) : (
                          <span className="text-[11px] text-neutral-600">
                            {t("integrations.table.noEmail")}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {tenant.hasKey ? (
                          <>
                            <span className="font-mono text-[11px] text-[#f0d27c]">
                              {tenant.maskedKey}
                            </span>
                            {tenant.apiKeyUpdatedAt ? (
                              <p className="mt-0.5 text-[10px] text-neutral-600">
                                {t("integrations.table.keyUpdatedAt", {
                                  date: formatDate(
                                    tenant.apiKeyUpdatedAt,
                                    locale,
                                  ),
                                })}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[11px] text-neutral-600">
                            {t("integrations.table.noKey")}
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditing(tenant)}
                            className="h-8 rounded-lg border border-white/10 px-2.5 text-[10px] font-medium text-neutral-300 transition-colors hover:border-[#d4af37]/40 hover:text-[#f0d27c]"
                          >
                            {t("integrations.action.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => onResetKey(tenant)}
                            disabled={busy || sending}
                            className="h-8 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-2.5 text-[10px] font-medium text-amber-200 transition-colors hover:bg-amber-400/15 disabled:opacity-50"
                          >
                            {t("integrations.action.resetKey")}
                          </button>
                          <button
                            type="button"
                            onClick={() => onSendKey(tenant)}
                            disabled={busy || sending}
                            className="h-8 rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-2.5 text-[10px] font-medium text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20 disabled:opacity-50"
                          >
                            {sending
                              ? t("integrations.action.sending")
                              : t("integrations.action.sendEmail")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </IntegrationCard>

      {editing ? (
        <TenantProfileModal
          tenant={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            onSaved(saved);
          }}
        />
      ) : null}
    </>
  );
}
