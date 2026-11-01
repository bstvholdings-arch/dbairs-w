"use client";

import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatPercent, formatPoint } from "@/lib/format";

type TenantProviderRow = {
  id: string;
  name: string;
  effectivePoint: string;
};

export function TenantProvidersView({
  tenantName,
  rows,
}: {
  tenantName: string;
  rows: TenantProviderRow[];
}) {
  const { t } = useLanguage();

  useEffect(() => {
    document.title = t("tenantProviders.documentTitle");
  }, [t]);

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("tenantProviders.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantProviders.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          {t("tenantProviders.subtitle", { tenant: tenantName })}
        </p>
      </header>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="flex items-center justify-between border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <h2 className="text-sm font-medium text-neutral-200">
              {t("tenantProviders.available.title")}
            </h2>
            <p className="mt-1 text-[10px] text-neutral-600">
              {t("tenantProviders.available.subtitle")}
            </p>
          </div>
          <span className="rounded-full border border-[#d4af37]/15 bg-[#d4af37]/5 px-2.5 py-1 font-mono text-[10px] text-[#d4af37]/80">
            {t("tenantProviders.available.count", { count: rows.length })}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-xs text-neutral-600">
            {t("tenantProviders.available.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  <th className="px-5 py-3 font-medium">
                    {t("tenantProviders.table.provider")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("tenantProviders.table.effectivePoint")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("tenantProviders.table.ggrShare")}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t("tenantProviders.table.status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((provider) => (
                  <tr
                    key={provider.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-5 py-4 text-sm font-medium text-neutral-200">
                      {provider.name}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-3 py-1.5 font-mono text-sm text-[#f0d27c]">
                        {formatPoint(provider.effectivePoint)}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-neutral-400">
                      {formatPercent(provider.effectivePoint)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {t("tenantProviders.status.available")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-[#d4af37]/10 px-5 py-3 text-[10px] leading-5 text-neutral-600">
          {t("tenantProviders.footer")}
        </div>
      </section>
    </div>
  );
}
