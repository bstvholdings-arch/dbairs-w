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
  API_SECRET_MAX_LENGTH,
  INTEGRATION_URL_MAX_LENGTH,
  MERCHANT_ID_MAX_LENGTH,
  readApiSecret,
  readIntegrationUrl,
  readMerchantId,
  type IntegrationProviderRow,
} from "@/lib/integrations";

type ProviderUpdateResponse = {
  success?: boolean;
  provider?: IntegrationProviderRow;
  error?: string;
};

/**
 * 游戏商对接凭据编辑弹窗（Game Providers 页签的【编辑】）。
 *
 * 可改三项：API Endpoint / Merchant ID / Secret。
 * Secret 永远只下发掩码，因此输入框始终留空：
 *   - 留空提交 = 保持原密钥不变（接口侧也是「空串不改」的语义）；
 *   - 填写新值 = 覆盖旧密钥。
 */
export function ProviderCredentialModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: IntegrationProviderRow;
  onClose: () => void;
  onSaved: (provider: IntegrationProviderRow) => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const endpointRef = useRef<HTMLInputElement>(null);

  const [apiEndpoint, setApiEndpoint] = useState(provider.apiEndpoint);
  const [merchantId, setMerchantId] = useState(provider.merchantId);
  const [apiSecret, setApiSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      endpointRef.current?.focus();
      endpointRef.current?.select();
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

    const endpoint = readIntegrationUrl(apiEndpoint);
    const nextMerchantId = readMerchantId(merchantId);
    const secret = readApiSecret(apiSecret);

    if (endpoint === null) {
      setError(t("integrations.provider.error.endpointInvalid"));
      return;
    }

    if (nextMerchantId === null) {
      setError(t("integrations.provider.error.merchantIdInvalid"));
      return;
    }

    if (secret === null) {
      setError(t("integrations.provider.error.secretInvalid"));
      return;
    }

    // apiSecret 留空 = 不改；但另外两个字段清空也是合法修改（清空 = 移除配置）。
    if (
      endpoint === provider.apiEndpoint &&
      nextMerchantId === provider.merchantId &&
      !secret
    ) {
      setError(t("integrations.provider.error.noChanges"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        `/api/admin/integrations/providers/${provider.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiEndpoint: endpoint,
            merchantId: nextMerchantId,
            apiSecret: secret,
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as
        ProviderUpdateResponse;

      if (!response.ok || !data.success || !data.provider) {
        setError(data.error || t("integrations.error.network"));
        return;
      }

      onSaved(data.provider);
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
        aria-label={t("integrations.provider.modal.backdropAria")}
        onClick={onClose}
        disabled={submitting}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm disabled:cursor-not-allowed"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-[#0b0b0b] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]"
      >
        <form onSubmit={handleSubmit}>
          <div className="px-5 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
                  {t("integrations.provider.modal.eyebrow")}
                </p>
                <h2
                  id={titleId}
                  className="mt-2 text-base font-semibold text-neutral-100"
                >
                  {t("integrations.provider.modal.title", {
                    name: provider.name,
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

            <label className="mt-5 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("integrations.provider.modal.apiEndpoint")}
              </span>
              <input
                ref={endpointRef}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                maxLength={INTEGRATION_URL_MAX_LENGTH}
                value={apiEndpoint}
                onChange={(event) => setApiEndpoint(event.target.value)}
                placeholder="https://api.pgsoft.com"
                className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("integrations.provider.modal.merchantId")}
              </span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={MERCHANT_ID_MAX_LENGTH}
                value={merchantId}
                onChange={(event) => setMerchantId(event.target.value)}
                placeholder="DBAIRS_PROD_01"
                className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("integrations.provider.modal.secret")}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                maxLength={API_SECRET_MAX_LENGTH}
                value={apiSecret}
                onChange={(event) => setApiSecret(event.target.value)}
                placeholder={
                  provider.hasSecret
                    ? provider.maskedSecret
                    : t("integrations.provider.modal.secretPlaceholder")
                }
                className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
              />
              <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
                {t("integrations.provider.modal.secretHint")}
              </span>
            </label>

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
              {t("integrations.provider.modal.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 rounded-lg bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-[11px] font-bold text-[#171105] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting
                ? t("integrations.provider.modal.saving")
                : t("integrations.provider.modal.save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
