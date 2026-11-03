"use client";

import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { resolveBrandName } from "@/lib/brand";
import { formatCurrency } from "@/lib/currency";
import {
  GATEWAY_BANK_FIELD_LABEL_KEYS,
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import {
  GATEWAY_BANK_DETAIL_FIELDS,
  hasAnyGatewayBankDetail,
  type GatewayBankDetails,
} from "@/lib/payment-gateway-bank";
import type { GatewayTypeValue } from "@/lib/payment-gateway-constants";
import { notifyPlayerWalletChanged } from "@/lib/player-wallet-events";

export type DepositGatewayOption = {
  id: string;
  name: string;
  providerType: string;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string;
  hasQrCodeImage: boolean;
  hasBankDetails: boolean;
};

type CreatedOrder = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  gatewayName: string;
  providerType: string;
  gatewayType: GatewayTypeValue;
};

type CreateDepositResponse = {
  success?: boolean;
  order?: CreatedOrder;
  gatewayType?: GatewayTypeValue;
  currency?: string;
  walletAddress?: string | null;
  qrCodeImageUrl?: string | null;
  qrCodeData?: string;
  qrCodeDataWithAmount?: string;
  bankDetails?: GatewayBankDetails | null;
  paymentUrl?: string | null;
  canSimulateCallback?: boolean;
  error?: string;
};

type TestCallbackResponse = {
  success?: boolean;
  credited?: boolean;
  balance?: string | null;
  status?: string;
  error?: string;
};

const QUICK_AMOUNTS = ["10", "50", "100", "500"];
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
// 与服务端 parseDepositAmount 保持一致：默认 10 ~ 50,000
// （可用 DEPOSIT_MIN_AMOUNT / DEPOSIT_MAX_AMOUNT 覆盖，服务端为最终口径）。
const MIN_DEPOSIT_AMOUNT = 10;
const MAX_DEPOSIT_AMOUNT = 50_000;

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

function providerLabel(providerType: string, t: TFunction) {
  const key =
    GATEWAY_PROVIDER_LABEL_KEYS[
      providerType as keyof typeof GATEWAY_PROVIDER_LABEL_KEYS
    ];

  return key ? t(key) : providerType;
}

function gatewayTypeLabel(gatewayType: GatewayTypeValue, t: TFunction) {
  const key = GATEWAY_PAYMENT_TYPE_LABEL_KEYS[gatewayType];

  return key ? t(key) : gatewayType;
}

function bankDetailRows(details: GatewayBankDetails, t: TFunction) {
  return GATEWAY_BANK_DETAIL_FIELDS.map((field) => ({
    key: field.key,
    label: t(GATEWAY_BANK_FIELD_LABEL_KEYS[field.key]),
    value: details[field.key].trim(),
    multiline: Boolean(field.multiline),
  })).filter((field) => Boolean(field.value));
}

/**
 * 到账提示里的余额数字。
 *
 * 接口回传的是 `Player.balance` 的 Decimal 原样字符串（530.500000），
 * 直接拼进文案就会出现「余额 530.500000」。这里统一固定两位小数，
 * 与 formatDisplayAmount / 顶栏 BALANCE 口径完全一致。
 */
function formatAmountValue(value: string) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatPaymentAmount(value: string, currency: string) {
  // 支付页金额同样走统一币种符号（RM / $ / USDT…），不再在组件里写死
  return formatCurrency(value, currency, { maximumFractionDigits: 6 });
}

function validateAmount(value: string, t: TFunction) {
  const text = value.trim();

  if (!text) {
    return t("deposit.error.amountRequired");
  }

  if (!AMOUNT_PATTERN.test(text)) {
    return t("deposit.error.amountFormat");
  }

  const amount = Number(text);

  if (!Number.isFinite(amount) || amount <= 0) {
    return t("deposit.error.amountPositive");
  }

  if (amount < MIN_DEPOSIT_AMOUNT) {
    return t("deposit.error.amountTooSmall");
  }

  if (amount > MAX_DEPOSIT_AMOUNT) {
    return t("deposit.error.amountTooLarge");
  }

  return "";
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function DepositPaymentModal({
  playerId,
  playerName,
  gateways,
  brandName,
  onClose,
  onDepositSuccess,
}: {
  playerId?: string;
  playerName: string;
  gateways: DepositGatewayOption[];
  /** 商户品牌名（Tenant.name）：只用于弹窗页脚署名，缺省回退平台名 */
  brandName?: string;
  onClose: () => void;
  onDepositSuccess?: (balance?: string | null) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const titleId = useId();
  const [gatewayId, setGatewayId] = useState(gateways[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [includeAmount, setIncludeAmount] = useState(false);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [paymentGatewayType, setPaymentGatewayType] =
    useState<GatewayTypeValue | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [qrCodeImageUrl, setQrCodeImageUrl] = useState("");
  const [qrCodeData, setQrCodeData] = useState("");
  const [qrCodeDataWithAmount, setQrCodeDataWithAmount] = useState("");
  const [bankDetails, setBankDetails] = useState<GatewayBankDetails | null>(
    null,
  );
  const [paymentUrl, setPaymentUrl] = useState("");
  const [canSimulateCallback, setCanSimulateCallback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedBankField, setCopiedBankField] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const selectedGateway = gateways.find((gateway) => gateway.id === gatewayId);
  const selectedGatewayType =
    paymentGatewayType ?? selectedGateway?.gatewayType ?? "DYNAMIC_QR";
  const selectedIsUsdt =
    selectedGateway?.providerType.startsWith("usdt_") ?? false;
  const selectedCurrency =
    paymentCurrency ||
    selectedGateway?.currency ||
    (selectedIsUsdt ? "USDT" : "MYR");
  const busy = submitting || testing;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");

    const validation = validateAmount(amount, t);

    if (validation) {
      setError(validation);
      return;
    }

    if (!selectedGateway) {
      setError(t("deposit.error.gatewayRequired"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/deposit/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gatewayId: selectedGateway.id,
          amount: amount.trim(),
          ...(playerId ? { playerId } : {}),
        }),
      });
      const data: CreateDepositResponse = await response
        .json()
        .catch(() => ({}) as CreateDepositResponse);

      if (!response.ok || !data.success || !data.order) {
        setError(data.error || t("deposit.error.createFailed"));
        return;
      }

      const responseGatewayType =
        data.gatewayType ??
        data.order.gatewayType ??
        selectedGateway.gatewayType;
      const responseCurrency =
        data.currency ?? data.order.currency ?? selectedGateway.currency;
      const imageUrl = data.qrCodeImageUrl?.trim() ?? "";
      const address = data.walletAddress?.trim() ?? "";
      const qr = data.qrCodeData?.trim() ?? "";
      const redirectUrl = data.paymentUrl?.trim() ?? "";
      const responseBankDetails =
        data.bankDetails && hasAnyGatewayBankDetail(data.bankDetails)
          ? data.bankDetails
          : null;
      const hasUsablePayment =
        responseGatewayType === "STATIC_QR"
          ? Boolean(imageUrl)
          : responseGatewayType === "DYNAMIC_QR"
            ? Boolean(qr || address)
            : responseGatewayType === "REDIRECT_URL"
              ? Boolean(redirectUrl)
              : Boolean(responseBankDetails);

      if (!hasUsablePayment) {
        setError(t("deposit.error.missingPaymentInfo"));
        return;
      }

      setOrder(data.order);
      setPaymentGatewayType(responseGatewayType);
      setPaymentCurrency(responseCurrency);
      setWalletAddress(address);
      setQrCodeImageUrl(imageUrl);
      setQrCodeData(qr || address);
      setQrCodeDataWithAmount(
        data.qrCodeDataWithAmount ?? qr ?? address,
      );
      setBankDetails(responseBankDetails);
      setPaymentUrl(redirectUrl);
      setCanSimulateCallback(Boolean(data.canSimulateCallback));
      setIncludeAmount(false);
      setCopied(false);
      setCopiedBankField("");

      if (responseGatewayType === "REDIRECT_URL") {
        window.location.href = redirectUrl;
        return;
      }
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    try {
      await copyToClipboard(walletAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t("deposit.error.copyAddress"));
    }
  }

  async function handleCopyBankField(fieldKey: string, value: string) {
    try {
      await copyToClipboard(value);
      setCopiedBankField(fieldKey);
      window.setTimeout(() => setCopiedBankField(""), 1800);
    } catch {
      setError(t("deposit.error.copyText"));
    }
  }

  async function handleCopyAllBankDetails() {
    if (!bankDetails || !order) {
      return;
    }

    const rows = bankDetailRows(bankDetails, t);
    const text = [
      ...rows.map((row) => `${row.label}: ${row.value}`),
      `${t("deposit.orderNumber")}: ${order.id}`,
      `${t("deposit.amountDue")}: ${formatPaymentAmount(order.amount, order.currency)}`,
    ].join("\n");

    try {
      await copyToClipboard(text);
      setCopiedBankField("all");
      window.setTimeout(() => setCopiedBankField(""), 1800);
    } catch {
      setError(t("deposit.error.copyText"));
    }
  }

  async function handleSimulateCallback() {
    if (!order) {
      return;
    }

    setTesting(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await fetch("/api/deposit/test-callback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data: TestCallbackResponse = await response
        .json()
        .catch(() => ({}) as TestCallbackResponse);

      if (!response.ok || !data.success) {
        setError(data.error || t("deposit.error.testCallbackFailed"));
        return;
      }

      setOrder((current) =>
        current ? { ...current, status: "success" } : current,
      );
      setSuccessMessage(
        data.balance
          ? t("deposit.success.testCallbackWithBalance", {
              balance: formatAmountValue(data.balance),
              currency: order?.currency ?? "USDT",
            })
          : t("deposit.success.testCallback"),
      );

      // 到账已落库：广播给所有自己持有余额 state 的组件（大厅顶栏 / 玩家中心），
      // 再让 Server Component 重新取数，避免「提示已到账、Header 余额还是旧的」。
      notifyPlayerWalletChanged();
      router.refresh();

      onDepositSuccess?.(data.balance);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setTesting(false);
    }
  }

  function resetOrder() {
    setOrder(null);
    setPaymentGatewayType(null);
    setPaymentCurrency("");
    setWalletAddress("");
    setQrCodeImageUrl("");
    setQrCodeData("");
    setQrCodeDataWithAmount("");
    setBankDetails(null);
    setPaymentUrl("");
    setCanSimulateCallback(false);
    setIncludeAmount(false);
    setCopied(false);
    setCopiedBankField("");
    setSuccessMessage("");
    setError("");
  }

  const qrValue = includeAmount ? qrCodeDataWithAmount : qrCodeData;
  const orderGatewayType = order?.gatewayType ?? selectedGatewayType;
  const isStaticQrOrder = orderGatewayType === "STATIC_QR";
  const isDynamicQrOrder = orderGatewayType === "DYNAMIC_QR";
  const isRedirectOrder = orderGatewayType === "REDIRECT_URL";
  const isBankOrder = orderGatewayType === "BANK_TRANSFER";
  const isUsdtQr = isDynamicQrOrder && Boolean(walletAddress);
  const bankRows = bankDetails ? bankDetailRows(bankDetails, t) : [];
  const showManualFiatNote = isStaticQrOrder || isBankOrder;
  const paymentActionLabel =
    selectedGatewayType === "REDIRECT_URL"
      ? t("deposit.action.redirect")
      : selectedGatewayType === "BANK_TRANSFER"
        ? t("deposit.action.bank")
        : selectedGatewayType === "STATIC_QR"
          ? t("deposit.action.staticQr")
          : t("deposit.action.dynamicQr");
  const paymentHint =
    selectedGatewayType === "REDIRECT_URL"
      ? t("deposit.hint.redirect")
      : selectedGatewayType === "BANK_TRANSFER"
        ? t("deposit.hint.bank")
        : selectedGatewayType === "STATIC_QR"
          ? t("deposit.hint.staticQr")
          : selectedIsUsdt
            ? t("deposit.hint.usdt")
            : t("deposit.hint.dynamicQr");

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/85 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[#d4af37]/25 bg-[#080808] shadow-[0_30px_120px_-25px_rgba(212,175,55,0.4)] sm:rounded-3xl"
      >
        <div className="relative overflow-hidden border-b border-[#d4af37]/10 px-5 py-4">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/70 to-transparent" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/60">
                {t("deposit.eyebrow")}
              </p>
              <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
                {t("deposit.title")}
              </h2>
              <p className="mt-1 text-[11px] text-neutral-500">
                {t("deposit.player", { name: playerName })}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label={t("deposit.closeAria")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-lg leading-none text-neutral-500 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-200 disabled:opacity-50"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-5 py-5">
          {order ? (
            <>
              <div className="relative overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-gradient-to-br from-[#171207] via-[#0d0d0d] to-[#080808] px-4 py-4 text-center">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/70 to-transparent" />
                <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">
                  {t("deposit.amountDue")}
                </p>
                <p className="mt-1 font-mono text-3xl font-semibold text-[#f5e6b8]">
                  {formatPaymentAmount(order.amount, order.currency)}
                </p>
                <p className="mt-1 text-[10px] text-neutral-500">
                  {order.gatewayName} · {providerLabel(order.providerType, t)}
                </p>
              </div>

              {isStaticQrOrder ? (
                <div className="mt-4 flex justify-center rounded-2xl border border-[#d4af37]/15 bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCodeImageUrl}
                    alt={t("deposit.imageAlt.staticQr")}
                    draggable={false}
                    className="max-h-[260px] w-full max-w-[260px] rounded-lg object-contain"
                  />
                </div>
              ) : isDynamicQrOrder ? (
                <div className="mt-4 flex justify-center rounded-2xl border border-[#d4af37]/15 bg-white p-4">
                  <QRCodeSVG
                    value={qrValue}
                    size={228}
                    level="M"
                    marginSize={2}
                    bgColor="#ffffff"
                    fgColor="#090909"
                    title={t("deposit.imageAlt.qr")}
                  />
                </div>
              ) : isRedirectOrder ? (
                <div className="mt-4 rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/[0.04] p-5 text-center">
                  <p className="text-sm text-neutral-200">
                    {t("deposit.redirect.redirecting")}
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-neutral-500">
                    {t("deposit.redirect.fallback")}
                  </p>
                  <a
                    href={paymentUrl}
                    className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-6 text-xs font-bold text-[#171105]"
                  >
                    {t("deposit.redirect.continue")}
                  </a>
                </div>
              ) : null}

              {isStaticQrOrder ? (
                <>
                  <p className="mt-3 text-center text-xs leading-5 text-neutral-400">
                    {t("deposit.staticQr.instruction")}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] px-3.5 py-2.5">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("deposit.transferRemark")}
                    </span>
                    <span className="text-xs font-medium text-[#f0d27c]">
                      {playerName}
                    </span>
                  </div>
                </>
              ) : isDynamicQrOrder ? (
                <p className="mt-3 text-center text-xs leading-5 text-neutral-400">
                  {isUsdtQr
                    ? t("deposit.dynamicQr.usdtInstruction")
                    : t("deposit.dynamicQr.instruction")}
                </p>
              ) : isBankOrder ? (
                <p className="mt-3 text-center text-xs leading-5 text-neutral-400">
                  {t("deposit.bank.instruction")}
                </p>
              ) : null}

              {isUsdtQr && walletAddress ? (
                <div className="mt-4 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("deposit.walletAddress")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className="rounded-md border border-[#d4af37]/25 bg-[#d4af37]/[0.08] px-2.5 py-1 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/45 hover:bg-[#d4af37]/15"
                    >
                      {copied ? t("deposit.copied") : t("deposit.copy")}
                    </button>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] leading-5 text-[#f0d27c]">
                    {walletAddress}
                  </p>
                </div>
              ) : null}
              {isBankOrder && bankDetails ? (
                <div className="mt-4 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("deposit.bankInfo")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyAllBankDetails()}
                      className="rounded-md border border-[#d4af37]/25 bg-[#d4af37]/[0.08] px-2.5 py-1 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/45 hover:bg-[#d4af37]/15"
                    >
                      {copiedBankField === "all"
                        ? t("deposit.copiedAll")
                        : t("deposit.copyAll")}
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {bankRows.map((row) => (
                      <div
                        key={row.key}
                        className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-600">
                            {row.label}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyBankField(row.key, row.value)
                            }
                            className="shrink-0 text-[10px] text-[#d4af37]/80 underline-offset-4 hover:text-[#f0d27c] hover:underline"
                          >
                            {copiedBankField === row.key
                              ? t("deposit.copied")
                              : t("deposit.copy")}
                          </button>
                        </div>
                        <p
                          className={`mt-1 break-all font-mono text-[11px] leading-5 text-[#f0d27c] ${
                            row.multiline ? "whitespace-pre-wrap" : ""
                          }`}
                        >
                          {row.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <p className="mt-2 text-[10px] leading-5 text-neutral-600">
                    {t("deposit.bankNote")}
                  </p>
                </div>
              ) : null}



              {isUsdtQr ? (
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={includeAmount}
                    onChange={(event) => setIncludeAmount(event.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#d4af37]"
                  />
                  <span className="text-[10px] leading-5 text-neutral-500">
                    {t("deposit.includeAmount")}
                  </span>
                </label>
              ) : null}

              <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-neutral-600">
                <span className="truncate font-mono">
                  {t("deposit.orderNumberShort", {
                    id: order.id.slice(0, 8),
                  })}
                </span>
                <button
                  type="button"
                  onClick={resetOrder}
                  disabled={busy}
                  className="shrink-0 text-[#d4af37]/80 underline-offset-4 hover:text-[#f0d27c] hover:underline disabled:opacity-50"
                >
                  {t("deposit.regenerate")}
                </button>
              </div>

              {showManualFiatNote ? (
                <p className="mt-3 text-center text-[10px] leading-5 text-neutral-600">
                  {isBankOrder
                    ? t("deposit.unverified.bank")
                    : t("deposit.unverified.staticQr")}
                </p>
              ) : null}

              {order.status === "pending" && canSimulateCallback ? (
                <button
                  type="button"
                  onClick={() => void handleSimulateCallback()}
                  disabled={busy}
                  className="mt-4 h-11 w-full rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] shadow-[0_14px_36px_-14px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {testing
                    ? t("deposit.testing")
                    : t("deposit.testCallbackAction")}
                </button>
              ) : null}

              {successMessage ? (
                <div
                  aria-live="polite"
                  className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-3.5 py-2.5 text-[11px] leading-5 text-emerald-300"
                >
                  {successMessage}
                </div>
              ) : null}

              {error ? (
                <div
                  aria-live="polite"
                  className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3.5 py-2.5 text-[11px] leading-5 text-red-300"
                >
                  {error}
                </div>
              ) : null}
            </>
          ) : (
            <form onSubmit={handleCreate}>
              <div className="rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("deposit.form.player")}
                </p>
                <p className="mt-1 text-sm text-neutral-200">{playerName}</p>
                {playerId ? (
                  <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                    {playerId}
                  </p>
                ) : null}
              </div>

              <label className="mt-4 block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("deposit.form.gateway")}
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
                      {gateway.name} · {providerLabel(gateway.providerType, t)} ·{" "}
                      {gatewayTypeLabel(gateway.gatewayType, t)} ·{" "}
                      {gateway.currency}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-4 block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("deposit.form.amount", { currency: selectedCurrency })}
                </span>
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("deposit.form.amountPlaceholder")}
                  className={`${inputClass} font-mono`}
                />
              </label>

              <div className="mt-2 grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.map((value) => (
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

              {error ? (
                <div
                  aria-live="polite"
                  className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3.5 py-2.5 text-[11px] leading-5 text-red-300"
                >
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="mt-5 h-11 w-full rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] shadow-[0_14px_36px_-14px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? t("deposit.form.submitting") : paymentActionLabel}
              </button>

              <p className="mt-3 text-center text-[10px] leading-5 text-neutral-600">
                {paymentHint}
              </p>
            </form>
          )}
        </div>

        <div className="border-t border-[#d4af37]/10 bg-[#060606] px-5 py-3">
          <p className="text-center text-[9px] uppercase tracking-[0.18em] text-neutral-700">
            {t("player.payment.brandFooter", {
              brand: resolveBrandName(brandName),
            })}
          </p>
        </div>
      </section>
    </div>
  );
}

