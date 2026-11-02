"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction, TranslationKey } from "@/lib/i18n-types";
import type { IntegrationGatewayRow } from "@/lib/integrations";

type GatewayUpdateResponse = {
  success?: boolean;
  gateway?: IntegrationGatewayRow;
  error?: string;
};

const API_KEY_MAX_LENGTH = 512;
const NAME_MAX_LENGTH = 80;

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

/** 枚举 → 词典文案；未知值原样回显，避免出现空标签。 */
function dictLabel(
  dict: Record<string, TranslationKey>,
  value: string,
  t: TFunction,
) {
  const key = dict[value];

  return key ? t(key) : value;
}

type GatewayFormValues = {
  name: string;
  currency: string;
  endpoint: string;
  walletAddress: string;
  apiKey: string;
  isActive: boolean;
};

/** USDT 类通道（usdt_trc20 / usdt_erc20）才有收款钱包。 */
function usesWallet(providerType: string) {
  return providerType.startsWith("usdt_");
}

/** 只有跳转支付 / 动态二维码才需要支付接口地址与验签密钥。 */
function usesEndpoint(gatewayType: string) {
  return gatewayType === "REDIRECT_URL" || gatewayType === "DYNAMIC_QR";
}

/**
 * 页面侧的轻量校验：只覆盖本弹窗真正可改的字段。
 * 服务端还会用 parseTenantGatewayInput 跑一遍完整校验（含二维码 / 银行信息），
 * 因此这里的原则是「明显错误当场拦下」，不重复实现全部业务规则。
 */
function validateForm(
  values: GatewayFormValues,
  gateway: IntegrationGatewayRow,
  t: TFunction,
) {
  const name = values.name.trim();
  const currency = values.currency.trim().toUpperCase();
  const wallet = values.walletAddress.trim();
  const endpoint = values.endpoint.trim();

  if (!name) {
    return t("integrations.gateway.error.nameRequired");
  }

  if (name.length > NAME_MAX_LENGTH) {
    return t("integrations.gateway.error.nameMax");
  }

  if (!/^[A-Z]{2,10}$/.test(currency)) {
    return t("integrations.gateway.error.currencyInvalid");
  }

  if (usesWallet(gateway.providerType)) {
    if (currency !== "USDT") {
      return t("integrations.gateway.error.usdtCurrency");
    }

    if (!wallet) {
      return t("integrations.gateway.error.walletRequired");
    }

    if (
      gateway.providerType === "usdt_trc20" &&
      !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet)
    ) {
      return t("integrations.gateway.error.trc20Invalid");
    }

    if (
      gateway.providerType === "usdt_erc20" &&
      !/^0x[a-fA-F0-9]{40}$/.test(wallet)
    ) {
      return t("integrations.gateway.error.erc20Invalid");
    }
  }

  if (usesEndpoint(gateway.gatewayType)) {
    if (!endpoint) {
      return t("integrations.gateway.error.endpointRequired");
    }

    try {
      const url = new URL(endpoint);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return t("integrations.gateway.error.endpointProtocol");
      }
    } catch {
      return t("integrations.gateway.error.endpointInvalid");
    }
  }

  if (values.apiKey.trim().length > API_KEY_MAX_LENGTH) {
    return t("integrations.gateway.error.secretMax");
  }

  return "";
}

/**
 * 支付通道配置编辑弹窗（Payment Gateways 页签的【编辑】）。
 *
 * 定位：通道由商户在自家后台（/tenant/payments）自助对接支付商，
 * 平台只做只读监控；这里是**运维兜底修正**入口——不改归属、
 * 不新建通道，只修正 endpoint / 钱包 / 密钥 / 启停。
 *
 * 可改：通道名称、币种、支付接口地址、收款钱包、API Key（留空 = 不改）、启停。
 * 不可改：通道类型、支付形态、归属商户（只读展示）。
 */
export function GatewayEditModal({
  gateway,
  onClose,
  onSaved,
}: {
  gateway: IntegrationGatewayRow;
  onClose: () => void;
  onSaved: (gateway: IntegrationGatewayRow) => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const editableEndpoint = usesEndpoint(gateway.gatewayType);
  const editableWallet = usesWallet(gateway.providerType);

  const [values, setValues] = useState<GatewayFormValues>({
    name: gateway.name,
    currency: gateway.currency,
    endpoint: gateway.endpoint,
    walletAddress: gateway.walletAddress,
    // 密钥只下发掩码：留空表示保持原密钥不变。
    apiKey: "",
    isActive: gateway.isActive,
  });
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validation = validateForm(values, gateway, t);

    if (validation) {
      setError(validation);
      return;
    }

    const nextName = values.name.trim();
    const nextCurrency = values.currency.trim().toUpperCase();
    const nextWallet = editableWallet ? values.walletAddress.trim() : "";
    const nextEndpoint = editableEndpoint ? values.endpoint.trim() : "";
    const nextApiKey = editableEndpoint ? values.apiKey.trim() : "";
    const unchanged =
      nextName === gateway.name &&
      nextCurrency === gateway.currency &&
      nextEndpoint === gateway.endpoint &&
      nextWallet === gateway.walletAddress &&
      values.isActive === gateway.isActive &&
      !nextApiKey;

    if (unchanged) {
      setError(t("integrations.gateway.error.noChanges"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        `/api/admin/integrations/gateways/${gateway.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nextName,
            currency: nextCurrency,
            endpoint: nextEndpoint,
            walletAddress: editableWallet ? nextWallet || null : null,
            apiKey: nextApiKey,
            isActive: values.isActive,
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as
        GatewayUpdateResponse;

      if (!response.ok || !data.success || !data.gateway) {
        setError(data.error || t("integrations.error.network"));
        return;
      }

      onSaved(data.gateway);
    } catch {
      setError(t("integrations.error.network"));
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label={t("integrations.gateway.modal.backdropAria")}
        onClick={onClose}
        disabled={submitting}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm disabled:cursor-not-allowed"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-[#d4af37]/20 bg-[#0b0b0b] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]"
      >
        <form onSubmit={handleSubmit}>
          <div className="px-5 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
                  {t("integrations.gateway.modal.eyebrow")}
                </p>
                <h2
                  id={titleId}
                  className="mt-2 truncate text-base font-semibold text-neutral-100"
                >
                  {t("integrations.gateway.modal.title", {
                    name: gateway.name,
                  })}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-white/20 hover:text-neutral-200 disabled:opacity-50"
                aria-label={t("common.close")}
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-2.5 py-1 text-[10px] text-[#f0d27c]">
                {dictLabel(GATEWAY_PROVIDER_LABEL_KEYS, gateway.providerType, t)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-neutral-400">
                {dictLabel(GATEWAY_PAYMENT_TYPE_LABEL_KEYS, gateway.gatewayType, t)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-neutral-400">
                {gateway.isPlatformGateway
                  ? t("integrations.gateways.platformOwner")
                  : gateway.ownerName || t("integrations.gateways.unknownOwner")}
              </span>
            </div>

            <p className="mt-3 rounded-lg border border-[#d4af37]/15 bg-[#d4af37]/[0.04] px-3 py-2 text-[10px] leading-5 text-neutral-500">
              {t("integrations.gateway.modal.supportHint")}
            </p>

            <label className="mt-4 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("integrations.gateway.modal.name")}
              </span>
              <input
                ref={nameRef}
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={NAME_MAX_LENGTH}
                value={values.name}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }))
                }
                className={inputClass}
              />
            </label>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.gateway.modal.currency")}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={10}
                  value={values.currency}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="MYR"
                  className={inputClass}
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2 sm:mt-[22px] sm:h-10 sm:py-0">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.gateway.modal.active")}
                </span>
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      isActive: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-[#d4af37]"
                />
              </label>
            </div>

            {editableEndpoint ? (
              <label className="mt-4 block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.gateway.modal.endpoint")}
                </span>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={values.endpoint}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      endpoint: event.target.value,
                    }))
                  }
                  placeholder="https://api.provider.com/pay"
                  className={inputClass}
                />
              </label>
            ) : null}

            {editableWallet ? (
              <label className="mt-4 block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.gateway.modal.wallet")}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={values.walletAddress}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      walletAddress: event.target.value,
                    }))
                  }
                  placeholder="TQ5NMqJjvHhN8mC4ZxYy9r3sT7bPdWcV1k"
                  className={inputClass}
                />
              </label>
            ) : null}

            {editableEndpoint ? (
              <label className="mt-4 block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.gateway.modal.secret")}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={values.apiKey}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder={
                    gateway.hasKey
                      ? gateway.maskedKey
                      : t("integrations.gateway.modal.secretPlaceholder")
                  }
                  className={inputClass}
                />
                <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
                  {t("integrations.gateway.modal.secretHint")}
                </span>
              </label>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[11px] leading-5 text-red-300"
              >
                {error}
              </p>
            ) : null}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-9 rounded-lg border border-white/10 px-3.5 text-[11px] font-medium text-neutral-400 transition-colors hover:border-white/20 hover:text-neutral-200 disabled:opacity-50"
            >
              {t("integrations.gateway.modal.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 rounded-lg bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-[11px] font-bold text-[#171105] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting
                ? t("integrations.gateway.modal.saving")
                : t("integrations.gateway.modal.save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
