"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import {
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
  GATEWAY_RATE_SERVICE_LABEL_KEYS,
  GATEWAY_REVIEW_STATUS_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import {
  formatGatewayRatePercent,
  GATEWAY_RATE_SERVICES,
} from "@/lib/payment-gateway-rates";
import type {
  TenantOwnGateway,
  TenantPaymentGatewayData,
  TenantPlatformGateway,
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

function reviewStatusClass(status: TenantOwnGateway["reviewStatus"]) {
  switch (status) {
    case "APPROVED":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
    case "REJECTED":
      return "border-red-400/20 bg-red-400/10 text-red-300";
    default:
      return "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]";
  }
}

function sellRate(gateway: TenantPlatformGateway, serviceKey: string) {
  if (serviceKey === "payinSellRate") {
    return gateway.payinSellRate;
  }

  if (serviceKey === "payoutSellRate") {
    return gateway.payoutSellRate;
  }

  return gateway.settlementSellRate;
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
  const [modalOpen, setModalOpen] = useState(false);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const pendingCount = data.ownGateways.filter(
    (gateway) => gateway.reviewStatus === "PENDING",
  ).length;
  const approvedCount = data.ownGateways.filter(
    (gateway) => gateway.reviewStatus === "APPROVED",
  ).length;

  function handleCreated(gateway: TenantOwnGateway) {
    setData((current) => ({
      ...current,
      ownGateways: [gateway, ...current.ownGateways],
    }));
    setModalOpen(false);
    setBanner({
      type: "success",
      text: t("tenantPayments.banner.submitted", { name: gateway.name }),
    });
    router.refresh();
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
          onClick={() => setModalOpen(true)}
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 sm:self-auto"
        >
          <span className="text-base leading-none">+</span>
          {t("tenantPayments.actions.submit")}
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
            label: t("tenantPayments.cards.platform.label"),
            value: String(data.platformGateways.length),
            hint: t("tenantPayments.cards.platform.hint"),
          },
          {
            label: t("tenantPayments.cards.own.label"),
            value: String(data.ownGateways.length),
            hint: t("tenantPayments.cards.own.hint"),
          },
          {
            label: t("tenantPayments.cards.pending.label"),
            value: String(pendingCount),
            hint: t("tenantPayments.cards.pending.hint"),
          },
          {
            label: t("tenantPayments.cards.approved.label"),
            value: String(approvedCount),
            hint: t("tenantPayments.cards.approved.hint"),
          },
        ].map((card) => (
          <article
            key={card.label}
            className="relative overflow-hidden rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] via-[#0b0b0b] to-[#080808] p-5"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/60 to-transparent" />
            <p className="text-xs text-neutral-500">{card.label}</p>
            <p className="mt-4 font-mono text-2xl font-semibold text-[#f5e6b8]">
              {card.value}
            </p>
            <p className="mt-4 text-[11px] leading-5 text-neutral-600">
              {card.hint}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-neutral-200">
              {t("tenantPayments.platform.title")}
            </h2>
            <p className="mt-1 text-[10px] text-neutral-600">
              {t("tenantPayments.platform.subtitle")}
            </p>
          </div>
          <span className="rounded-full border border-[#d4af37]/15 bg-[#d4af37]/5 px-2.5 py-1 font-mono text-[10px] text-[#d4af37]/80">
            {t("tenantPayments.platform.count", {
              count: data.platformGateways.length,
            })}
          </span>
        </div>

        {data.platformGateways.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-[#0a0a0a]/50 px-5 py-12 text-center text-xs text-neutral-600">
            {t("tenantPayments.platform.empty")}
          </div>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {data.platformGateways.map((gateway) => (
              <article
                key={gateway.id}
                className="relative overflow-hidden rounded-2xl border border-[#d4af37]/12 bg-gradient-to-br from-[#101010] via-[#0b0b0b] to-[#080808] p-5"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/50 to-transparent" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-100">
                      {gateway.name}
                    </h3>
                    <p className="mt-1 text-[10px] text-neutral-500">
                      {providerLabel(gateway.providerType, t)} ·{" "}
                      {gatewayTypeLabel(gateway.gatewayType, t)} ·{" "}
                      {gateway.currency}
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[9px] text-emerald-300">
                    {t("tenantPayments.platform.available")}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {GATEWAY_RATE_SERVICES.map((service) => (
                    <div
                      key={service.key}
                      className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5"
                    >
                      <p className="text-[9px] text-neutral-600">
                        {t(GATEWAY_RATE_SERVICE_LABEL_KEYS[service.key]).split(
                          " ",
                        )[0]}
                      </p>
                      <p className="mt-1 font-mono text-sm text-[#f0d27c]">
                        {formatGatewayRatePercent(
                          sellRate(gateway, service.sellKey),
                        )}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="mt-4 text-[9px] text-neutral-700">
                  {t("tenantPayments.platform.footer")}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

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
            {t("tenantPayments.own.count", {
              count: data.ownGateways.length,
            })}
          </span>
        </div>

        {data.ownGateways.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-xs text-neutral-600">
              {t("tenantPayments.own.empty")}
            </p>
            <p className="mt-2 text-[10px] text-neutral-700">
              {t("tenantPayments.own.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {data.ownGateways.map((gateway) => (
              <div
                key={gateway.id}
                className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-neutral-200">
                      {gateway.name}
                    </p>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] ${reviewStatusClass(
                        gateway.reviewStatus,
                      )}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {t(GATEWAY_REVIEW_STATUS_KEYS[gateway.reviewStatus])}
                    </span>
                    {gateway.reviewStatus === "APPROVED" ? (
                      <span className="text-[9px] text-neutral-600">
                        {gateway.isActive
                          ? t("tenantPayments.own.playerVisible")
                          : t("tenantPayments.own.disabled")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] text-neutral-500">
                    {providerLabel(gateway.providerType, t)} ·{" "}
                    {gatewayTypeLabel(gateway.gatewayType, t)} ·{" "}
                    {gateway.currency} · {gatewaySummary(gateway, t)}
                  </p>
                  <p className="mt-1 font-mono text-[9px] text-neutral-700">
                    {t("tenantPayments.own.apiKey", {
                      key: gateway.hasApiKey
                        ? gateway.apiKeyPreview
                        : t("common.notConfigured"),
                    })}{" "}
                    · {t("tenantPayments.own.submittedAt", {
                      date: formatDate(gateway.createdAt, locale),
                    })}
                  </p>
                  {gateway.reviewNote ? (
                    <p className="mt-2 max-w-2xl rounded-lg border border-[#d4af37]/10 bg-[#d4af37]/[0.03] px-3 py-2 text-[10px] leading-5 text-neutral-500">
                      {t("tenantPayments.own.reviewNote", {
                        note: gateway.reviewNote,
                      })}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[9px] text-neutral-700">
                  {gateway.reviewedAt
                    ? t("tenantPayments.own.reviewedAt", {
                        date: formatDate(gateway.reviewedAt, locale),
                      })
                    : t("tenantPayments.own.pendingReview")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-[#d4af37]/10 px-5 py-3 text-[10px] leading-5 text-neutral-600">
          {t("tenantPayments.own.footer")}
        </div>
      </section>

      {modalOpen ? (
        <TenantGatewayFormModal
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}
