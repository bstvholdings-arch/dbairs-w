"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import {
  GAME_CARD_STYLES,
  normalizeGameCardStyle,
} from "@/lib/game-card-styles";
import { TENANT_STATUS_LABEL_KEYS } from "@/lib/i18n-keys";

import { TenantFormModal } from "./tenant-form-modal";
import type { TenantRow } from "./types";

function statusClass(status: string) {
  if (status === "active") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }

  if (status === "trial") {
    return "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]";
  }

  return "border-red-400/20 bg-red-400/10 text-red-300";
}

export function TenantsClient({
  initialTenants,
}: {
  initialTenants: TenantRow[];
}) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [tenants, setTenants] = useState(initialTenants);
  const [modal, setModal] = useState<{
    mode: "create" | "edit";
    tenant?: TenantRow;
  } | null>(null);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleSaved(saved: TenantRow) {
    setTenants((current) => {
      const exists = current.some((tenant) => tenant.id === saved.id);

      if (!exists) {
        return [saved, ...current];
      }

      return current.map((tenant) =>
        tenant.id === saved.id ? saved : tenant,
      );
    });
    setBanner({
      type: "success",
      text:
        modal?.mode === "create"
          ? t("tenants.banner.created")
          : t("tenants.banner.saved"),
    });
    // 注意：这里不关弹窗。新建商户管理员时后端会返回一次性临时密码，
    // 必须让弹窗继续显示凭据，由弹窗自己决定何时 onClose()。
    router.refresh();
  }

  async function handleDelete(tenant: TenantRow) {
    const confirmed = window.confirm(
      t("tenants.confirm.delete", { name: tenant.name }),
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(tenant.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (response.status === 401) {
        router.replace("/login?next=/admin/tenants");
        return;
      }

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("tenants.error.deleteFailed"),
        });
        return;
      }

      setTenants((current) =>
        current.filter((item) => item.id !== tenant.id),
      );
      setBanner({
        type: "success",
        text: t("tenants.banner.deleted", { name: tenant.name }),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("tenants.error.deleteNetwork") });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("tenants.header.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("tenants.header.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            {t("tenants.header.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 sm:self-auto"
        >
          <span className="text-base leading-none">+</span>
          {t("tenants.actions.create")}
        </button>
      </header>

      {banner ? (
        <div
          role="status"
          className={`mt-5 rounded-xl border px-4 py-3 text-[11px] leading-5 ${
            banner.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-red-400/20 bg-red-400/[0.06] text-red-300"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left">
            <thead>
              <tr className="border-b border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3.5 font-medium">
                  {t("tenants.table.brand")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("tenants.table.subdomain")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("tenants.table.status")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("tenants.table.approvals")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("tenants.table.createdAt")}
                </th>
                <th className="px-5 py-3.5 text-right font-medium">
                  {t("tenants.table.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-xs text-neutral-600"
                  >
                    {t("tenants.table.empty")}
                  </td>
                </tr>
              ) : (
                tenants.map((tenant) => {
                  const deleting = deletingId === tenant.id;
                  // 封面风格：老租户缺字段 / 脏数据都归一到 cyberNeon
                  const cardStyle = normalizeGameCardStyle(tenant.gameCardStyle);
                  const cardOption = GAME_CARD_STYLES[cardStyle];
                  const statusKey =
                    TENANT_STATUS_LABEL_KEYS[
                      tenant.status as keyof typeof TENANT_STATUS_LABEL_KEYS
                    ];

                  return (
                    <tr
                      key={tenant.id}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"
                    >
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/admin/tenants/${tenant.id}`}
                          className="block truncate text-sm font-medium text-neutral-200 transition-colors hover:text-[#f0d27c]"
                          title={tenant.name}
                        >
                          {tenant.name}
                        </Link>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-neutral-600">
                          {tenant.domain}
                        </p>
                        <p className="mt-0.5 truncate text-[10px]">
                          <span className="uppercase tracking-[0.14em] text-neutral-700">
                            {t("tenants.table.admin")}
                          </span>{" "}
                          {tenant.admins.length > 0 ? (
                            <span className="text-neutral-400">
                              {tenant.admins[0].email ??
                                tenant.admins[0].username}
                              {tenant.admins.length > 1
                                ? ` +${tenant.admins.length - 1}`
                                : ""}
                            </span>
                          ) : (
                            <span className="text-amber-300/70">
                              {t("tenants.table.adminNone")}
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-neutral-300">
                        {tenant.subdomain}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${statusClass(
                            tenant.status,
                          )}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {statusKey ? t(statusKey) : tenant.status}
                        </span>
                        {/* 封面风格：在这里直接显示，保存后一眼看到是否生效 */}
                        <span
                          className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-500"
                          data-tenant-row-game-card-style={cardStyle}
                        >
                          <span className="flex gap-0.5" aria-hidden="true">
                            {[
                              cardOption.swatch.frame,
                              cardOption.swatch.rim,
                              cardOption.swatch.ink,
                            ].map((color, index) => (
                              <span
                                key={`${color}-${index}`}
                                className="h-2 w-2 rounded-full border border-white/10"
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </span>
                          {t(cardOption.labelKey)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/15 bg-[#d4af37]/5 px-2.5 py-1 font-mono text-[11px] text-[#f0d27c]">
                          {tenant.withdrawalRequiredApprovals}
                          <span className="font-sans text-[9px] text-neutral-500">
                            {t("tenants.table.approverUnit")}
                          </span>
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[10px] text-neutral-600">
                        {formatDate(tenant.createdAt, locale)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* 一键进入商户后台：走 /api/admin/impersonation/start 下发票据后跳 /tenant/dashboard */}
                          <a
                            href={`/api/admin/impersonation/start?tenantId=${encodeURIComponent(tenant.id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t("tenants.actions.impersonateHint")}
                            className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/15 px-3 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:border-[#d4af37]/60 hover:bg-[#d4af37]/25"
                          >
                            {t("tenants.actions.impersonate")}
                          </a>
                          <Link
                            href={`/admin/tenants/${tenant.id}`}
                            className="inline-flex h-8 items-center rounded-lg border border-white/10 px-3 text-[10px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
                          >
                            {t("tenants.actions.points")}
                          </Link>
                          <button
                            type="button"
                            onClick={() =>
                              setModal({ mode: "edit", tenant })
                            }
                            disabled={deleting}
                            className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 disabled:opacity-50"
                          >
                            {t("common.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(tenant)}
                            disabled={deleting}
                            className="inline-flex h-8 items-center rounded-lg border border-red-400/20 px-3 text-[10px] text-red-300 transition-colors hover:border-red-400/40 hover:bg-red-400/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {deleting
                              ? t("common.deleting")
                              : t("common.delete")}
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d4af37]/10 px-5 py-3 text-[10px] text-neutral-600">
          <span>{t("tenants.footer.count", { count: tenants.length })}</span>
          <span>{t("tenants.footer.deleteNote")}</span>
        </div>
      </section>

      {modal ? (
        <TenantFormModal
          mode={modal.mode}
          tenant={modal.tenant}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

