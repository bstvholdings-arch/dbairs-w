"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { TenantPayoutEngineSnapshot } from "@/lib/auto-payout";
import { formatDisplayAmount } from "@/lib/currency";
import { formatInteger } from "@/lib/format";

/**
 * 商户后台【自动出款引擎】配置面板。
 *
 * 三件事，缺一不可：
 * 1. 总开关 + 单笔上限 + 每日总额（写 Tenant.autoPayoutConfig）；
 * 2. 每条自有通道的「代付 API 地址」（写 PaymentGateway.payoutEndpoint）——
 *    这是「智能路由」判定有没有代付能力的唯一依据，没配就全部转人工；
 * 3. 现场状态：今日已自动出款多少 / 还剩多少额度 / 是否熔断 / 待人工几笔。
 *
 * 权限：平台通道不出现在列表里（后端已按 ownerId + isPlatformGateway 收口），
 * 所以商户无法把代付地址挂到平台通道上。
 */
export function TenantPayoutEnginePanel({
  initial,
}: {
  initial: TenantPayoutEngineSnapshot;
}) {
  const { t } = useLanguage();
  const router = useRouter();

  const [snapshot, setSnapshot] = useState(initial);
  const [isEnabled, setIsEnabled] = useState(initial.config.isEnabled);
  const [maxAutoAmount, setMaxAutoAmount] = useState(
    String(initial.config.maxAutoAmount),
  );
  const [dailyAutoLimit, setDailyAutoLimit] = useState(
    String(initial.config.dailyAutoLimit),
  );
  const [endpoints, setEndpoints] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial.gateways.map((gateway) => [gateway.id, gateway.payoutEndpoint]),
    ),
  );
  const [busy, setBusy] = useState<"config" | "endpoints" | null>(null);
  const [banner, setBanner] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const currency = snapshot.currency;

  function applyPayload(payload: Record<string, unknown>) {
    const next = payload as unknown as TenantPayoutEngineSnapshot;

    setSnapshot(next);
    setIsEnabled(next.config.isEnabled);
    setMaxAutoAmount(String(next.config.maxAutoAmount));
    setDailyAutoLimit(String(next.config.dailyAutoLimit));
    setEndpoints(
      Object.fromEntries(
        next.gateways.map((gateway) => [gateway.id, gateway.payoutEndpoint]),
      ),
    );
  }

  async function patch(
    body: Record<string, unknown>,
    kind: "config" | "endpoints",
  ) {
    setBusy(kind);
    setBanner(null);

    try {
      const response = await fetch("/api/tenant/payout-engine", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Record<string, unknown> & { error?: string })
        | null;

      if (!response.ok || !payload) {
        setBanner({
          tone: "error",
          text: payload?.error ?? t("tenantWithdrawals.engine.error.save"),
        });
        return;
      }

      applyPayload(payload);
      setBanner({
        tone: "ok",
        text: t(
          kind === "config"
            ? "tenantWithdrawals.engine.saved"
            : "tenantWithdrawals.engine.gateways.saved",
        ),
      });
      router.refresh();
    } catch {
      setBanner({ tone: "error", text: t("common.networkError") });
    } finally {
      setBusy(null);
    }
  }

  const statusChip = !snapshot.config.isEnabled
    ? {
        label: t("tenantWithdrawals.engine.status.disabled"),
        tone: "border-white/10 bg-white/5 text-neutral-300",
      }
    : snapshot.breakerTripped
      ? {
          label: t("tenantWithdrawals.engine.status.breaker"),
          tone: "border-red-400/30 bg-red-400/10 text-red-200",
        }
      : {
          label: t("tenantWithdrawals.engine.status.enabled"),
          tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
        };

  const stats = [
    {
      key: "today",
      label: t("tenantWithdrawals.engine.stats.today"),
      value: formatDisplayAmount(snapshot.dailyAutoPaidAmount, currency),
      hint: t("tenantWithdrawals.engine.stats.todayHint", {
        count: formatInteger(snapshot.dailyAutoCount),
      }),
    },
    {
      key: "remaining",
      label: t("tenantWithdrawals.engine.stats.remaining"),
      value: formatDisplayAmount(snapshot.dailyRemaining, currency),
      hint: t("tenantWithdrawals.engine.stats.remainingHint"),
    },
    {
      key: "pending",
      label: t("tenantWithdrawals.engine.stats.pending"),
      value: formatInteger(snapshot.pendingCount),
      hint: t("tenantWithdrawals.engine.stats.pendingHint"),
    },
    {
      key: "processing",
      label: t("tenantWithdrawals.engine.stats.processing"),
      value: formatInteger(snapshot.processingCount),
      hint: t("tenantWithdrawals.engine.stats.processingHint"),
    },
  ];

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-gradient-to-br from-[#0f0f0f] to-[#070707]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-[#f0d27c]">
            {t("tenantWithdrawals.engine.title")}
          </p>
          <p className="mt-1 text-[10px] leading-5 text-neutral-500">
            {t("tenantWithdrawals.engine.subtitle")}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusChip.tone}`}
        >
          {statusChip.label}
        </span>
      </header>

      <div className="px-4 py-4">
        {banner ? (
          <div
            role="status"
            className={`mb-3 rounded-xl border px-3 py-2 text-[11px] ${
              banner.tone === "ok"
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                : "border-red-400/25 bg-red-400/10 text-red-200"
            }`}
          >
            {banner.text}
          </div>
        ) : null}

        {snapshot.payoutReadyCount === 0 ? (
          <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2.5">
            <p className="text-[11px] font-semibold text-amber-200">
              {t("tenantWithdrawals.engine.noPayoutApi.title")}
            </p>
            <p className="mt-1 text-[10px] leading-5 text-amber-200/80">
              {t("tenantWithdrawals.engine.noPayoutApi.hint")}
            </p>
          </div>
        ) : null}

        {snapshot.breakerTripped ? (
          <div className="mb-3 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-3 py-2.5">
            <p className="text-[11px] font-semibold text-red-200">
              {t("tenantWithdrawals.engine.breaker.title")}
            </p>
            <p className="mt-1 text-[10px] leading-5 text-red-200/80">
              {t("tenantWithdrawals.engine.breaker.hint")}
            </p>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.key}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <p className="text-[9px] uppercase tracking-[0.14em] text-neutral-500">
                {stat.label}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-neutral-100">
                {stat.value}
              </p>
              <p className="mt-0.5 text-[9px] leading-4 text-neutral-600">
                {stat.hint}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
          <button
            type="button"
            onClick={() => setIsEnabled((value) => !value)}
            aria-pressed={isEnabled}
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[11px] font-semibold transition-colors ${
              isEnabled
                ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                : "border-white/10 bg-white/5 text-neutral-300"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
                isEnabled ? "bg-emerald-400/70" : "bg-neutral-600"
              }`}
            >
              <span
                className={`h-3 w-3 rounded-full bg-white transition-transform ${
                  isEnabled ? "translate-x-3" : "translate-x-0"
                }`}
              />
            </span>
            {isEnabled
              ? t("tenantWithdrawals.engine.toggleOn")
              : t("tenantWithdrawals.engine.toggleOff")}
          </button>

          <label className="text-[10px] text-neutral-400">
            <span className="block">
              {t("tenantWithdrawals.engine.maxAutoAmount")}
            </span>
            <input
              value={maxAutoAmount}
              onChange={(event) => setMaxAutoAmount(event.target.value)}
              inputMode="decimal"
              className="mt-1 h-9 w-36 rounded-lg border border-white/10 bg-black/40 px-2 font-mono text-xs text-neutral-100 outline-none focus:border-[#d4af37]/50"
            />
          </label>

          <label className="text-[10px] text-neutral-400">
            <span className="block">
              {t("tenantWithdrawals.engine.dailyAutoLimit")}
            </span>
            <input
              value={dailyAutoLimit}
              onChange={(event) => setDailyAutoLimit(event.target.value)}
              inputMode="decimal"
              className="mt-1 h-9 w-36 rounded-lg border border-white/10 bg-black/40 px-2 font-mono text-xs text-neutral-100 outline-none focus:border-[#d4af37]/50"
            />
          </label>

          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void patch(
                {
                  isEnabled,
                  maxAutoAmount: maxAutoAmount.trim(),
                  dailyAutoLimit: dailyAutoLimit.trim(),
                },
                "config",
              )
            }
            className="h-9 rounded-lg bg-gradient-to-b from-[#f0d27c] to-[#c9a02f] px-4 text-[11px] font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "config"
              ? t("tenantWithdrawals.engine.saving")
              : t("tenantWithdrawals.engine.save")}
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold text-neutral-200">
              {t("tenantWithdrawals.engine.gateways.title")}
            </p>
            <span className="font-mono text-[10px] text-neutral-500">
              {t("tenantWithdrawals.engine.gateways.count", {
                ready: formatInteger(snapshot.payoutReadyCount),
                total: formatInteger(snapshot.gateways.length),
              })}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-5 text-neutral-500">
            {t("tenantWithdrawals.engine.gateways.hint")}
          </p>

          {snapshot.gateways.length === 0 ? (
            <p className="mt-3 rounded-lg border border-white/[0.06] bg-black/30 px-3 py-3 text-[10px] text-neutral-500">
              {t("tenantWithdrawals.engine.gateways.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {snapshot.gateways.map((gateway) => (
                <li
                  key={gateway.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.05] bg-black/30 px-3 py-2"
                >
                  <div className="min-w-[150px] flex-1">
                    <p className="text-[11px] font-medium text-neutral-200">
                      {gateway.name}
                    </p>
                    <p className="font-mono text-[9px] text-neutral-500">
                      {gateway.providerType}
                      {gateway.isActive
                        ? ""
                        : ` · ${t("tenantWithdrawals.engine.gateways.inactive")}`}
                    </p>
                  </div>
                  <input
                    value={endpoints[gateway.id] ?? ""}
                    onChange={(event) =>
                      setEndpoints((current) => ({
                        ...current,
                        [gateway.id]: event.target.value,
                      }))
                    }
                    placeholder={t(
                      "tenantWithdrawals.engine.gateways.placeholder",
                    )}
                    className="h-9 min-w-[240px] flex-[2] rounded-lg border border-white/10 bg-black/40 px-2 font-mono text-[10px] text-neutral-100 outline-none focus:border-[#d4af37]/50"
                  />
                  <span
                    className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${
                      gateway.hasPayoutApi
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                        : "border-amber-400/30 bg-amber-400/10 text-amber-200"
                    }`}
                  >
                    {gateway.hasPayoutApi
                      ? t("tenantWithdrawals.engine.gateways.configured")
                      : t("tenantWithdrawals.engine.gateways.missing")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            disabled={busy !== null || snapshot.gateways.length === 0}
            onClick={() =>
              void patch(
                {
                  payoutEndpoints: snapshot.gateways.map((gateway) => ({
                    gatewayId: gateway.id,
                    endpoint: (endpoints[gateway.id] ?? "").trim(),
                  })),
                },
                "endpoints",
              )
            }
            className="mt-3 h-9 rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 text-[11px] font-semibold text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "endpoints"
              ? t("tenantWithdrawals.engine.saving")
              : t("tenantWithdrawals.engine.gateways.save")}
          </button>
        </div>
      </div>
    </section>
  );
}
