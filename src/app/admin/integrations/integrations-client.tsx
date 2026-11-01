"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import type {
  IntegrationIpRow,
  IntegrationSnapshot,
  IntegrationTenantRow,
} from "@/lib/integrations";

import { TenantContactModal } from "./tenant-contact-modal";

/** 重置密钥后要「只显示一次」的明文密钥。 */
type IssuedKey = {
  tenantId: string;
  tenantName: string;
  apiKey: string;
};

type Banner = { type: "success" | "error"; text: string };

type IpWhitelistResponse = {
  success?: boolean;
  added?: number;
  duplicated?: number;
  invalid?: string[];
  ipWhitelist?: IntegrationIpRow[];
  error?: string;
};

type ResetKeyResponse = {
  success?: boolean;
  apiKey?: string;
  maskedKey?: string;
  apiKeyUpdatedAt?: string | null;
  error?: string;
};

type SendKeyResponse = {
  success?: boolean;
  email?: string;
  emailSent?: boolean;
  error?: string;
};

/** 卡片外壳：四个区域（A 回调地址 / B IP 白名单 / C 平台密钥 / D 商户资料）共用。 */
function Card({
  title,
  hint,
  actions,
  children,
  className = "",
}: {
  title: string;
  hint: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-neutral-100">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-neutral-500">
            {hint}
          </p>
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function IntegrationsClient({
  initialSnapshot,
}: {
  initialSnapshot: IntegrationSnapshot;
}) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [editing, setEditing] = useState<IntegrationTenantRow | null>(null);
  const [issuedKey, setIssuedKey] = useState<IssuedKey | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyTenant, setBusyTenant] = useState<string | null>(null);
  const [busyIp, setBusyIp] = useState<string | null>(null);
  const [ipInput, setIpInput] = useState("");
  const [ipNote, setIpNote] = useState("");
  const [addingIp, setAddingIp] = useState(false);

  /** 复制到剪贴板：失败时不静默，提示手动选中（http 环境没有 clipboard API）。 */
  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      setBanner({ type: "error", text: t("integrations.banner.copyFailed") });
    }
  }

  /** 重新拉取整份快照：任何写操作之后都调用，保证表格与白名单跟数据库一致。 */
  async function reload() {
    try {
      const response = await fetch("/api/admin/integrations", {
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace("/login?next=/admin/integrations");
        return;
      }

      const data = (await response.json().catch(() => null)) as
        | IntegrationSnapshot
        | null;

      if (!response.ok || !data) {
        setBanner({ type: "error", text: t("integrations.error.load") });
        return;
      }

      setSnapshot(data);
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    }
  }

  async function handleAddIps() {
    if (!ipInput.trim()) {
      setBanner({ type: "error", text: t("integrations.sectionB.invalid") });
      return;
    }

    setAddingIp(true);
    setBanner(null);

    try {
      const response = await fetch("/api/admin/integrations/ip-whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips: ipInput, note: ipNote }),
      });

      if (response.status === 401) {
        router.replace("/login?next=/admin/integrations");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as
        IpWhitelistResponse;

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("integrations.error.network"),
        });
        return;
      }

      if (data.ipWhitelist) {
        const nextWhitelist = data.ipWhitelist;
        setSnapshot((current) => ({ ...current, ipWhitelist: nextWhitelist }));
      }

      setIpInput("");
      setIpNote("");
      setBanner({
        type: "success",
        text: t("integrations.sectionB.result", {
          added: data.added ?? 0,
          duplicated: data.duplicated ?? 0,
          invalid: data.invalid?.length ?? 0,
        }),
      });
      void reload();
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    } finally {
      setAddingIp(false);
    }
  }

  async function handleRemoveIp(row: IntegrationIpRow) {
    if (!window.confirm(t("integrations.confirm.removeIp", { ip: row.ip }))) {
      return;
    }

    setBusyIp(row.id);
    setBanner(null);

    try {
      const response = await fetch(
        `/api/admin/integrations/ip-whitelist/${row.id}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("integrations.error.network"),
        });
        return;
      }

      setSnapshot((current) => ({
        ...current,
        ipWhitelist: current.ipWhitelist.filter((item) => item.id !== row.id),
      }));
      setBanner({
        type: "success",
        text: t("integrations.banner.ipRemoved", { ip: row.ip }),
      });
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    } finally {
      setBusyIp(null);
    }
  }

  async function handleResetKey(tenant: IntegrationTenantRow) {
    if (
      !window.confirm(t("integrations.confirm.resetKey", { name: tenant.name }))
    ) {
      return;
    }

    setBusyTenant(`reset:${tenant.id}`);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}/reset-key`, {
        method: "POST",
      });

      if (response.status === 401) {
        router.replace("/login?next=/admin/integrations");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as ResetKeyResponse;

      if (!response.ok || !data.success || !data.apiKey) {
        setBanner({
          type: "error",
          text: data.error || t("integrations.error.network"),
        });
        return;
      }

      setIssuedKey({
        tenantId: tenant.id,
        tenantName: tenant.name,
        apiKey: data.apiKey,
      });
      setSnapshot((current) => ({
        ...current,
        tenants: current.tenants.map((row) =>
          row.id === tenant.id
            ? {
                ...row,
                maskedKey: data.maskedKey ?? "",
                hasKey: true,
                apiKeyUpdatedAt: data.apiKeyUpdatedAt ?? null,
              }
            : row,
        ),
      }));
      setBanner({
        type: "success",
        text: t("integrations.banner.keyReset", { name: tenant.name }),
      });
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    } finally {
      setBusyTenant(null);
    }
  }

  async function handleSendKey(tenant: IntegrationTenantRow) {
    if (!tenant.contactEmail) {
      setBanner({ type: "error", text: t("integrations.error.noContactEmail") });
      return;
    }

    if (!tenant.hasKey) {
      setBanner({ type: "error", text: t("integrations.error.noKey") });
      return;
    }

    setBusyTenant(`send:${tenant.id}`);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}/send-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.status === 401) {
        router.replace("/login?next=/admin/integrations");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as SendKeyResponse;

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("integrations.error.network"),
        });
        return;
      }

      if (data.emailSent) {
        setBanner({
          type: "success",
          text: t("integrations.banner.emailSent", {
            email: data.email ?? tenant.contactEmail,
          }),
        });
      } else {
        setBanner({
          type: "error",
          text: t("integrations.banner.emailFailed", {
            error: data.error ?? "-",
          }),
        });
      }
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    } finally {
      setBusyTenant(null);
    }
  }

  function handleContactSaved() {
    const name = editing?.name ?? "";
    setEditing(null);
    setBanner({
      type: "success",
      text: t("integrations.banner.contactSaved", { name }),
    });
    void reload();
  }

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("integrations.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("integrations.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
          {t("integrations.subtitle")}
        </p>
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

      {/* 重置密钥后的明文：与「新增商户管理员」一致，只显示这一次 */}
      {issuedKey ? (
        <div className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-4 py-3.5">
          <p className="text-xs font-semibold text-emerald-200">
            {t("integrations.reset.title", { name: issuedKey.tenantName })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="select-all break-all rounded-lg border border-emerald-400/20 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-emerald-100">
              {issuedKey.apiKey}
            </code>
            <button
              type="button"
              onClick={() =>
                void copyText(`issued:${issuedKey.tenantId}`, issuedKey.apiKey)
              }
              className="h-8 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 text-[10px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/20"
            >
              {copiedId === `issued:${issuedKey.tenantId}`
                ? t("integrations.sectionA.copied")
                : t("integrations.reset.copy")}
            </button>
            <button
              type="button"
              onClick={() => setIssuedKey(null)}
              className="h-8 rounded-lg border border-white/10 px-3 text-[10px] font-medium text-neutral-400 transition-colors hover:border-white/20 hover:text-neutral-200"
            >
              {t("integrations.reset.dismiss")}
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-emerald-300/80">
            {t("integrations.reset.hint")}
          </p>
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {/* 区域 A：系统回调地址 */}
        <Card
          title={t("integrations.sectionA.title")}
          hint={t("integrations.sectionA.hint")}
        >
          <ul className="divide-y divide-white/[0.05]">
            {snapshot.endpoints.map((endpoint) => {
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
                    onClick={() => void copyText(endpoint.id, endpoint.url)}
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
        </Card>

        {/* 区域 B：全局 IP 白名单 */}
        <Card
          title={t("integrations.sectionB.title")}
          hint={t("integrations.sectionB.hint")}
          actions={
            <span className="rounded-full border border-[#d4af37]/15 bg-white/[0.02] px-2.5 py-1 text-[10px] text-neutral-500">
              {t("integrations.sectionB.count", {
                count: snapshot.ipWhitelist.length,
              })}
            </span>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <textarea
                value={ipInput}
                onChange={(event) => setIpInput(event.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={t("integrations.sectionB.placeholder")}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs leading-6 text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
              />
              <input
                type="text"
                value={ipNote}
                maxLength={120}
                onChange={(event) => setIpNote(event.target.value)}
                placeholder={t("integrations.sectionB.notePlaceholder")}
                className="h-9 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
              />
              <button
                type="button"
                onClick={() => void handleAddIps()}
                disabled={addingIp}
                className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-[11px] font-bold text-[#171105] transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {addingIp
                  ? t("integrations.sectionB.adding")
                  : t("integrations.sectionB.add")}
              </button>
            </div>

            <div className="min-w-0">
              {snapshot.ipWhitelist.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-[11px] leading-5 text-neutral-600">
                  {t("integrations.sectionB.empty")}
                </p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {snapshot.ipWhitelist.map((row) => (
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
                        onClick={() => void handleRemoveIp(row)}
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
        </Card>

        {/* 区域 C：平台级秘钥状态 */}
        <Card
          title={t("integrations.sectionC.title")}
          hint={t("integrations.sectionC.hint")}
        >
          {snapshot.platformKeys.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-[11px] text-neutral-600">
              {t("integrations.sectionC.empty")}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {snapshot.platformKeys.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="truncate text-xs font-medium text-neutral-200"
                      title={item.name}
                    >
                      {item.name}
                    </span>
                    <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-neutral-600">
                      {t(
                        item.kind === "gateway"
                          ? "integrations.sectionC.gateway"
                          : "integrations.sectionC.provider",
                      )}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[#f0d27c]/80">
                    {item.maskedKey || t("integrations.sectionC.noKey")}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-neutral-600">
                    {item.active
                      ? item.detail
                      : t("integrations.sectionC.inactive")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 区域 D：商户对接资料管理 */}
        <Card
          title={t("integrations.sectionD.title")}
          hint={t("integrations.sectionD.hint")}
        >
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-y border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  <th className="px-5 py-3 font-medium">
                    {t("integrations.table.tenant")}
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
                {snapshot.tenants.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-10 text-center text-xs text-neutral-600"
                    >
                      {t("integrations.table.empty")}
                    </td>
                  </tr>
                ) : (
                  snapshot.tenants.map((tenant) => {
                    const resetting = busyTenant === `reset:${tenant.id}`;
                    const sending = busyTenant === `send:${tenant.id}`;
                    const busy = resetting || sending;

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
                          <p className="mt-0.5 truncate font-mono text-[10px] text-neutral-600">
                            {tenant.subdomain} · {tenant.domain}
                          </p>
                        </td>
                        <td className="px-5 py-3.5">
                          {tenant.contactEmail ? (
                            <a
                              href={`mailto:${tenant.contactEmail}`}
                              className="break-all font-mono text-xs text-neutral-300 transition-colors hover:text-[#f0d27c]"
                            >
                              {tenant.contactEmail}
                            </a>
                          ) : (
                            <span className="text-[11px] text-amber-300/70">
                              {t("integrations.table.noEmail")}
                            </span>
                          )}
                        </td>
                        <td className="max-w-[280px] px-5 py-3.5">
                          {tenant.hasKey ? (
                            <>
                              <span className="font-mono text-xs text-[#f0d27c]">
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
                          <p
                            className="mt-0.5 truncate text-[10px] text-neutral-600"
                            title={tenant.apiCallbackUrl || undefined}
                          >
                            {tenant.apiCallbackUrl ||
                              t("integrations.table.defaultCallback")}
                          </p>
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
                              onClick={() => void handleResetKey(tenant)}
                              disabled={busy}
                              className="h-8 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-2.5 text-[10px] font-medium text-amber-200 transition-colors hover:bg-amber-400/15 disabled:opacity-50"
                            >
                              {t("integrations.action.resetKey")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSendKey(tenant)}
                              disabled={busy}
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
        </Card>
      </div>

      {editing ? (
        <TenantContactModal
          tenant={editing}
          onClose={() => setEditing(null)}
          onSaved={handleContactSaved}
        />
      ) : null}
    </div>
  );
}
