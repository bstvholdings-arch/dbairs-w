"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import {
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import type {
  TenantOwnGateway,
  TenantPaymentGatewayData,
} from "@/lib/tenant-payment-gateways";

import { TenantGatewayFormModal } from "./tenant-gateway-form-modal";

function providerLabel(providerType: string, t: TFunction) {
  const key =
    GATEWAY_PROVIDER_LABEL_KEYS[
      providerType as keyof typeof GATEWAY_PROVIDER_LABEL_KEYS
    ];

  return key ? t(key) : providerType;
}

function gatewayTypeLabel(gatewayType: string, t: TFunction) {
  const key =
    GATEWAY_PAYMENT_TYPE_LABEL_KEYS[
      gatewayType as keyof typeof GATEWAY_PAYMENT_TYPE_LABEL_KEYS
    ];

  return key ? t(key) : gatewayType;
}

function gatewaySummary(gateway: TenantOwnGateway, t: TFunction) {
  const summary = gateway.configurationSummaryData;

  switch (summary.kind) {
    case "STATIC_QR":
      return t("tenantPayments.summary.staticQr", {
        currency: summary.currency,
      });
    case "BANK_TRANSFER":
      return [
        summary.bankName || t("tenantPayments.summary.bankTransfer"),
        summary.account || t("tenantPayments.summary.pendingAccount"),
        summary.currency,
      ].join(" · ");
    case "REDIRECT_URL":
      return t("tenantPayments.summary.redirect", {
        target: summary.endpoint || t("tenantPayments.summary.pendingEndpoint"),
      });
    case "USDT_WALLET":
      return t("tenantPayments.summary.usdtWallet", {
        suffix: summary.walletSuffix,
      });
    case "DYNAMIC_QR":
      return t("tenantPayments.summary.dynamicQr", {
        target: summary.endpoint || t("tenantPayments.summary.pendingEndpoint"),
      });
    default:
      return summary.currency;
  }
}

function activeStatusClass(isActive: boolean) {
  return isActive
    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
    : "border-white/10 bg-white/[0.03] text-neutral-500";
}

/** 新增 / 编辑共用同一个弹窗，mode 决定请求方法（POST / PUT）。 */
type GatewayModalState =
  | { mode: "create" }
  | { mode: "edit"; gateway: TenantOwnGateway };

function upsertGateway(
  gateways: TenantOwnGateway[],
  next: TenantOwnGateway,
): TenantOwnGateway[] {
  const exists = gateways.some((gateway) => gateway.id === next.id);

  if (!exists) {
    return [next, ...gateways];
  }

  return gateways.map((gateway) => (gateway.id === next.id ? next : gateway));
}

export function TenantPaymentsClient({
  initialData,
  tenantName,
}: {
  initialData: TenantPaymentGatewayData;
  tenantName: string;
}) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [data, setData] = useState(initialData);
  const [modal, setModal] = useState<GatewayModalState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const gateways = data.ownGateways;
  const activeCount = gateways.filter((gateway) => gateway.isActive).length;
  const inactiveCount = gateways.length - activeCount;
  const currencies = Array.from(
    new Set(gateways.map((gateway) => gateway.currency).filter(Boolean)),
  );

  function handleSaved(gateway: TenantOwnGateway) {
    const isCreate = modal?.mode !== "edit";

    setData((current) => ({
      ...current,
      ownGateways: upsertGateway(current.ownGateways, gateway),
    }));
    setModal(null);
    setBanner({
      type: "success",
      text: t(
        isCreate
          ? "tenantPayments.banner.created"
          : "tenantPayments.banner.updated",
        { name: gateway.name },
      ),
    });
    router.refresh();
  }

  /** 启停：PATCH /api/tenant/gateways/[id] */
  async function handleToggle(gateway: TenantOwnGateway) {
    const nextActive = !gateway.isActive;

    if (busyId) {
      return;
    }

    setBusyId(gateway.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/tenant/gateways/${gateway.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        gateway?: TenantOwnGateway;
        error?: string;
      };

      if (response.status === 401) {
        router.replace("/login?next=/tenant/payments");
        return;
      }

      if (!response.ok || !payload.success || !payload.gateway) {
        setBanner({
          type: "error",
          text: payload.error || t("tenantPayments.error.toggle"),
        });
        return;
      }

      const updated = payload.gateway;

      setData((current) => ({
        ...current,
        ownGateways: upsertGateway(current.ownGateways, updated),
      }));
      setBanner({
        type: "success",
        text: t(
          nextActive
            ? "tenantPayments.banner.enabled"
            : "tenantPayments.banner.disabled",
          { name: gateway.name },
        ),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("common.networkError") });
    } finally {
      setBusyId(null);
    }
  }

  /** 删除：DELETE /api/tenant/gateways/[id]（已有充值订单的通道只能停用） */
  async function handleDelete(gateway: TenantOwnGateway) {
    if (busyId) {
      return;
    }

    if (
      !window.confirm(t("tenantPayments.confirm.delete", { name: gateway.name }))
    ) {
      return;
    }

    setBusyId(gateway.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/tenant/gateways/${gateway.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (response.status === 401) {
        router.replace("/login?next=/tenant/payments");
        return;
      }

      if (!response.ok || !payload.success) {
        setBanner({
          type: "error",
          text: payload.error || t("tenantPayments.error.delete"),
        });
        return;
      }

      setData((current) => ({
        ...current,
        ownGateways: current.ownGateways.filter(
          (item) => item.id !== gateway.id,
        ),
      }));
      setBanner({
        type: "success",
        text: t("tenantPayments.banner.deleted", { name: gateway.name }),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("common.networkError") });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("tenantPayments.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("tenantPayments.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
            {t("tenantPayments.subtitle", { tenant: tenantName })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 sm:self-auto"
        >
          <span className="text-base leading-none">+</span>
          {t("tenantPayments.actions.create")}
        </button>
      </header>

      {banner ? (
        <div
          className={`mt-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            banner.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-red-400/20 bg-red-400/[0.06] text-red-300"
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="shrink-0 text-current opacity-60 hover:opacity-100"
            aria-label={t("tenantPayments.closeBannerAria")}
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: t("tenantPayments.cards.total.label"),
            value: String(gateways.length),
            hint: t("tenantPayments.cards.total.hint"),
          },
          {
            label: t("tenantPayments.cards.active.label"),
            value: String(activeCount),
            hint: t("tenantPayments.cards.active.hint"),
          },
          {
            label: t("tenantPayments.cards.inactive.label"),
            value: String(inactiveCount),
            hint: t("tenantPayments.cards.inactive.hint"),
          },
          {
            label: t("tenantPayments.cards.currency.label"),
            value: currencies.length > 0 ? currencies.join(" · ") : "—",
            hint: t("tenantPayments.cards.currency.hint"),
          },
        ].map((card) => (
          <article
            key={card.label}
            className="relative overflow-hidden rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] via-[#0b0b0b] to-[#080808] p-5"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />
            <p className="text-[9px] uppercase tracking-[0.2em] text-neutral-600">
              {card.label}
            </p>
            <p className="mt-2.5 font-mono text-2xl font-semibold text-[#f0d27c]">
              {card.value}
            </p>
            <p className="mt-1.5 text-[10px] leading-5 text-neutral-600">
              {card.hint}
            </p>
          </article>
        ))}
      </section>

      <p className="mt-4 rounded-xl border border-[#d4af37]/10 bg-[#d4af37]/[0.03] px-4 py-3 text-[10px] leading-5 text-neutral-500">
        {t("tenantPayments.notice")}
      </p>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <h2 className="text-sm font-medium text-neutral-200">
              {t("tenantPayments.own.title")}
            </h2>
            <p className="mt-1 text-[10px] text-neutral-600">
              {t("tenantPayments.own.subtitle")}
            </p>
          </div>
          <span className="rounded-full border border-[#d4af37]/15 bg-[#d4af37]/5 px-2.5 py-1 font-mono text-[10px] text-[#d4af37]/80">
            {t("tenantPayments.own.count", { count: gateways.length })}
          </span>
        </div>

        {gateways.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-xs text-neutral-600">
              {t("tenantPayments.own.empty")}
            </p>
            <p className="mt-2 text-[10px] text-neutral-700">
              {t("tenantPayments.own.emptyHint")}
            </p>
            <button
              type="button"
              onClick={() => setModal({ mode: "create" })}
              className="mt-4 inline-flex h-9 items-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-4 text-[11px] font-semibold text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20"
            >
              {t("tenantPayments.actions.create")}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {gateways.map((gateway) => {
              const busy = busyId === gateway.id;

              return (
                <div
                  key={gateway.id}
                  className="flex flex-col justify-between gap-3 px-5 py-4 lg:flex-row lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-neutral-200">
                        {gateway.name}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] ${activeStatusClass(
                          gateway.isActive,
                        )}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {gateway.isActive
                          ? t("tenantPayments.own.statusActive")
                          : t("tenantPayments.own.statusInactive")}
                      </span>
                      <span className="text-[9px] text-neutral-600">
                        {gateway.isActive
                          ? t("tenantPayments.own.playerVisible")
                          : t("tenantPayments.own.playerHidden")}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-neutral-500">
                      {providerLabel(gateway.providerType, t)} ·{" "}
                      {gatewayTypeLabel(gateway.gatewayType, t)} ·{" "}
                      {gateway.currency} · {gatewaySummary(gateway, t)}
                    </p>
                    <p className="mt-1 break-all font-mono text-[9px] text-neutral-700">
                      {t("tenantPayments.own.apiKey", {
                        key: gateway.hasApiKey
                          ? gateway.apiKeyPreview
                          : t("common.notConfigured"),
                      })}{" "}
                      · {t("tenantPayments.own.submittedAt", {
                        date: formatDate(gateway.createdAt, locale),
                      })}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setModal({ mode: "edit", gateway })}
                      disabled={busy}
                      className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.08] px-3 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/45 hover:bg-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("tenantPayments.actions.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggle(gateway)}
                      disabled={busy}
                      className="inline-flex h-8 items-center rounded-lg border border-white/10 px-3 text-[10px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {gateway.isActive
                        ? t("tenantPayments.actions.disable")
                        : t("tenantPayments.actions.enable")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(gateway)}
                      disabled={busy}
                      className="inline-flex h-8 items-center rounded-lg border border-white/10 px-3 text-[10px] text-neutral-500 transition-colors hover:border-red-400/30 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-[#d4af37]/10 px-5 py-3 text-[10px] leading-5 text-neutral-600">
          {t("tenantPayments.own.footer")}
        </div>
      </section>

      {modal ? (
        <TenantGatewayFormModal
          gateway={modal.mode === "edit" ? modal.gateway : undefined}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

