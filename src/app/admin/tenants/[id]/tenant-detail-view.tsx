"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import { TENANT_STATUS_LABEL_KEYS } from "@/lib/i18n-keys";

import { TenantPointsEditor } from "./tenant-points-editor";
import type { TenantProviderPointRow } from "./types";

type TenantDetail = {
  id: string;
  name: string;
  domain: string;
  subdomain: string;
  status: string;
  withdrawalRequiredApprovals: number;
  createdAt: string;
};

function tenantStatusClass(status: string) {
  if (status === "active") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }

  if (status === "trial") {
    return "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]";
  }

  return "border-red-400/20 bg-red-400/10 text-red-300";
}

export function TenantDetailView({
  tenant,
  rows,
}: {
  tenant: TenantDetail;
  rows: TenantProviderPointRow[];
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const statusKey =
    TENANT_STATUS_LABEL_KEYS[
      tenant.status as keyof typeof TENANT_STATUS_LABEL_KEYS
    ];
  const overrideCount = rows.filter((row) => row.customPoint !== null).length;

  useEffect(() => {
    document.title = t("tenantDetail.documentTitle", { name: tenant.name });
  }, [t, tenant.name]);

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link
            href="/admin/tenants"
            className="inline-flex items-center gap-1.5 text-[10px] text-neutral-500 transition-colors hover:text-[#f0d27c]"
          >
            {t("tenantDetail.back")}
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {tenant.name}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {t("tenantDetail.subtitle")}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-[10px] ${tenantStatusClass(
            tenant.status,
          )}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {statusKey ? t(statusKey) : tenant.status}
        </span>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">
            {t("tenantDetail.domain")}
          </p>
          <p className="mt-2 truncate font-mono text-xs text-neutral-300">
            {tenant.domain}
          </p>
          <p className="mt-1 truncate text-[10px] text-neutral-600">
            {t("tenantDetail.subdomain", { value: tenant.subdomain })}
          </p>
        </article>
        <article className="rounded-xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">
            {t("tenantDetail.approvals")}
          </p>
          <p className="mt-2 font-mono text-lg text-[#f0d27c]">
            {tenant.withdrawalRequiredApprovals}
            <span className="ml-1 font-sans text-[10px] text-neutral-500">
              {t("tenants.table.approverUnit")}
            </span>
          </p>
        </article>
        <article className="rounded-xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">
            {t("tenantDetail.overrides")}
          </p>
          <p className="mt-2 font-mono text-lg text-[#f0d27c]">
            {overrideCount}
            <span className="ml-1 font-sans text-[10px] text-neutral-500">
              {t("tenantDetail.overrideTotal", { count: rows.length })}
            </span>
          </p>
        </article>
        <article className="rounded-xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">
            {t("tenantDetail.createdAt")}
          </p>
          <p className="mt-2 font-mono text-xs text-neutral-300">
            {formatDate(tenant.createdAt, locale)}
          </p>
        </article>
      </section>

      <TenantPointsEditor tenantId={tenant.id} initialRows={rows} />

      <div className="mt-5 rounded-xl border border-[#d4af37]/10 bg-[#d4af37]/[0.03] px-4 py-3 text-[11px] leading-5 text-neutral-500">
        {t("tenantDetail.footer")}
      </div>
    </div>
  );
}
