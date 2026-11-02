"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
  GATEWAY_REVIEW_STATUS_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction, TranslationKey } from "@/lib/i18n-types";
import type { IntegrationGatewayRow } from "@/lib/integrations";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { IntegrationCard } from "./integration-card";
import { SearchBox } from "./search-box";
import { matchesSearch, searchDebounceDelay } from "./types";

/** 未知的系统枚举值直接回显原值，避免出现空白单元格。 */
function dictLabel(
  dict: Record<string, TranslationKey>,
  value: string,
  t: TFunction,
): string {
  const key = dict[value];

  return key ? t(key) : value;
}

function statusBadgeClass(kind: "active" | "inactive" | "pending") {
  if (kind === "active") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }

  if (kind === "pending") {
    return "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]";
  }

  return "border-white/10 bg-white/[0.03] text-neutral-500";
}

/**
 * 页签 3：Payment Gateways（支付通道）。
 *
 * 只读清单：这里只展示通道归属、审核状态与脱敏后的 API Key。
 * 真正的增删改（含密钥）统一在 /admin/gateways 完成，
 * 页签顶部给出跳转入口，避免两套表单各改一半导致配置漂移。
 */
export function PaymentGatewaysTab({
  gateways,
}: {
  gateways: IntegrationGatewayRow[];
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");

  const debouncedQuery = useDebouncedValue(
    query,
    searchDebounceDelay(gateways.length),
  );

  const filtered = useMemo(
    () =>
      gateways.filter((gateway) =>
        matchesSearch(debouncedQuery, [
          gateway.name,
          gateway.providerType,
          gateway.gatewayType,
          gateway.currency,
          gateway.endpoint,
          gateway.ownerName,
          gateway.reviewStatus,
        ]),
      ),
    [gateways, debouncedQuery],
  );

  const platformCount = gateways.filter(
    (gateway) => gateway.isPlatformGateway,
  ).length;

  return (
    <IntegrationCard
      title={t("integrations.gateways.title")}
      hint={t("integrations.gateways.hint")}
      actions={
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[#d4af37]/15 bg-white/[0.02] px-2.5 py-1 text-[10px] text-neutral-500">
            {t("integrations.gateways.count", {
              count: gateways.length,
              platform: platformCount,
            })}
          </span>
          <Link
            href="/admin/gateways"
            className="h-8 rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-3 text-[10px] font-semibold leading-8 text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20"
          >
            {t("integrations.gateways.manage")}
          </Link>
        </div>
      }
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={t("integrations.gateways.searchPlaceholder")}
          ariaLabel={t("integrations.gateways.searchAria")}
          className="w-full sm:max-w-sm"
        />
        <span className="text-[10px] text-neutral-600">
          {t("integrations.search.matched", {
            shown: filtered.length,
            total: gateways.length,
          })}
        </span>
      </div>

      <div className="-mx-5 -mb-5 overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left">
          <thead>
            <tr className="border-y border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
              <th className="px-5 py-3 font-medium">
                {t("integrations.gateways.column.name")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("integrations.gateways.column.type")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("integrations.gateways.column.currency")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("integrations.gateways.column.endpoint")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("integrations.gateways.column.key")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("integrations.gateways.column.owner")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("integrations.gateways.column.review")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("integrations.providers.column.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-5 py-10 text-center text-xs text-neutral-600"
                >
                  {gateways.length === 0
                    ? t("integrations.gateways.empty")
                    : t("integrations.search.noMatch")}
                </td>
              </tr>
            ) : (
              filtered.map((gateway) => {
                const reviewed = gateway.reviewStatus === "APPROVED";
                const pending = gateway.reviewStatus === "PENDING";

                return (
                  <tr
                    key={gateway.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"
                  >
                    <td className="px-5 py-3.5">
                      <p
                        className="truncate text-sm font-medium text-neutral-200"
                        title={gateway.name}
                      >
                        {gateway.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                        {gateway.id}
                      </p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-[11px] text-neutral-300">
                        {dictLabel(
                          GATEWAY_PROVIDER_LABEL_KEYS,
                          gateway.providerType,
                          t,
                        )}
                      </p>
                      <p className="mt-0.5 text-[10px] text-neutral-600">
                        {dictLabel(
                          GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
                          gateway.gatewayType,
                          t,
                        )}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-neutral-300">
                      {gateway.currency}
                    </td>
                    <td className="max-w-[240px] px-5 py-3.5">
                      <span
                        className="block truncate font-mono text-[11px] text-neutral-400"
                        title={gateway.endpoint}
                      >
                        {gateway.endpoint ||
                          t("integrations.providers.notConfigured")}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {gateway.hasKey ? (
                        <span className="font-mono text-[11px] text-[#f0d27c]">
                          {gateway.maskedKey}
                        </span>
                      ) : (
                        <span className="text-[10px] text-neutral-600">
                          {t("integrations.gateways.noKey")}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {gateway.isPlatformGateway ? (
                        <span className="text-[11px] text-neutral-300">
                          {t("integrations.gateways.platformOwner")}
                        </span>
                      ) : (
                        <span className="text-[11px] text-neutral-300">
                          {gateway.ownerName ||
                            t("integrations.gateways.unknownOwner")}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] ${statusBadgeClass(
                          reviewed
                            ? "active"
                            : pending
                              ? "pending"
                              : "inactive",
                        )}`}
                      >
                        {dictLabel(
                          GATEWAY_REVIEW_STATUS_KEYS,
                          gateway.reviewStatus,
                          t,
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] ${statusBadgeClass(
                          gateway.isActive ? "active" : "inactive",
                        )}`}
                      >
                        {gateway.isActive
                          ? t("integrations.providers.status.active")
                          : t("integrations.providers.status.inactive")}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </IntegrationCard>
  );
}
