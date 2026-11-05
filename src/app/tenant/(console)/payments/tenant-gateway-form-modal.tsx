"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDisplayAmount } from "@/lib/currency";
import {
  calculateDepositFee,
  formatGatewayFeeRatePercent,
  MAX_GATEWAY_FEE_RATE_PERCENT,
  parseGatewayFeeRatePercent,
} from "@/lib/deposit-fee";
import {
  GATEWAY_BANK_FIELD_LABEL_KEYS,
  GATEWAY_BANK_FIELD_PLACEHOLDER_KEYS,
  GATEWAY_PAYMENT_TYPE_HINT_KEYS,
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import {
  EMPTY_GATEWAY_BANK_DETAILS,
  GATEWAY_BANK_DETAIL_FIELDS,
  normalizeGatewayBankDetails,
  validateGatewayBankDetails,
  type GatewayBankDetails,
} from "@/lib/payment-gateway-bank";
import {
  defaultGatewayCurrencyForProvider,
  defaultGatewayTypeForProvider,
  FIAT_GATEWAY_PROVIDER_TYPES,
  GATEWAY_TYPES,
  isCryptoGatewayProviderType,
  type GatewayProviderType,
  type GatewayTypeValue,
} from "@/lib/payment-gateway-constants";
import {
  GATEWAY_BANK_CATALOG,
  gatewayBankLabel,
  MAX_SUPPORTED_BANKS,
  normalizeSupportedBanks,
} from "@/lib/payment-gateway-banks";
import { normalizeGatewayQrCodeImageUrl } from "@/lib/payment-gateway-qr";
import type { TenantOwnGateway } from "@/lib/tenant-payment-gateways";

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

type TenantGatewayFormValues = {
  name: string;
  providerType: GatewayProviderType;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string;
  qrCodeImageUrl: string;
  bankDetails: GatewayBankDetails;
  endpoint: string;
  apiKey: string;
  /** REDIRECT_URL：勾选的内置银行（编码）。目录外的银行走 customBanksText。 */
  supportedBanks: string[];
  /** REDIRECT_URL：目录外银行（原样文本，提交前统一归一化成编码） */
  customBanksText: string;
  /**
   * 通道费率（百分比，文案输入框）："2" = 2%，留空 = 0（不收手续费）。
   * 只用于财务对账（算 feeAmount / actualReceived），绝不从玩家余额里扣。
   */
  feeRate: string;
};

type TenantGatewaySaveResponse = {
  success?: boolean;
  gateway?: TenantOwnGateway;
  error?: string;
};

function validateForm(form: TenantGatewayFormValues, t: TFunction) {
  const name = form.name.trim();
  const currency = form.currency.trim().toUpperCase();
  const walletAddress = form.walletAddress.trim();
  const endpoint = form.endpoint.trim();
  const apiKey = form.apiKey.trim();
  const isUsdt = form.providerType.startsWith("usdt_");

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
  }

  if (form.gatewayType === "STATIC_QR") {
    if (!normalizeGatewayQrCodeImageUrl(form.qrCodeImageUrl)) {
      return t("gateway.validation.staticQrRequired");
    }
  }

  if (form.gatewayType === "BANK_TRANSFER") {
    const bankError = validateGatewayBankDetails(
      normalizeGatewayBankDetails(form.bankDetails),
    );

    if (bankError) {
      return bankError.includes("户名")
        ? t("gateway.validation.bankNameRequired")
        : t("gateway.validation.bankAccountRequired");
    }
  }

  const endpointRequired =
    form.gatewayType === "REDIRECT_URL" ||
    (form.gatewayType === "DYNAMIC_QR" && !isUsdt);

  if (endpointRequired && !endpoint) {
    return t("gateway.validation.endpointRequired");
  }

  if (endpointRequired && endpoint) {
    try {
      const url = new URL(endpoint);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return t("gateway.validation.endpointProtocol");
      }
    } catch {
      return t("gateway.validation.endpointInvalid");
    }
  }

  if (
    (form.gatewayType === "REDIRECT_URL" ||
      form.gatewayType === "DYNAMIC_QR") &&
    !apiKey
  ) {
    return t("gateway.validation.apiKeyRequired");
  }

  if (apiKey.length > 512) {
    return t("gateway.validation.apiKeyMax");
  }

  if (form.gatewayType === "REDIRECT_URL") {
    const banks = normalizeSupportedBanks([
      ...form.supportedBanks,
      ...normalizeSupportedBanks(form.customBanksText),
    ]);

    if (banks.length > MAX_SUPPORTED_BANKS) {
      return t("tenantGateway.validation.banksMax", {
        max: String(MAX_SUPPORTED_BANKS),
      });
    }
  }

  /**
   * 通道费率：留空 = 0，填了必须是 0~100 的数字（与后端
   * parseGatewayFeeRatePercent 同一口径，避免「前端能过、保存 400」）。
   */
  if (form.feeRate.trim() && parseGatewayFeeRatePercent(form.feeRate) === null) {
    return t("tenantGateway.form.feeRateInvalid", {
      max: String(MAX_GATEWAY_FEE_RATE_PERCENT),
    });
  }

  return "";
}

export function TenantGatewayFormModal({
  gateway,
  onClose,
  onSaved,
}: {
  /** 有值 = 编辑已有通道（PUT），无值 = 新增（POST）。 */
  gateway?: TenantOwnGateway;
  onClose: () => void;
  onSaved: (gateway: TenantOwnGateway) => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const titleId = useId();
  const isEdit = Boolean(gateway);
  const [form, setForm] = useState<TenantGatewayFormValues>({
    name: gateway?.name ?? "",
    providerType: (gateway?.providerType ?? "tng") as GatewayProviderType,
    gatewayType: gateway?.gatewayType ?? "STATIC_QR",
    currency: gateway?.currency ?? "MYR",
    walletAddress: gateway?.walletAddress ?? "",
    qrCodeImageUrl: gateway?.qrCodeImageUrl ?? "",
    bankDetails: gateway?.bankDetails
      ? { ...gateway.bankDetails }
      : { ...EMPTY_GATEWAY_BANK_DETAILS },
    endpoint: gateway?.endpoint ?? "",
    // 编辑时不回填密钥明文：留空 = 保持原有 API Secret 不变。
    apiKey: "",
    // 编辑时回填银行：目录内的进勾选框，目录外的（商户自己填的）进文本框。
    supportedBanks: (gateway?.supportedBanks ?? []).filter((code) =>
      GATEWAY_BANK_CATALOG.some((bank) => bank.code === code),
    ),
    customBanksText: (gateway?.supportedBanks ?? [])
      .filter((code) => !GATEWAY_BANK_CATALOG.some((bank) => bank.code === code))
      .join(", "),
    // 费率回填成百分比文本（"2" / "2.5"），未配置 = 空串（提交时按 0 处理）。
    feeRate: gateway ? formatGatewayFeeRatePercent(gateway.feeRate) : "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /**
   * 费率实时预览：以「玩家充值 100」为例算一遍账本，
   * 让商户在保存前就看到通道费 / 实际到账，而不是上线后才发现填错。
   * 口径与服务端完全一致（同一份 calculateDepositFee），前端不另算一套。
   */
  const feeRateValue = parseGatewayFeeRatePercent(form.feeRate);
  const feePreview =
    feeRateValue !== null && feeRateValue > 0
      ? calculateDepositFee(100, feeRateValue)
      : null;

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

  function updateField<Key extends keyof TenantGatewayFormValues>(
    field: Key,
    value: TenantGatewayFormValues[Key],
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function handleProviderTypeChange(providerType: GatewayProviderType) {
    setForm((previous) => ({
      ...previous,
      providerType,
      gatewayType: defaultGatewayTypeForProvider(providerType),
      currency: defaultGatewayCurrencyForProvider(providerType),
    }));
  }

  function handleBankDetailChange(
    field: keyof GatewayBankDetails,
    value: string,
  ) {
    setForm((previous) => ({
      ...previous,
      bankDetails: { ...previous.bankDetails, [field]: value },
    }));
  }

  /**
   * 勾选 / 取消内置银行。
   * 到达上限后静默不勾 —— 弹窗里已经有计数提示，不需要再弹一次错误。
   */
  function toggleSupportedBank(code: string) {
    setForm((previous) => {
      const selected = previous.supportedBanks.includes(code);

      if (!selected && previous.supportedBanks.length >= MAX_SUPPORTED_BANKS) {
        return previous;
      }

      return {
        ...previous,
        supportedBanks: selected
          ? previous.supportedBanks.filter((item) => item !== code)
          : [...previous.supportedBanks, code],
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validation = validateForm(form, t);

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
      // 新增 → POST /api/tenant/gateways；编辑 → PUT /api/tenant/gateways/[id]
      const response = await fetch(
        isEdit && gateway
          ? `/api/tenant/gateways/${gateway.id}`
          : "/api/tenant/gateways",
        {
          method: isEdit ? "PUT" : "POST",
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
            // 留空表示沿用原密钥，由服务端保留旧值。
            apiKey: isEndpointGateway ? form.apiKey.trim() : "",
            // 银行列表只对「跳转网银」有意义：内置勾选 + 目录外手工补充。
            // 统一再过一次 normalize：手工补充的 "Maybank" 会和勾选重复，必须去重。
            supportedBanks:
              form.gatewayType === "REDIRECT_URL"
                ? normalizeSupportedBanks([
                    ...form.supportedBanks,
                    ...normalizeSupportedBanks(form.customBanksText),
                  ])
                : null,
            // 通道费率（百分比）：留空 = 0，服务端会再校验一次 0~100。
            feeRate: form.feeRate.trim(),
          }),
        },
      );
      const data: TenantGatewaySaveResponse = await response
        .json()
        .catch(() => ({}) as TenantGatewaySaveResponse);

      if (response.status === 401) {
        router.replace("/login?next=/tenant/payments");
        return;
      }

      if (!response.ok || !data.success || !data.gateway) {
        setError(data.error || t("tenantGateway.error.submitFailed"));
        return;
      }

      onSaved(data.gateway);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 玩家最终会看到的银行列表（内置勾选 + 目录外补充，去重后）。
   * 上报与计数都用它，避免「勾了 Maybank 又手填 Maybank」算成 2 家。
   */
  const supportedBanksPreview = normalizeSupportedBanks([
    ...form.supportedBanks,
    ...normalizeSupportedBanks(form.customBanksText),
  ]);

  /**
   * 编辑一条历史加密货币（USDT）通道时：下拉里已经没有这类选项了，
   * 需要额外渲染一个 disabled 占位项 + 红字提示，商户改成法币支付商才能保存
   * （服务端 parseTenantGatewayInput 会直接 400 拦下 crypto providerType）。
   */
  const isLegacyCryptoGateway = isCryptoGatewayProviderType(form.providerType);

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
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_120px_-30px_rgba(212,175,55,0.35)] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <p className="text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/60">
              {t("tenantGateway.eyebrow")}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
              {t(
                isEdit ? "tenantGateway.titleEdit" : "tenantGateway.titleCreate",
              )}
            </h2>
            <p className="mt-1 text-[10px] leading-5 text-neutral-600">
              {t(
                isEdit
                  ? "tenantGateway.subtitleEdit"
                  : "tenantGateway.subtitleCreate",
              )}
            </p>
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
                  {t("tenantGateway.form.name")}
                </span>
                <input
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  maxLength={80}
                  placeholder={t("tenantGateway.form.namePlaceholder")}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenantGateway.form.providerType")}
                </span>
                <select
                  value={form.providerType}
                  onChange={(event) =>
                    handleProviderTypeChange(
                      event.target.value as GatewayProviderType,
                    )
                  }
                  className={inputClass}
                >
                  {/*
                   * 法币专精：下拉只给 FIAT_GATEWAY_PROVIDER_TYPES（已剔除 USDT）。
                   * 历史通道若是加密货币，额外渲染一个 disabled 占位项，
                   * 否则 <select> 的值不在列表里会显示成空白，商户以为表单坏了。
                   */}
                  {isLegacyCryptoGateway ? (
                    <option
                      value={form.providerType}
                      disabled
                      className="bg-[#0a0a0a]"
                    >
                      {t("tenantGateway.form.legacyCryptoOption")}
                    </option>
                  ) : null}
                  {FIAT_GATEWAY_PROVIDER_TYPES.map((providerType) => (
                    <option
                      key={providerType}
                      value={providerType}
                      className="bg-[#0a0a0a]"
                    >
                      {t(GATEWAY_PROVIDER_LABEL_KEYS[providerType])}
                    </option>
                  ))}
                </select>
                {isLegacyCryptoGateway ? (
                  <p className="mt-1.5 text-[10px] leading-4 text-red-300/90">
                    {t("tenantGateway.form.legacyCryptoHint")}
                  </p>
                ) : null}
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenantGateway.form.gatewayType")}
                </span>
                <select
                  value={form.gatewayType}
                  onChange={(event) =>
                    updateField(
                      "gatewayType",
                      event.target.value as GatewayTypeValue,
                    )
                  }
                  className={inputClass}
                >
                  {GATEWAY_TYPES.map((gatewayType) => (
                    <option
                      key={gatewayType}
                      value={gatewayType}
                      disabled={
                        form.providerType.startsWith("usdt_") &&
                        gatewayType !== "DYNAMIC_QR"
                      }
                      className="bg-[#0a0a0a]"
                    >
                      {t(GATEWAY_PAYMENT_TYPE_LABEL_KEYS[gatewayType])}
                    </option>
                  ))}
                </select>
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t(GATEWAY_PAYMENT_TYPE_HINT_KEYS[form.gatewayType])}
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenantGateway.form.currency")}
                </span>
                <input
                  value={form.currency}
                  onChange={(event) =>
                    updateField("currency", event.target.value.toUpperCase())
                  }
                  maxLength={10}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="MYR / EUR / AUD / USD"
                  className={`${inputClass} font-mono uppercase`}
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t("tenantGateway.form.currencyHint")}
                </span>
              </label>
            </div>

            {/*
             * 通道费率（财务对账用）。
             * 这里是**唯一**的填写入口：只记录「支付商抽了多少、商户实收多少」，
             * 玩家充 100 依然上分 100，一分钱都不扣（AGENTS.md §14）。
             */}
            <div className="rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-3.5">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenantGateway.form.feeRate")}
                </span>
                <input
                  value={form.feeRate}
                  onChange={(event) =>
                    updateField("feeRate", event.target.value)
                  }
                  inputMode="decimal"
                  maxLength={8}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="2"
                  className={`${inputClass} font-mono`}
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t("tenantGateway.form.feeRateHint")}
                </span>
                {feePreview ? (
                  <span className="mt-1 block text-[10px] leading-5 text-[#e8cf8a]">
                    {t("tenantGateway.form.feeRatePreview", {
                      gross: formatDisplayAmount(100, form.currency),
                      fee: formatDisplayAmount(
                        feePreview.feeAmount,
                        form.currency,
                      ),
                      net: formatDisplayAmount(
                        feePreview.actualReceived,
                        form.currency,
                      ),
                    })}
                  </span>
                ) : null}
              </label>
            </div>

            {form.gatewayType === "DYNAMIC_QR" &&
            form.providerType.startsWith("usdt_") ? (
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenantGateway.form.wallet")}
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
                      ? t("tenantGateway.form.erc20Placeholder")
                      : t("tenantGateway.form.trc20Placeholder")
                  }
                  className={`${inputClass} font-mono`}
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t("tenantGateway.form.walletHint")}
                </span>
              </label>
            ) : null}

            {form.gatewayType === "STATIC_QR" ? (
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenantGateway.form.qrUrl")}
                </span>
                <input
                  value={form.qrCodeImageUrl}
                  onChange={(event) =>
                    updateField("qrCodeImageUrl", event.target.value)
                  }
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="https://cdn.example.com/my-qr.png"
                  className={inputClass}
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t("tenantGateway.form.qrUrlHint")}
                </span>
              </label>
            ) : null}

            {form.gatewayType === "BANK_TRANSFER" ? (
              <div className="rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-3.5">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenantGateway.form.bankInfo")}
                </span>
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
                  {t("tenantGateway.form.bankHint")}
                </p>
              </div>
            ) : null}

            {form.gatewayType === "REDIRECT_URL" ||
            form.gatewayType === "DYNAMIC_QR" ? (
              <>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {form.gatewayType === "REDIRECT_URL"
                      ? t("tenantGateway.form.endpointRedirect")
                      : t("tenantGateway.form.endpointQr")}
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
                      ? t("tenantGateway.form.endpointRedirectHint")
                      : form.providerType.startsWith("usdt_")
                        ? t("tenantGateway.form.endpointUsdtHint")
                        : t("tenantGateway.form.endpointQrHint")}
                  </span>
                </label>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("tenantGateway.form.apiKey")}
                  </span>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(event) =>
                      updateField("apiKey", event.target.value)
                    }
                    autoComplete="new-password"
                    placeholder={t(
                      isEdit && gateway?.hasApiKey
                        ? "tenantGateway.form.apiKeyKeepPlaceholder"
                        : "tenantGateway.form.apiKeyPlaceholder",
                    )}
                    className={inputClass}
                  />
                  <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                    {t(
                      isEdit && gateway?.hasApiKey
                        ? "tenantGateway.form.apiKeyKeepHint"
                        : "tenantGateway.form.apiKeyHint",
                    )}
                  </span>
                </label>
              </>
            ) : null}

            {/*
              REDIRECT_URL（跳转网银）：玩家收银台会先让玩家选银行。
              - 勾选内置银行 = 玩家看到银行卡片，选完直接跳到该银行支付页；
              - 一个都不勾 = 不做银行选择，把选银行的事交给支付商收银台；
              - 目录外的银行用「其他银行」补充，存库时统一归一化成编码。
            */}
            {form.gatewayType === "REDIRECT_URL" ? (
              <div className="rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("tenantGateway.form.supportedBanks")}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-neutral-500">
                    {supportedBanksPreview.length} / {MAX_SUPPORTED_BANKS}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {GATEWAY_BANK_CATALOG.map((bank) => {
                    const checked = form.supportedBanks.includes(bank.code);
                    const disabled =
                      !checked &&
                      supportedBanksPreview.length >= MAX_SUPPORTED_BANKS;

                    return (
                      <label
                        key={bank.code}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
                          checked
                            ? "border-[#d4af37]/50 bg-[#d4af37]/[0.12] text-[#f0d27c]"
                            : "border-white/[0.08] bg-black/30 text-neutral-300 hover:border-[#d4af37]/25"
                        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleSupportedBank(bank.code)}
                          className="h-3.5 w-3.5 accent-[#d4af37]"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {bank.label}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("tenantGateway.form.supportedBanksCustom")}
                  </span>
                  <input
                    value={form.customBanksText}
                    onChange={(event) =>
                      updateField("customBanksText", event.target.value)
                    }
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="RHB Islamic, Bank Muamalat"
                    className={inputClass}
                  />
                  <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                    {t("tenantGateway.form.supportedBanksCustomHint")}
                  </span>
                </label>

                <span className="mt-2 block text-[10px] leading-5 text-neutral-600">
                  {t("tenantGateway.form.supportedBanksHint")}
                </span>
                {supportedBanksPreview.length > 0 ? (
                  <span className="mt-1 block text-[10px] leading-5 text-[#e8cf8a]">
                    {t("tenantGateway.form.supportedBanksPreview", {
                      count: String(supportedBanksPreview.length),
                    })}
                    {": "}
                    {supportedBanksPreview
                      .map((code) => gatewayBankLabel(code))
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
            ) : null}

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
                ? t("common.submitting")
                : t(
                    isEdit
                      ? "tenantGateway.form.save"
                      : "tenantGateway.form.submit",
                  )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
