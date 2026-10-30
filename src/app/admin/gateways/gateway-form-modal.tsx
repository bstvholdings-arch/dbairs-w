"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  GATEWAY_BANK_FIELD_LABEL_KEYS,
  GATEWAY_BANK_FIELD_PLACEHOLDER_KEYS,
  GATEWAY_PAYMENT_TYPE_HINT_KEYS,
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
  GATEWAY_QR_ERROR_KEYS,
  GATEWAY_RATE_SERVICE_DESCRIPTION_KEYS,
  GATEWAY_RATE_SERVICE_LABEL_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import {
  GATEWAY_BANK_DETAIL_FIELDS,
  normalizeGatewayBankDetails,
} from "@/lib/payment-gateway-bank";
import {
  defaultGatewayCurrencyForProvider,
  defaultGatewayTypeForProvider,
} from "@/lib/payment-gateway-constants";
import {
  GATEWAY_RATE_SERVICES,
  formatGatewayRateSpread,
  validateGatewayRateInput,
} from "@/lib/payment-gateway-rates";
import {
  MAX_GATEWAY_QR_IMAGE_FILE_BYTES,
  MAX_GATEWAY_QR_IMAGE_REMOTE_URL_LENGTH,
  isInlineGatewayQrCodeImage,
  normalizeGatewayQrCodeImageUrl,
  validateGatewayQrCodeImageUrl,
} from "@/lib/payment-gateway-qr";

import {
  GATEWAY_PAYMENT_TYPE_OPTIONS,
  GATEWAY_TYPE_OPTIONS,
  type GatewayFormValues,
  type GatewayMutationResponse,
  type GatewayRow,
  type GatewayTenantOption,
} from "./types";

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

function validateForm(
  form: GatewayFormValues,
  mode: "create" | "edit",
  t: TFunction,
) {
  const name = form.name.trim();
  const walletAddress = form.walletAddress.trim();
  const qrCodeImageUrl = normalizeGatewayQrCodeImageUrl(form.qrCodeImageUrl);
  const endpoint = form.endpoint.trim();
  const apiKey = form.apiKey.trim();
  const currency = form.currency.trim().toUpperCase();
  const isUsdt = form.providerType.startsWith("usdt_");
  const bankDetails = normalizeGatewayBankDetails(form.bankDetails);

  if (!name) {
    return t("gateway.validation.nameRequired");
  }

  if (name.length > 80) {
    return t("gateway.validation.nameMax");
  }

  if (!/^[A-Z]{2,10}$/.test(currency)) {
    return t("gateway.validation.currencyInvalid");
  }

  if (isUsdt) {
    if (form.gatewayType !== "DYNAMIC_QR") {
      return t("gateway.validation.usdtDynamic");
    }

    if (currency !== "USDT") {
      return t("gateway.validation.usdtCurrency");
    }

    if (!walletAddress) {
      return t("gateway.validation.usdtWallet");
    }

    if (
      form.providerType === "usdt_trc20" &&
      !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletAddress)
    ) {
      return t("gateway.validation.trc20Invalid");
    }

    if (
      form.providerType === "usdt_erc20" &&
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
    ) {
      return t("gateway.validation.erc20Invalid");
    }
  } else if (walletAddress.length > 200) {
    return t("gateway.validation.walletMax");
  }

  if (form.gatewayType === "STATIC_QR") {
    if (!qrCodeImageUrl) {
      return t("gateway.validation.staticQrRequired");
    }

    const qrCodeImageError = validateGatewayQrCodeImageUrl(qrCodeImageUrl);

    if (qrCodeImageError) {
      const errorKey =
        GATEWAY_QR_ERROR_KEYS[
          qrCodeImageError as keyof typeof GATEWAY_QR_ERROR_KEYS
        ];

      return errorKey ? t(errorKey) : qrCodeImageError;
    }
  }

  if (form.gatewayType === "BANK_TRANSFER") {
    for (const field of GATEWAY_BANK_DETAIL_FIELDS) {
      if (bankDetails[field.key].length > field.maxLength) {
        return t("gateway.validation.bankFieldMax", {
          field: t(GATEWAY_BANK_FIELD_LABEL_KEYS[field.key]),
          max: field.maxLength,
        });
      }
    }

    if (!bankDetails.accountName) {
      return t("gateway.validation.bankNameRequired");
    }

    if (!bankDetails.accountNumber && !bankDetails.iban && !bankDetails.payId) {
      return t("gateway.validation.bankAccountRequired");
    }
  }

  const endpointRequired =
    form.gatewayType === "REDIRECT_URL" ||
    (form.gatewayType === "DYNAMIC_QR" && !isUsdt);

  if (endpointRequired && !endpoint) {
    return t("gateway.validation.endpointRequired");
  }

  if (endpointRequired && endpoint) {
    let url: URL;

    try {
      url = new URL(endpoint);
    } catch {
      return t("gateway.validation.endpointInvalid");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return t("gateway.validation.endpointProtocol");
    }
  }

  if (
    mode === "create" &&
    (form.gatewayType === "DYNAMIC_QR" ||
      form.gatewayType === "REDIRECT_URL") &&
    !apiKey
  ) {
    return t("gateway.validation.apiKeyRequired");
  }

  if (apiKey.length > 512) {
    return t("gateway.validation.apiKeyMax");
  }

  if (form.isPlatformGateway) {
    for (const service of GATEWAY_RATE_SERVICES) {
      const cost = form[service.costKey].trim();
      const sell = form[service.sellKey].trim();
      const serviceLabel = t(GATEWAY_RATE_SERVICE_LABEL_KEYS[service.key]);
      const costError = validateGatewayRateInput(cost);
      const sellError = validateGatewayRateInput(sell);

      if (costError) {
        return t("gateway.validation.rateInvalid", {
          service: serviceLabel,
          field: t("gateway.form.cost"),
        });
      }

      if (sellError) {
        return t("gateway.validation.rateInvalid", {
          service: serviceLabel,
          field: t("gateway.form.sell"),
        });
      }

      if (Number(sell) < Number(cost)) {
        return t("gateway.validation.rateSpread", {
          service: serviceLabel,
        });
      }
    }
  }

  return "";
}

export function GatewayFormModal({
  mode,
  gateway,
  tenants,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  gateway?: GatewayRow;
  tenants: GatewayTenantOption[];
  onClose: () => void;
  onSaved: (gateway: GatewayRow) => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const initialProviderType =
    (gateway?.providerType as GatewayFormValues["providerType"]) ??
    "usdt_trc20";
  const [form, setForm] = useState<GatewayFormValues>(() => ({
    name: gateway?.name ?? "",
    providerType: initialProviderType,
    gatewayType:
      gateway?.gatewayType ??
      defaultGatewayTypeForProvider(initialProviderType),
    currency:
      gateway?.currency ??
      defaultGatewayCurrencyForProvider(initialProviderType),
    walletAddress: gateway?.walletAddress ?? "",
    qrCodeImageUrl: gateway?.qrCodeImageUrl ?? "",
    bankDetails: normalizeGatewayBankDetails(gateway?.bankDetails),
    endpoint: gateway?.endpoint ?? "",
    apiKey: "",
    payinCostRate: gateway?.payinCostRate ?? "0",
    payinSellRate: gateway?.payinSellRate ?? "0",
    payoutCostRate: gateway?.payoutCostRate ?? "0",
    payoutSellRate: gateway?.payoutSellRate ?? "0",
    settlementCostRate: gateway?.settlementCostRate ?? "0",
    settlementSellRate: gateway?.settlementSellRate ?? "0",
    isPlatformGateway: gateway?.isPlatformGateway ?? true,
    isActive: gateway?.isActive ?? true,
    ownerId: gateway?.ownerId ?? "",
  }));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, submitting]);

  function updateField<Key extends keyof GatewayFormValues>(
    field: Key,
    value: GatewayFormValues[Key],
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function handleProviderTypeChange(providerType: GatewayFormValues["providerType"]) {
    setForm((previous) => ({
      ...previous,
      providerType,
      gatewayType: defaultGatewayTypeForProvider(providerType),
      currency: defaultGatewayCurrencyForProvider(providerType),
    }));
  }

  function handleBankDetailChange(
    field: keyof GatewayFormValues["bankDetails"],
    value: string,
  ) {
    setForm((previous) => ({
      ...previous,
      bankDetails: { ...previous.bankDetails, [field]: value },
    }));
  }

  function handleQrImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";

    if (!file) {
      return;
    }

    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      setError(t("gateway.validation.imageType"));
      return;
    }

    if (file.size > MAX_GATEWAY_QR_IMAGE_FILE_BYTES) {
      setError(t("gateway.validation.imageTooLarge"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== "string") {
        setError(t("gateway.validation.imageReadFailed"));
        return;
      }

      const imageError = validateGatewayQrCodeImageUrl(result);

      if (imageError) {
        const errorKey =
          GATEWAY_QR_ERROR_KEYS[
            imageError as keyof typeof GATEWAY_QR_ERROR_KEYS
          ];

        setError(errorKey ? t(errorKey) : imageError);
        return;
      }

      updateField("qrCodeImageUrl", result);
      setError("");
    };
    reader.onerror = () => setError(t("gateway.validation.imageReadFailed"));
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validation = validateForm(form, mode, t);

    if (validation) {
      setError(validation);
      return;
    }

    setSubmitting(true);

    const isUsdt = form.providerType.startsWith("usdt_");
    const isEndpointGateway =
      form.gatewayType === "REDIRECT_URL" ||
      form.gatewayType === "DYNAMIC_QR";

    try {
      const response = await fetch(
        mode === "create"
          ? "/api/admin/gateways"
          : `/api/admin/gateways/${gateway?.id}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            providerType: form.providerType,
            gatewayType: form.gatewayType,
            currency: form.currency.trim().toUpperCase(),
            walletAddress: isUsdt ? form.walletAddress.trim() || null : null,
            qrCodeImageUrl:
              form.gatewayType === "STATIC_QR"
                ? normalizeGatewayQrCodeImageUrl(form.qrCodeImageUrl) || null
                : null,
            bankDetails:
              form.gatewayType === "BANK_TRANSFER"
                ? normalizeGatewayBankDetails(form.bankDetails)
                : null,
            endpoint: isEndpointGateway ? form.endpoint.trim() : "",
            payinCostRate: form.payinCostRate.trim() || "0",
            payinSellRate: form.payinSellRate.trim() || "0",
            payoutCostRate: form.payoutCostRate.trim() || "0",
            payoutSellRate: form.payoutSellRate.trim() || "0",
            settlementCostRate: form.settlementCostRate.trim() || "0",
            settlementSellRate: form.settlementSellRate.trim() || "0",
            isPlatformGateway: form.isPlatformGateway,
            isActive: form.isActive,
            ownerId: form.ownerId || null,
            ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          }),
        },
      );
      const data: GatewayMutationResponse = await response
        .json()
        .catch(() => ({}) as GatewayMutationResponse);

      if (response.status === 401) {
        router.replace("/login?next=/admin/payments");
        return;
      }

      if (!response.ok || !data.success || !data.gateway) {
        setError(data.error || t("gateway.form.saveFailed"));
        return;
      }

      onSaved(data.gateway);
    } catch {
      setError(t("gateway.form.networkFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_120px_-30px_rgba(212,175,55,0.35)] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <p className="text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/60">
              {t("gateway.form.eyebrow")}
            </p>
            <h2
              id={titleId}
              className="mt-1 text-lg font-semibold text-white"
            >
              {mode === "create"
                ? form.isPlatformGateway
                  ? t("gateway.form.createPlatform")
                  : t("gateway.form.createTenant")
                : form.isPlatformGateway
                  ? t("gateway.form.editPlatform")
                  : t("gateway.form.editTenant")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-200 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("gateway.form.name")}
                </span>
                <input
                  ref={nameRef}
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  maxLength={80}
                  placeholder={t("gateway.form.namePlaceholder")}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("gateway.form.providerType")}
                </span>
                <select
                  value={form.providerType}
                  onChange={(event) =>
                    handleProviderTypeChange(
                      event.target.value as GatewayFormValues["providerType"],
                    )
                  }
                  className={inputClass}
                >
                  {GATEWAY_TYPE_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      className="bg-[#0a0a0a]"
                    >
                      {t(GATEWAY_PROVIDER_LABEL_KEYS[option.value])}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("gateway.form.paymentType")}
                </span>
                <select
                  value={form.gatewayType}
                  onChange={(event) =>
                    updateField(
                      "gatewayType",
                      event.target.value as GatewayFormValues["gatewayType"],
                    )
                  }
                  className={inputClass}
                >
                  {GATEWAY_PAYMENT_TYPE_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={
                        form.providerType.startsWith("usdt_") &&
                        option.value !== "DYNAMIC_QR"
                      }
                      className="bg-[#0a0a0a]"
                    >
                      {t(GATEWAY_PAYMENT_TYPE_LABEL_KEYS[option.value])}
                    </option>
                  ))}
                </select>
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t(GATEWAY_PAYMENT_TYPE_HINT_KEYS[form.gatewayType])}
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("gateway.form.currency")}
                </span>
                <input
                  value={form.currency}
                  onChange={(event) =>
                    updateField("currency", event.target.value.toUpperCase())
                  }
                  maxLength={10}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t("gateway.form.currencyPlaceholder")}
                  className={`${inputClass} font-mono uppercase`}
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t("gateway.form.currencyHint")}
                </span>
              </label>
            </div>

            {form.isPlatformGateway ? (
              <div className="rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[#d4af37]/70">
                      {t("gateway.form.platformRates")}
                    </p>
                    <p className="mt-1 text-[10px] leading-5 text-neutral-600">
                      {t("gateway.form.platformRatesHint")}
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] text-emerald-300">
                    {t("gateway.form.platformBadge")}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {GATEWAY_RATE_SERVICES.map((service) => {
                    const cost = form[service.costKey];
                    const sell = form[service.sellKey];
                    const positive = Number(sell) >= Number(cost);

                    return (
                      <div
                        key={service.key}
                        className="rounded-lg border border-white/[0.06] bg-black/30 p-3"
                      >
                        <p className="text-xs font-medium text-neutral-200">
                          {t(GATEWAY_RATE_SERVICE_LABEL_KEYS[service.key])}
                        </p>
                        <p className="mt-0.5 text-[9px] text-neutral-600">
                          {t(
                            GATEWAY_RATE_SERVICE_DESCRIPTION_KEYS[service.key],
                          )}
                        </p>
                        <label className="mt-3 block">
                          <span className="text-[9px] uppercase tracking-[0.14em] text-neutral-600">
                            {t("gateway.form.cost")}
                          </span>
                          <input
                            value={cost}
                            onChange={(event) =>
                              updateField(
                                service.costKey,
                                event.target.value,
                              )
                            }
                            inputMode="decimal"
                            spellCheck={false}
                            autoComplete="off"
                            placeholder="0.005"
                            className={`${inputClass} h-9 font-mono`}
                          />
                        </label>
                        <label className="mt-2 block">
                          <span className="text-[9px] uppercase tracking-[0.14em] text-neutral-600">
                            {t("gateway.form.sell")}
                          </span>
                          <input
                            value={sell}
                            onChange={(event) =>
                              updateField(
                                service.sellKey,
                                event.target.value,
                              )
                            }
                            inputMode="decimal"
                            spellCheck={false}
                            autoComplete="off"
                            placeholder="0.008"
                            className={`${inputClass} h-9 font-mono`}
                          />
                        </label>
                        <p
                          className={`mt-2 font-mono text-[10px] ${
                            positive ? "text-emerald-300" : "text-red-300"
                          }`}
                        >
                          {t("gateway.form.spread", {
                            value: formatGatewayRateSpread(cost, sell),
                          })}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 text-[10px] leading-5 text-neutral-500">
                {t("gateway.form.tenantRateNote")}
              </div>
            )}

            {form.gatewayType === "DYNAMIC_QR" &&
            form.providerType.startsWith("usdt_") ? (
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("gateway.form.walletAddress")}
                </span>
                <input
                  value={form.walletAddress}
                  onChange={(event) =>
                    updateField("walletAddress", event.target.value)
                  }
                  maxLength={200}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={
                    form.providerType === "usdt_erc20"
                      ? t("gateway.form.walletPlaceholderErc20")
                      : t("gateway.form.walletPlaceholderTrc20")
                  }
                  className={`${inputClass} font-mono`}
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t("gateway.form.walletHint")}
                </span>
              </label>
            ) : null}

            {form.gatewayType === "STATIC_QR" ? (
              <div className="rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("gateway.form.qrSection")}
                  </span>
                  {form.qrCodeImageUrl ? (
                    <button
                      type="button"
                      onClick={() => updateField("qrCodeImageUrl", "")}
                      className="text-[10px] text-red-300/80 underline-offset-4 transition-colors hover:text-red-200 hover:underline"
                    >
                      {t("gateway.form.clearImage")}
                    </button>
                  ) : null}
                </div>

                {isInlineGatewayQrCodeImage(form.qrCodeImageUrl) ? (
                  <p className="mt-2 break-all rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-2 text-[10px] leading-5 text-emerald-300/80">
                    {t("gateway.form.localImageNote")}
                  </p>
                ) : (
                  <input
                    value={form.qrCodeImageUrl}
                    onChange={(event) =>
                      updateField("qrCodeImageUrl", event.target.value)
                    }
                    maxLength={MAX_GATEWAY_QR_IMAGE_REMOTE_URL_LENGTH}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="https://cdn.example.com/tng-qr.png"
                    className={inputClass}
                  />
                )}

                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("gateway.form.upload")}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleQrImageUpload}
                    className="mt-1.5 block w-full cursor-pointer text-[11px] text-neutral-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[#d4af37]/10 file:px-3 file:py-2 file:text-[11px] file:text-[#f0d27c] hover:file:bg-[#d4af37]/15"
                  />
                </label>

                {form.qrCodeImageUrl ? (
                  <div className="mt-3 flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.qrCodeImageUrl}
                      alt={t("gateway.form.qrPreviewAlt")}
                      className="h-24 w-24 shrink-0 rounded-md bg-white object-contain p-1"
                    />
                    <p className="min-w-0 text-[10px] leading-5 text-neutral-500">
                      {t("gateway.form.qrPreviewNote")}
                    </p>
                  </div>
                ) : null}

                <span className="mt-2 block text-[10px] leading-5 text-neutral-600">
                  {t("gateway.form.qrHint")}
                </span>
              </div>
            ) : null}
            {form.gatewayType === "BANK_TRANSFER" ? (
              <div className="rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("gateway.form.bankSection")}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateField(
                        "bankDetails",
                        normalizeGatewayBankDetails(null),
                      )
                    }
                    className="text-[10px] text-red-300/80 underline-offset-4 transition-colors hover:text-red-200 hover:underline"
                  >
                    {t("gateway.form.clear")}
                  </button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {GATEWAY_BANK_DETAIL_FIELDS.map((field) =>
                    field.multiline ? (
                      <label key={field.key} className="block sm:col-span-2">
                        <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                          {t(GATEWAY_BANK_FIELD_LABEL_KEYS[field.key])}
                        </span>
                        <textarea
                          value={form.bankDetails[field.key]}
                          onChange={(event) =>
                            handleBankDetailChange(
                              field.key,
                              event.target.value,
                            )
                          }
                          maxLength={field.maxLength}
                          rows={3}
                          placeholder={t(
                            GATEWAY_BANK_FIELD_PLACEHOLDER_KEYS[field.key],
                          )}
                          className={`${inputClass} h-auto min-h-20 py-2`}
                        />
                      </label>
                    ) : (
                      <label key={field.key} className="block">
                        <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                          {t(GATEWAY_BANK_FIELD_LABEL_KEYS[field.key])}
                        </span>
                        <input
                          value={form.bankDetails[field.key]}
                          onChange={(event) =>
                            handleBankDetailChange(
                              field.key,
                              event.target.value,
                            )
                          }
                          maxLength={field.maxLength}
                          spellCheck={false}
                          autoComplete="off"
                          placeholder={t(
                            GATEWAY_BANK_FIELD_PLACEHOLDER_KEYS[field.key],
                          )}
                          className={inputClass}
                        />
                      </label>
                    ),
                  )}
                </div>

                <p className="mt-2 text-[10px] leading-5 text-neutral-600">
                  {t("gateway.form.bankHint")}
                </p>
              </div>
            ) : null}


            {form.gatewayType === "REDIRECT_URL" ||
            form.gatewayType === "DYNAMIC_QR" ? (
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {form.gatewayType === "REDIRECT_URL"
                    ? t("gateway.form.endpointRedirect")
                    : t("gateway.form.endpointDynamic")}
                </span>
                <input
                  value={form.endpoint}
                  onChange={(event) =>
                    updateField("endpoint", event.target.value)
                  }
                  placeholder="https://pay.example.com/checkout"
                  className={inputClass}
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {form.gatewayType === "REDIRECT_URL"
                    ? t("gateway.form.endpointHintRedirect")
                    : form.providerType.startsWith("usdt_")
                      ? t("gateway.form.endpointHintUsdt")
                      : t("gateway.form.endpointHintDynamic")}
                </span>
              </label>
            ) : null}

            {form.gatewayType === "REDIRECT_URL" ||
            form.gatewayType === "DYNAMIC_QR" ? (
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("gateway.form.apiKey")}
                </span>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(event) =>
                    updateField("apiKey", event.target.value)
                  }
                  autoComplete="new-password"
                  placeholder={
                    mode === "edit"
                      ? t("gateway.form.apiKeyPlaceholderEdit", {
                          preview: gateway?.apiKeyPreview ?? "",
                        })
                      : t("gateway.form.apiKeyPlaceholderCreate")
                  }
                  className={inputClass}
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t("gateway.form.apiKeyHint")}
                </span>
              </label>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("gateway.form.owner")}
                </span>
                <select
                  value={form.ownerId}
                  onChange={(event) =>
                    updateField("ownerId", event.target.value)
                  }
                  className={inputClass}
                >
                  <option value="" className="bg-[#0a0a0a]">
                    {t("gateway.form.ownerPlatform")}
                  </option>
                  {tenants.map((tenant) => (
                    <option
                      key={tenant.id}
                      value={tenant.id}
                      className="bg-[#0a0a0a]"
                    >
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("gateway.form.status")}
                </span>
                <button
                  type="button"
                  onClick={() => updateField("isActive", !form.isActive)}
                  aria-pressed={form.isActive}
                  className={`mt-1.5 flex h-10 w-full items-center justify-between rounded-lg border px-3 text-sm transition-colors ${
                    form.isActive
                      ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
                      : "border-red-400/20 bg-red-400/[0.06] text-red-300"
                  }`}
                >
                  <span>
                    {form.isActive
                      ? t("gateway.form.enabled")
                      : t("gateway.form.disabled")}
                  </span>
                  <span
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      form.isActive ? "bg-emerald-400/30" : "bg-red-400/20"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-current transition-all ${
                        form.isActive ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>
              </div>
            </div>

            {error ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-[11px] leading-5 text-red-300">
                <span className="mt-0.5">!</span>
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-[#d4af37]/10 bg-[#080808]/80 px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-10 rounded-xl border border-white/[0.08] px-4 text-xs text-neutral-400 transition-colors hover:border-[#d4af37]/20 hover:text-neutral-200 disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? t("common.saving")
                : mode === "create"
                  ? t("gateway.form.create")
                  : t("gateway.form.saveChanges")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

