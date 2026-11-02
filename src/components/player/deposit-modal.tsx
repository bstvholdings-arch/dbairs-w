"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatCurrency } from "@/lib/currency";
import {
  GATEWAY_BANK_FIELD_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import {
  GATEWAY_BANK_DETAIL_FIELDS,
  type GatewayBankDetails,
} from "@/lib/payment-gateway-bank";
import type { GatewayTypeValue } from "@/lib/payment-gateway-constants";

export type PlayerDepositGateway = {
  id: string;
  name: string;
  providerType: string;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string;
  hasQrCodeImage: boolean;
  hasBankDetails: boolean;
};

type AmountLimits = { min: string; max: string };

type GatewayListResponse = {
  gateways?: PlayerDepositGateway[];
  amountLimits?: AmountLimits;
  /** false = 该商户一条收款通道都没配；true = 配了但当前不可用。 */
  merchantConfigured?: boolean;
  error?: string;
};

/** /api/deposit/create 返回的统一收款指令（CRYPTO / FIAT 二选一）。 */
type PaymentInstructions = {
  kind: "CRYPTO" | "FIAT";
  amount: string;
  currency: string;
  walletAddress: string | null;
  network: string | null;
  qrCodeData: string | null;
  qrCodeDataWithAmount: string | null;
  bankDetails: GatewayBankDetails | null;
  qrCodeImageUrl: string | null;
  paymentUrl: string | null;
};

type CreatedDeposit = {
  orderId: string;
  orderNo: string;
  amount: string;
  currency: string;
  gatewayName: string;
  instructions: PaymentInstructions;
  canSimulateCallback: boolean;
};

type CreateDepositResponse = {
  success?: boolean;
  orderNo?: string;
  order?: {
    id: string;
    orderNo?: string;
    amount: string;
    currency: string;
    gatewayName: string;
  };
  paymentInstructions?: PaymentInstructions;
  canSimulateCallback?: boolean;
  amountLimits?: AmountLimits;
  error?: string;
};

type TestCallbackResponse = {
  success?: boolean;
  replayed?: boolean;
  balance?: string | null;
  error?: string;
};

const DEFAULT_AMOUNT_LIMITS: AmountLimits = { min: "10", max: "50000" };
const QUICK_AMOUNTS = ["10", "50", "100", "500"];
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

function providerLabel(providerType: string, t: TFunction) {
  const key =
    GATEWAY_PROVIDER_LABEL_KEYS[
      providerType as keyof typeof GATEWAY_PROVIDER_LABEL_KEYS
    ];

  return key ? t(key) : providerType;
}

function formatMoney(value: string, currency: string) {
  // 符号由充值通道币种决定（MYR → RM、USDT → USDT、USD → $），见 src/lib/currency.ts
  return formatCurrency(value, currency, { maximumFractionDigits: 6 });
}

function bankRows(details: GatewayBankDetails, t: TFunction) {
  return GATEWAY_BANK_DETAIL_FIELDS.map((field) => ({
    key: field.key,
    label: t(GATEWAY_BANK_FIELD_LABEL_KEYS[field.key]),
    value: details[field.key].trim(),
    multiline: Boolean(field.multiline),
  })).filter((field) => Boolean(field.value));
}

/**
 * 前台大厅充值弹窗（黑金风格）。
 *
 * 流程：输入金额 + 选择系统已启用的支付网关 → POST /api/deposit/create
 * → 展示收款信息（USDT 钱包地址 + 一键复制 / 法币银行账号 + 收款码）
 * → 等待支付商回调自动上分（1-3 分钟）。
 *
 * 安全说明：
 * - 身份完全由 httpOnly 玩家 Cookie 决定，前端不传 playerId，避免越权代充；
 * - 金额前后端都会校验（默认 10 ~ 50,000），服务端 parseDepositAmount 为最终口径；
 * - 订单状态只会由带签名的支付商回调改变，「我已完成支付（测试）」按钮
 *   只在非生产环境出现，且复用正式回调的状态机。
 */
export function PlayerDepositModal({
  open,
  playerName,
  onClose,
  onDeposited,
}: {
  open: boolean;
  playerName?: string;
  onClose: () => void;
  onDeposited?: (balance?: string | null) => void;
}) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [gateways, setGateways] = useState<PlayerDepositGateway[]>([]);
  const [limits, setLimits] = useState<AmountLimits>(DEFAULT_AMOUNT_LIMITS);
  const [gatewayId, setGatewayId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedDeposit | null>(null);
  const [creditedBalance, setCreditedBalance] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    // 注意：这里不在 effect 体里同步 setState（会触发级联渲染），
    // loading 初值即 true，异步请求结束后再一次性落地结果。
    void (async () => {
      try {
        const response = await fetch("/api/deposit/gateways", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const data: GatewayListResponse = await response
          .json()
          .catch(() => ({}) as GatewayListResponse);

        if (!active) {
          return;
        }

        if (!response.ok) {
          setLoadError(
            data.error ||
              (response.status === 401
                ? t("player.deposit.loginRequired")
                : t("player.deposit.loadFailed")),
          );
          return;
        }

        const available = data.gateways ?? [];

        if (available.length === 0) {
          // 去中心化支付：充值通道完全由商户自己配置。
          // merchantConfigured=false 说明该商户从未接入支付商，需要引导玩家联系客服。
          setLoadError(
            t(
              data.merchantConfigured === false
                ? "player.deposit.merchantNoChannels"
                : "player.deposit.noGateways",
            ),
          );
          return;
        }

        setLoadError("");
        setGateways(available);
        setGatewayId((current) => current || available[0].id);

        if (data.amountLimits) {
          setLimits(data.amountLimits);
        }
      } catch {
        if (!active || controller.signal.aborted) {
          return;
        }

        setLoadError(t("common.networkError"));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, t]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const selectedGateway =
    gateways.find((gateway) => gateway.id === gatewayId) ?? null;
  const currency = selectedGateway?.currency ?? "USDT";

  async function copyToClipboard(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? "" : current));
      }, 1600);
    } catch {
      setError(t("player.deposit.copyFailed"));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmed = amount.trim();
    const value = Number(trimmed);

    if (!AMOUNT_PATTERN.test(trimmed) || !Number.isFinite(value)) {
      setError(t("player.deposit.amountInvalid"));
      return;
    }

    if (value < Number(limits.min)) {
      setError(t("player.deposit.amountTooSmall", { min: limits.min }));
      return;
    }

    if (value > Number(limits.max)) {
      setError(t("player.deposit.amountTooLarge", { max: limits.max }));
      return;
    }

    if (!gatewayId) {
      setError(t("player.deposit.noGateways"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/deposit/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ gatewayId, amount: trimmed }),
      });
      const data: CreateDepositResponse = await response
        .json()
        .catch(() => ({}) as CreateDepositResponse);

      if (!response.ok || !data.success || !data.order) {
        setError(data.error || t("player.deposit.createFailed"));
        return;
      }

      if (data.amountLimits) {
        setLimits(data.amountLimits);
      }

      const instructions = data.paymentInstructions;
      const orderNo = data.order.orderNo ?? data.orderNo ?? data.order.id;

      setCreated({
        orderId: data.order.id,
        orderNo,
        amount: data.order.amount,
        currency: data.order.currency,
        gatewayName: data.order.gatewayName,
        canSimulateCallback: Boolean(data.canSimulateCallback),
        instructions: instructions ?? {
          kind: "FIAT",
          amount: data.order.amount,
          currency: data.order.currency,
          walletAddress: null,
          network: null,
          qrCodeData: null,
          qrCodeDataWithAmount: null,
          bankDetails: null,
          qrCodeImageUrl: null,
          paymentUrl: null,
        },
      });
      setCreditedBalance(null);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSimulate() {
    if (!created || simulating) {
      return;
    }

    setSimulating(true);
    setError("");

    try {
      const response = await fetch("/api/deposit/test-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orderId: created.orderId }),
      });
      const data: TestCallbackResponse = await response
        .json()
        .catch(() => ({}) as TestCallbackResponse);

      if (!response.ok || !data.success) {
        setError(data.error || t("player.deposit.createFailed"));
        return;
      }

      setCreditedBalance(data.balance ?? null);
      onDeposited?.(data.balance ?? null);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSimulating(false);
    }
  }

  const errorBanner = error ? (
    <div
      aria-live="polite"
      className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3.5 py-2.5 text-[11px] leading-5 text-red-300"
    >
      {error}
    </div>
  ) : null;

  function copyButton(key: string, value: string) {
    return (
      <button
        type="button"
        onClick={() => void copyToClipboard(key, value)}
        className="shrink-0 rounded-lg border border-[#d4af37]/30 px-2.5 py-1 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
      >
        {copiedKey === key ? t("player.deposit.copied") : t("player.deposit.copy")}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("player.deposit.title")}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#d4af37]/25 bg-[#080808] shadow-[0_30px_120px_-25px_rgba(212,175,55,0.45)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#d4af37]/10 bg-[radial-gradient(circle_at_top_left,rgba(212,175,55,0.16),transparent_60%)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-[#f0d27c]">
              {t("player.deposit.title")}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-neutral-500">
              {created ? t("player.deposit.payNotice") : t("player.deposit.subtitle")}
            </p>
            {playerName ? (
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("player.deposit.forPlayer", { name: playerName })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-10 text-center">
              <span
                aria-hidden="true"
                className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[#d4af37]/25 border-t-[#f0d27c]"
              />
              <p className="mt-4 text-xs text-neutral-400">
                {t("player.deposit.loading")}
              </p>
            </div>
          ) : loadError ? (
            <div className="py-6 text-center">
              <span
                aria-hidden="true"
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-red-400/30 bg-red-400/10 text-lg text-red-300"
              >
                !
              </span>
              <p className="mt-3 text-xs leading-5 text-neutral-300">
                {loadError}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border border-white/10 px-4 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
              >
                {t("common.close")}
              </button>
            </div>
          ) : created ? (
            <>
              <div className="rounded-xl border border-[#d4af37]/25 bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,0.12),transparent_65%)] px-4 py-3 text-center">
                <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                  {t("player.deposit.payAmount")}
                </p>
                <p className="mt-1 font-mono text-2xl text-[#f0d27c]">
                  {formatMoney(created.amount, created.currency)}
                </p>
                <p className="mt-1 text-[10px] text-neutral-600">
                  {created.gatewayName}
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("player.deposit.orderNo")}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-[11px] text-neutral-300">
                    {created.orderNo}
                  </span>
                  {copyButton("orderNo", created.orderNo)}
                </span>
              </div>

              {created.instructions.kind === "CRYPTO" ? (
                <div className="mt-3 rounded-xl border border-[#d4af37]/20 bg-black/40 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("player.deposit.walletAddress")}
                    </span>
                    {created.instructions.network ? (
                      <span className="rounded-full border border-[#d4af37]/30 px-2 py-0.5 text-[9px] tracking-[0.14em] text-[#f0d27c]">
                        {created.instructions.network}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-neutral-200">
                      {created.instructions.walletAddress}
                    </code>
                    {copyButton(
                      "wallet",
                      created.instructions.walletAddress ?? "",
                    )}
                  </div>
                  {(created.instructions.qrCodeDataWithAmount ??
                  created.instructions.qrCodeData) ? (
                    <div className="mt-3 flex justify-center rounded-lg bg-white p-2.5">
                      <QRCodeSVG
                        value={
                          (created.instructions.qrCodeDataWithAmount ??
                            created.instructions.qrCodeData) as string
                        }
                        size={148}
                      />
                    </div>
                  ) : null}
                  <p className="mt-2 text-[10px] leading-4 text-neutral-600">
                    {t("player.deposit.scanHint")}
                  </p>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {created.instructions.bankDetails ? (
                    <div className="rounded-xl border border-[#d4af37]/20 bg-black/40 px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                        {t("player.deposit.bankTitle")}
                      </p>
                      <dl className="mt-2 space-y-2">
                        {bankRows(created.instructions.bankDetails, t).map(
                          (row) => (
                            <div
                              key={row.key}
                              className="flex items-start justify-between gap-2"
                            >
                              <dt className="w-24 shrink-0 text-[10px] leading-5 text-neutral-600">
                                {row.label}
                              </dt>
                              <dd
                                className={`min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-neutral-200 ${
                                  row.multiline ? "whitespace-pre-wrap" : ""
                                }`}
                              >
                                {row.value}
                              </dd>
                              {copyButton(`bank-${row.key}`, row.value)}
                            </div>
                          ),
                        )}
                      </dl>
                      <p className="mt-2 text-[10px] leading-4 text-neutral-600">
                        {t("player.deposit.bankHint", {
                          orderNo: created.orderNo,
                        })}
                      </p>
                    </div>
                  ) : null}

                  {created.instructions.qrCodeImageUrl ? (
                    <div className="rounded-xl border border-[#d4af37]/20 bg-black/40 px-4 py-3 text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={created.instructions.qrCodeImageUrl}
                        alt={t("player.deposit.staticQrHint")}
                        className="mx-auto max-h-56 w-auto rounded-lg bg-white p-2"
                      />
                      <p className="mt-2 text-[10px] text-neutral-600">
                        {t("player.deposit.staticQrHint")}
                      </p>
                    </div>
                  ) : null}

                  {created.instructions.paymentUrl ? (
                    <a
                      href={created.instructions.paymentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-10 items-center justify-center rounded-xl border border-[#d4af37]/35 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
                    >
                      {t("player.deposit.paymentUrl")} ↗
                    </a>
                  ) : null}
                </div>
              )}

              <div className="mt-4 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.06] px-3.5 py-2.5 text-[11px] leading-5 text-[#e8cf8a]">
                {t("player.deposit.payNotice")}
              </div>

              {creditedBalance ? (
                <p className="mt-3 text-center text-[11px] text-emerald-300">
                  {t("player.deposit.testPaidDone", {
                    balance: creditedBalance,
                  })}
                </p>
              ) : null}

              {errorBanner}

              <div className="mt-4 flex gap-2">
                {created.canSimulateCallback && !creditedBalance ? (
                  <button
                    type="button"
                    onClick={() => void handleSimulate()}
                    disabled={simulating}
                    className="h-10 flex-1 rounded-xl border border-[#d4af37]/35 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {simulating
                      ? t("player.deposit.testPaidPending")
                      : t("player.deposit.testPaid")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setCreated(null);
                    setCreditedBalance(null);
                    setError("");
                  }}
                  className="h-10 flex-1 rounded-xl border border-white/10 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
                >
                  {t("player.deposit.editOrder")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreated(null);
                    setCreditedBalance(null);
                    setAmount("");
                    setError("");
                  }}
                  className="h-10 flex-1 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] shadow-[0_14px_36px_-14px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-90"
                >
                  {t("player.deposit.newOrder")}
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("player.deposit.gatewayLabel")}
                </span>
                <select
                  value={gatewayId}
                  onChange={(event) => setGatewayId(event.target.value)}
                  className={inputClass}
                >
                  {gateways.map((gateway) => (
                    <option
                      key={gateway.id}
                      value={gateway.id}
                      className="bg-[#0a0a0a]"
                    >
                      {gateway.name} ·{" "}
                      {providerLabel(gateway.providerType, t)} ·{" "}
                      {gateway.currency}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-4 block">
                <span className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  <span>{t("player.deposit.amountLabel", { currency })}</span>
                  <span className="font-mono normal-case tracking-normal text-neutral-700">
                    {t("player.deposit.amountRange", {
                      min: limits.min,
                      max: limits.max,
                    })}
                  </span>
                </span>
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("player.deposit.amountPlaceholder")}
                  className={`${inputClass} font-mono text-lg`}
                />
              </label>

              <div className="mt-2 grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.filter(
                  (value) =>
                    Number(value) >= Number(limits.min) &&
                    Number(value) <= Number(limits.max),
                ).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAmount(value)}
                    className={`h-8 rounded-lg border font-mono text-[11px] transition-colors ${
                      amount === value
                        ? "border-[#d4af37]/50 bg-[#d4af37]/15 text-[#f0d27c]"
                        : "border-white/[0.08] bg-white/[0.02] text-neutral-500 hover:border-[#d4af37]/25 hover:text-neutral-300"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>

              {errorBanner}

              <button
                type="submit"
                disabled={submitting}
                className="mt-5 h-11 w-full rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] shadow-[0_14px_36px_-14px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? t("player.deposit.submitting")
                  : t("player.deposit.submit")}
              </button>

              <p className="mt-3 text-center text-[10px] leading-5 text-neutral-600">
                {t("player.deposit.payNotice")}
              </p>
            </form>
          )}
        </div>

        <div className="border-t border-[#d4af37]/10 bg-[#060606] px-5 py-3">
          <p className="text-center text-[9px] uppercase tracking-[0.18em] text-neutral-700">
            DBAIRS · Deposit
          </p>
        </div>
      </section>
    </div>
  );
}
