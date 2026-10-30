"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { GatewayFormModal } from "@/app/admin/gateways/gateway-form-modal";
import type {
  GatewayMutationResponse,
  GatewayRow,
  GatewayTenantOption,
} from "@/app/admin/gateways/types";
import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import {
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
  GATEWAY_REVIEW_STATUS_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import {
  formatGatewayRatePercent,
  formatGatewayRateSpread,
} from "@/lib/payment-gateway-rates";

import { GatewayReviewModal } from "./gateway-review-modal";

type Tab = "platform" | "review";

type ReviewModalState = {
  gateway: GatewayRow;
  decision: "APPROVED" | "REJECTED";
};

function providerLabel(providerType: string, t: TFunction) {
  const key =
    GATEWAY_PROVIDER_LABEL_KEYS[
      providerType as keyof typeof GATEWAY_PROVIDER_LABEL_KEYS
    ];

  return key ? t(key) : providerType;
}

function gatewayTypeLabel(
  gatewayType: GatewayRow["gatewayType"],
  t: TFunction,
) {
  const key = GATEWAY_PAYMENT_TYPE_LABEL_KEYS[gatewayType];

  return key ? t(key) : gatewayType;
}

function reviewStatusClass(status: GatewayRow["reviewStatus"]) {
  switch (status) {
    case "APPROVED":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
    case "REJECTED":
      return "border-red-400/20 bg-red-400/10 text-red-300";
    default:
      return "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]";
  }
}

function activeStatusClass(isActive: boolean) {
  return isActive
    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
    : "border-white/10 bg-white/[0.03] text-neutral-500";
}

function configSummary(gateway: GatewayRow, t: TFunction) {
  switch (gateway.gatewayType) {
    case "STATIC_QR":
      return t("payments.summary.staticQr", { currency: gateway.currency });
    case "BANK_TRANSFER": {
      const details = gateway.bankDetails;
      const bank =
        details?.bankName ||
        details?.accountName ||
        t("payments.summary.bankTransfer");
      const account =
        details?.accountNumber || details?.iban || details?.payId || "";
      const suffix = account ? ` · ••••${account.slice(-4)}` : "";

      return `${bank}${suffix} · ${gateway.currency}`;
    }
    case "REDIRECT_URL": {
      try {
        return t("payments.summary.redirect", {
          target: new URL(gateway.endpoint).host,
        });
      } catch {
        return t("payments.summary.redirect", {
          target: gateway.endpoint || t("common.notConfigured"),
        });
      }
    }
    case "DYNAMIC_QR":
      if (gateway.walletAddress) {
        return t("payments.summary.usdtWallet", {
          suffix: gateway.walletAddress.slice(-6),
        });
      }

      try {
        return t("payments.summary.dynamicQr", {
          target: new URL(gateway.endpoint).host,
        });
      } catch {
        return t("payments.summary.dynamicQr", {
          target: gateway.endpoint || t("common.notConfigured"),
        });
      }
    default:
      return gateway.currency;
  }
}

function RateCell({ cost, sell }: { cost: string; sell: string }) {
  const negative = Number(sell) < Number(cost);
  const { t } = useLanguage();

  return (
    <div className="space-y-1 font-mono text-[10px] leading-4">
      <p className="text-neutral-500">
        {t("payments.rate.cost")}{" "}
        <span className="text-neutral-300">
          {formatGatewayRatePercent(cost)}
        </span>
      </p>
      <p className="text-neutral-500">
        {t("payments.rate.sell")}{" "}
        <span className="text-[#f0d27c]">
          {formatGatewayRatePercent(sell)}
        </span>
      </p>
      <p className={negative ? "text-red-300" : "text-emerald-300"}>
        {t("payments.rate.profit", {
          value: formatGatewayRateSpread(cost, sell),
        })}
      </p>
    </div>
  );
}

function StatusDot({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function PaymentsAdminClient({
  initialGateways,
  tenants,
}: {
  initialGateways: GatewayRow[];
  tenants: GatewayTenantOption[];
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [gateways, setGateways] = useState(initialGateways);
  const [tab, setTab] = useState<Tab>("platform");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<{
    mode: "create" | "edit";
    gateway?: GatewayRow;
  } | null>(null);
  const [reviewModal, setReviewModal] = useState<ReviewModalState | null>(null);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLowerCase();

  const platformGateways = useMemo(
    () =>
      gateways.filter(
        (gateway) =>
          gateway.isPlatformGateway &&
          (!normalizedQuery ||
            gateway.name.toLowerCase().includes(normalizedQuery) ||
            providerLabel(gateway.providerType, t)
              .toLowerCase()
              .includes(normalizedQuery) ||
            (gateway.ownerName ?? "").toLowerCase().includes(normalizedQuery)),
      ),
    [gateways, normalizedQuery, t],
  );

  const tenantGateways = useMemo(
    () =>
      gateways
        .filter(
          (gateway) =>
            !gateway.isPlatformGateway &&
            (!normalizedQuery ||
              gateway.name.toLowerCase().includes(normalizedQuery) ||
              (gateway.ownerName ?? "")
                .toLowerCase()
                .includes(normalizedQuery) ||
              providerLabel(gateway.providerType, t)
                .toLowerCase()
                .includes(normalizedQuery)),
        )
        .sort((a, b) => {
          const rank = { PENDING: 0, REJECTED: 1, APPROVED: 2 } as const;
          return rank[a.reviewStatus] - rank[b.reviewStatus];
        }),
    [gateways, normalizedQuery, t],
  );

  const platformActiveCount = platformGateways.filter(
    (gateway) => gateway.isActive,
  ).length;
  const pendingReviewCount = gateways.filter(
    (gateway) =>
      !gateway.isPlatformGateway && gateway.reviewStatus === "PENDING",
  ).length;
  const averagePayinSpread =
    platformGateways.length > 0
      ? platformGateways.reduce(
          (total, gateway) =>
            total +
            (Number(gateway.payinSellRate) - Number(gateway.payinCostRate)),
          0,
        ) / platformGateways.length
      : 0;

  function handleSaved(saved: GatewayRow) {
    setGateways((current) => {
      const exists = current.some((gateway) => gateway.id === saved.id);

      if (!exists) {
        return [saved, ...current];
      }

      return current.map((gateway) =>
        gateway.id === saved.id ? saved : gateway,
      );
    });
    setBanner({
      type: "success",
      text:
        modal?.mode === "create"
          ? t("payments.banner.created")
          : t("payments.banner.saved"),
    });
    setModal(null);
    router.refresh();
  }

  function handleReviewed(reviewed: GatewayRow) {
    setGateways((current) =>
      current.map((gateway) =>
        gateway.id === reviewed.id ? reviewed : gateway,
      ),
    );
    setBanner({
      type: "success",
      text:
        reviewed.reviewStatus === "APPROVED"
          ? t("payments.banner.reviewApproved", { name: reviewed.name })
          : t("payments.banner.reviewRejected", { name: reviewed.name }),
    });
    setReviewModal(null);
    router.refresh();
  }

  async function handleToggle(gateway: GatewayRow) {
    setPendingId(gateway.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/gateways/${gateway.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !gateway.isActive }),
      });
      const data: GatewayMutationResponse = await response
        .json()
        .catch(() => ({}) as GatewayMutationResponse);

      if (response.status === 401) {
        router.replace("/login?next=/admin/payments");
        return;
      }

      if (!response.ok || !data.success || !data.gateway) {
        setBanner({
          type: "error",
          text: data.error || t("payments.banner.toggleFailed"),
        });
        return;
      }

      const saved = data.gateway;

      setGateways((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      setBanner({
        type: "success",
        text: saved.isActive
          ? t("payments.banner.enabled", { name: saved.name })
          : t("payments.banner.disabled", { name: saved.name }),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("payments.banner.toggleNetwork") });
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(gateway: GatewayRow) {
    const confirmed = window.confirm(
      t("payments.confirm.delete", { name: gateway.name }),
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(gateway.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/gateways/${gateway.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (response.status === 401) {
        router.replace("/login?next=/admin/payments");
        return;
      }

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("payments.banner.deleteFailed"),
        });
        return;
      }

      setGateways((current) =>
        current.filter((item) => item.id !== gateway.id),
      );
      setBanner({
        type: "success",
        text: t("payments.banner.deleted", { name: gateway.name }),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("payments.banner.deleteNetwork") });
    } finally {
      setDeletingId(null);
    }
  }

  const busy = pendingId !== null || deletingId !== null;

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("payments.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("payments.admin.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
            {t("payments.admin.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "platform" ? (
            <button
              type="button"
              onClick={() => setModal({ mode: "create" })}
              className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 sm:self-auto"
            >
              <span className="text-base leading-none">+</span>
              {t("payments.admin.addPlatform")}
            </button>
          ) : null}
        </div>
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
            aria-label={t("payments.closeBannerAria")}
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          {
            labelKey: "payments.metric.platformGateways",
            value: String(
              gateways.filter((gateway) => gateway.isPlatformGateway).length,
            ),
            hintKey: "payments.metric.platformGatewaysHint",
          },
          {
            labelKey: "payments.metric.activeGateways",
            value: String(platformActiveCount),
            hintKey: "payments.metric.activeGatewaysHint",
          },
          {
            labelKey: "payments.metric.pendingReviews",
            value: String(pendingReviewCount),
            hintKey: "payments.metric.pendingReviewsHint",
          },
          {
            labelKey: "payments.metric.avgPayinSpread",
            value: formatGatewayRatePercent(averagePayinSpread),
            hintKey: "payments.metric.avgPayinSpreadHint",
          },
        ] as const).map((card) => (
          <article
            key={card.labelKey}
            className="relative overflow-hidden rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] via-[#0b0b0b] to-[#080808] p-5"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/60 to-transparent" />
            <p className="text-xs text-neutral-500">{t(card.labelKey)}</p>
            <p className="mt-4 font-mono text-2xl font-semibold text-[#f5e6b8]">
              {card.value}
            </p>
            <p className="mt-4 text-[11px] leading-5 text-neutral-600">
              {t(card.hintKey)}
            </p>
          </article>
        ))}
      </section>

      <div className="mt-6 flex flex-col justify-between gap-3 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-2 sm:flex-row sm:items-center">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTab("platform")}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs transition-colors ${
              tab === "platform"
                ? "bg-[#d4af37]/10 text-[#f0d27c]"
                : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            {t("payments.tab.platform")}
            <span className="rounded-full border border-[#d4af37]/20 px-1.5 py-0.5 font-mono text-[9px]">
              {platformGateways.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab("review")}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs transition-colors ${
              tab === "review"
                ? "bg-[#d4af37]/10 text-[#f0d27c]"
                : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            {t("payments.tab.review")}
            {pendingReviewCount > 0 ? (
              <span className="rounded-full border border-[#d4af37]/30 bg-[#d4af37]/15 px-1.5 py-0.5 font-mono text-[9px] text-[#f0d27c]">
                {pendingReviewCount}
              </span>
            ) : null}
          </button>
        </div>

        <label className="relative block sm:w-64">
          <span className="sr-only">{t("payments.searchAria")}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("payments.searchPlaceholder")}
            className="h-9 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50"
          />
        </label>
      </div>

      {tab === "platform" ? (
        <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d4af37]/10 px-5 py-4">
            <div>
              <h2 className="text-sm font-medium text-neutral-200">
                {t("payments.section.platformTitle")}
              </h2>
              <p className="mt-1 text-[10px] text-neutral-600">
                {t("payments.section.platformSubtitle")}
              </p>
            </div>
            <span className="rounded-full border border-[#d4af37]/15 bg-[#d4af37]/5 px-2.5 py-1 font-mono text-[10px] text-[#d4af37]/80">
              {t("payments.section.channelCount", {
                count: platformGateways.length,
              })}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1440px] text-left">
              <thead>
                <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  <th className="px-5 py-3 font-medium">{t("payments.table.channel")}</th>
                  <th className="px-5 py-3 font-medium">
                    {t("payments.table.paymentTypeCurrency")}
                  </th>
                  <th className="px-5 py-3 font-medium">{t("payments.table.payin")}</th>
                  <th className="px-5 py-3 font-medium">{t("payments.table.payout")}</th>
                  <th className="px-5 py-3 font-medium">
                    {t("payments.table.settlement")}
                  </th>
                  <th className="px-5 py-3 font-medium">{t("payments.table.orders")}</th>
                  <th className="px-5 py-3 font-medium">{t("payments.table.status")}</th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t("payments.table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {platformGateways.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-14 text-center text-xs text-neutral-600"
                    >
                      {t("payments.empty.platform")}
                    </td>
                  </tr>
                ) : (
                  platformGateways.map((gateway) => {
                    const toggling = pendingId === gateway.id;
                    const deleting = deletingId === gateway.id;
                    const rowBusy = toggling || deleting;

                    return (
                      <tr
                        key={gateway.id}
                        className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"
                      >
                        <td className="px-5 py-4">
                          <p className="text-sm font-medium text-neutral-200">
                            {gateway.name}
                          </p>
                          <p className="mt-1 text-[10px] text-neutral-600">
                            {providerLabel(gateway.providerType, t)}
                            {gateway.ownerName
                              ? ` · ${t("payments.owner.tenant", {
                                  name: gateway.ownerName,
                                })}`
                              : ` · ${t("payments.owner.platform")}`}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-[11px] text-neutral-300">
                            {gatewayTypeLabel(gateway.gatewayType, t)}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-[#d4af37]/70">
                            {gateway.currency}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <RateCell
                            cost={gateway.payinCostRate}
                            sell={gateway.payinSellRate}
                          />
                        </td>
                        <td className="px-5 py-4">
                          <RateCell
                            cost={gateway.payoutCostRate}
                            sell={gateway.payoutSellRate}
                          />
                        </td>
                        <td className="px-5 py-4">
                          <RateCell
                            cost={gateway.settlementCostRate}
                            sell={gateway.settlementSellRate}
                          />
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-neutral-400">
                          {gateway.depositOrderCount}
                        </td>
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            onClick={() => void handleToggle(gateway)}
                            disabled={busy}
                            title={t("payments.toggleTitle")}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${activeStatusClass(
                              gateway.isActive,
                            )}`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {toggling
                              ? t("payments.status.switching")
                              : gateway.isActive
                                ? t("payments.status.active")
                                : t("payments.status.inactive")}
                          </button>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setModal({ mode: "edit", gateway })
                              }
                              disabled={rowBusy}
                              className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 disabled:opacity-50"
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(gateway)}
                              disabled={
                                rowBusy || gateway.depositOrderCount > 0
                              }
                              title={
                                gateway.depositOrderCount > 0
                                  ? t("payments.action.deleteDisabledTitle")
                                  : t("common.delete")
                              }
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
            <span>{t("payments.footer.platformNote")}</span>
            <span>{t("payments.footer.deleteNote")}</span>
          </div>
        </section>
      ) : (
        <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d4af37]/10 px-5 py-4">
            <div>
              <h2 className="text-sm font-medium text-neutral-200">
                {t("payments.review.title")}
              </h2>
              <p className="mt-1 text-[10px] text-neutral-600">
                {t("payments.review.subtitle")}
              </p>
            </div>
            <span className="rounded-full border border-[#d4af37]/15 bg-[#d4af37]/5 px-2.5 py-1 font-mono text-[10px] text-[#d4af37]/80">
              {t("payments.review.applicationCount", {
                count: tenantGateways.length,
              })}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <thead>
                <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  <th className="px-5 py-3 font-medium">
                    {t("payments.review.table.tenantGateway")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("payments.review.table.summary")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("payments.review.table.submittedAt")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("payments.review.table.status")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("payments.review.table.note")}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t("payments.table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tenantGateways.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-14 text-center text-xs text-neutral-600"
                    >
                      {t("payments.review.empty")}
                    </td>
                  </tr>
                ) : (
                  tenantGateways.map((gateway) => {
                    const deleting = deletingId === gateway.id;
                    const rowBusy = deleting || pendingId === gateway.id;

                    return (
                      <tr
                        key={gateway.id}
                        className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"
                      >
                        <td className="px-5 py-4">
                          <p className="text-sm font-medium text-neutral-200">
                            {gateway.name}
                          </p>
                          <p className="mt-1 text-[10px] text-neutral-500">
                            {gateway.ownerName ?? t("payments.review.unknownTenant")} ·{" "}
                            {providerLabel(gateway.providerType, t)}
                          </p>
                          <p className="mt-1 font-mono text-[9px] text-neutral-700">
                            {gatewayTypeLabel(gateway.gatewayType, t)} ·{" "}
                            {gateway.currency} · {gateway.apiKeyPreview}
                          </p>
                        </td>
                        <td className="max-w-[280px] px-5 py-4 text-[10px] leading-5 text-neutral-500">
                          {configSummary(gateway, t)}
                        </td>
                        <td className="px-5 py-4 font-mono text-[10px] text-neutral-500">
                          {formatDate(gateway.createdAt)}
                        </td>
                        <td className="px-5 py-4">
                          <StatusDot
                            label={t(GATEWAY_REVIEW_STATUS_KEYS[gateway.reviewStatus])}
                            className={reviewStatusClass(gateway.reviewStatus)}
                          />
                          {gateway.reviewStatus === "APPROVED" ? (
                            <p className="mt-1.5 text-[9px] text-neutral-600">
                              {gateway.isActive
                                ? t("payments.review.playerVisible")
                                : t("payments.review.inactive")}
                            </p>
                          ) : null}
                        </td>
                        <td className="max-w-[220px] px-5 py-4 text-[10px] leading-5 text-neutral-500">
                          <span
                            className="line-clamp-2"
                            title={gateway.reviewNote ?? ""}
                          >
                            {gateway.reviewNote || "—"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setModal({ mode: "edit", gateway })
                              }
                              disabled={rowBusy}
                              className="inline-flex h-8 items-center rounded-lg border border-white/10 px-3 text-[10px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-[#f0d27c] disabled:opacity-50"
                            >
                              {t("payments.review.viewEdit")}
                            </button>
                            {gateway.reviewStatus !== "APPROVED" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setReviewModal({
                                    gateway,
                                    decision: "APPROVED",
                                  })
                                }
                                disabled={rowBusy}
                                className="inline-flex h-8 items-center rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-3 text-[10px] text-emerald-300 transition-colors hover:border-emerald-400/40 hover:bg-emerald-400/10 disabled:opacity-50"
                              >
                                {t("payments.review.approve")}
                              </button>
                            ) : null}
                            {gateway.reviewStatus !== "REJECTED" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setReviewModal({
                                    gateway,
                                    decision: "REJECTED",
                                  })
                                }
                                disabled={rowBusy}
                                className="inline-flex h-8 items-center rounded-lg border border-red-400/20 px-3 text-[10px] text-red-300 transition-colors hover:border-red-400/40 hover:bg-red-400/[0.06] disabled:opacity-50"
                              >
                                {t("payments.review.reject")}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void handleDelete(gateway)}
                              disabled={
                                rowBusy || gateway.depositOrderCount > 0
                              }
                              title={
                                gateway.depositOrderCount > 0
                                  ? t("payments.action.deleteDisabledTitle")
                                  : t("common.delete")
                              }
                              className="inline-flex h-8 items-center rounded-lg border border-white/10 px-3 text-[10px] text-neutral-500 transition-colors hover:border-red-400/30 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
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

          <div className="border-t border-[#d4af37]/10 px-5 py-3 text-[10px] leading-5 text-neutral-600">
            {t("payments.review.footer")}
          </div>
        </section>
      )}

      {modal ? (
        <GatewayFormModal
          mode={modal.mode}
          gateway={modal.gateway}
          tenants={tenants}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}

      {reviewModal ? (
        <GatewayReviewModal
          gateway={reviewModal.gateway}
          decision={reviewModal.decision}
          onClose={() => setReviewModal(null)}
          onReviewed={handleReviewed}
        />
      ) : null}
    </div>
  );
}
