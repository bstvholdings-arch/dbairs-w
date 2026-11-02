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
  CALLBACK_URL_MAX_LENGTH,
  CONTACT_EMAIL_MAX_LENGTH,
  WALLET_ADDRESS_MAX_LENGTH,
  readBackendIp,
  readCallbackUrl,
  readContactEmail,
  readWalletAddress,
  type IntegrationTenantRow,
} from "@/lib/integrations";

// 与 src/lib/tenant-api.ts 的 DOMAIN_PATTERN 保持一致：
// 客户端只负责即时提示，最终以服务端校验为准（域名唯一性也只有服务端能判断）。
const DOMAIN_INPUT_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// 与 readBackendIp 内部长度限制一致。
const BACKEND_IP_MAX_LENGTH = 64;

const FIELD_CLASS =
  "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";type TenantUpdateResponse = {
  success?: boolean;
  error?: string;
};

/**
 * 商户资料编辑弹窗（Merchant Profiles 页签的【编辑】）。
 *
 * 六个字段一次改完：Company Name / Domain / Backend IP / Wallet /
 * Contact Email / 专属回调地址。
 *
 * 专属 API Key 不在这里改：重置密钥是独立动作（POST /reset-key），
 * 避免「顺手保存」把正在使用的密钥改坏。
 */
export function TenantProfileModal({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: IntegrationTenantRow;
  onClose: () => void;
  /** 保存成功后回传「已按表单值更新的行」，父组件据此做乐观更新。 */
  onSaved: (tenant: IntegrationTenantRow) => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(tenant.name);
  const [domain, setDomain] = useState(tenant.domain);
  const [backendIp, setBackendIp] = useState(tenant.backendIp);
  const [walletAddress, setWalletAddress] = useState(tenant.walletAddress);
  const [contactEmail, setContactEmail] = useState(tenant.contactEmail);
  const [callbackUrl, setCallbackUrl] = useState(tenant.apiCallbackUrl);
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

    const nextName = name.trim();
    const nextDomain = domain.trim().toLowerCase();
    const nextBackendIp = readBackendIp(backendIp);
    const nextWalletAddress = readWalletAddress(walletAddress);
    const nextContactEmail = readContactEmail(contactEmail);
    const nextCallbackUrl = readCallbackUrl(callbackUrl);

    if (!nextName) {
      setError(t("integrations.tenant.error.nameRequired"));
      return;
    }

    if (nextName.length > 80) {
      setError(t("integrations.tenant.error.nameTooLong"));
      return;
    }

    if (!DOMAIN_INPUT_PATTERN.test(nextDomain)) {
      setError(t("integrations.tenant.error.domainInvalid"));
      return;
    }

    if (nextBackendIp === null) {
      setError(t("integrations.tenant.error.backendIpInvalid"));
      return;
    }

    if (nextWalletAddress === null) {
      setError(t("integrations.tenant.error.walletInvalid"));
      return;
    }

    if (nextContactEmail === null) {
      setError(t("integrations.form.error.emailInvalid"));
      return;
    }

    if (nextCallbackUrl === null) {
      setError(t("integrations.form.error.callbackInvalid"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextName,
          domain: nextDomain,
          backendIp: nextBackendIp,
          walletAddress: nextWalletAddress,
          contactEmail: nextContactEmail,
          apiCallbackUrl: nextCallbackUrl,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as
        TenantUpdateResponse;

      if (!response.ok || !data.success) {
        setError(data.error || t("integrations.error.network"));
        return;
      }

      onSaved({
        ...tenant,
        name: nextName,
        domain: nextDomain,
        contactEmail: nextContactEmail,
        apiCallbackUrl: nextCallbackUrl,
        backendIp: nextBackendIp,
        walletAddress: nextWalletAddress,
      });
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
        aria-label={t("integrations.form.backdropAria")}
        onClick={onClose}
        disabled={submitting}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm disabled:cursor-not-allowed"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-[#0b0b0b] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
                  {t("integrations.tenant.eyebrow")}
                </p>
                <h2
                  id={titleId}
                  className="mt-2 text-base font-semibold text-neutral-100"
                >
                  {t("integrations.tenant.title", { name: tenant.name })}
                </h2>
                <p className="mt-1 text-[10px] text-neutral-600">
                  {tenant.subdomain}
                </p>
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

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.tenant.companyName")}
                </span>
                <input
                  ref={nameRef}
                  type="text"
                  autoComplete="off"
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.tenant.domain")}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={253}
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="merchant.com"
                  className={`${FIELD_CLASS} font-mono`}
                />
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.tenant.backendIp")}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={BACKEND_IP_MAX_LENGTH}
                  value={backendIp}
                  onChange={(event) => setBackendIp(event.target.value)}
                  placeholder="203.0.113.10"
                  className={`${FIELD_CLASS} font-mono`}
                />
                <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
                  {t("integrations.tenant.backendIpHint")}
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.tenant.wallet")}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={WALLET_ADDRESS_MAX_LENGTH}
                  value={walletAddress}
                  onChange={(event) => setWalletAddress(event.target.value)}
                  placeholder="TQ5N...9Xk2"
                  className={`${FIELD_CLASS} font-mono`}
                />
                <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
                  {t("integrations.tenant.walletHint")}
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.form.contactEmail")}
                </span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  maxLength={CONTACT_EMAIL_MAX_LENGTH}
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  placeholder={t("integrations.form.contactEmailPlaceholder")}
                  className={FIELD_CLASS}
                />
                <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
                  {t("integrations.form.emailHint")}
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("integrations.form.callbackUrl")}
                </span>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={CALLBACK_URL_MAX_LENGTH}
                  value={callbackUrl}
                  onChange={(event) => setCallbackUrl(event.target.value)}
                  placeholder={t("integrations.form.callbackUrlPlaceholder")}
                  className={`${FIELD_CLASS} font-mono`}
                />
                <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
                  {t("integrations.form.callbackHint")}
                </span>
              </label>
            </div>

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[11px] leading-5 text-red-300"
              >
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-9 rounded-lg border border-white/10 px-3.5 text-[11px] font-medium text-neutral-400 transition-colors hover:border-white/20 hover:text-neutral-200 disabled:opacity-50"
            >
              {t("integrations.form.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 rounded-lg bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-[11px] font-bold text-[#171105] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting
                ? t("integrations.form.saving")
                : t("integrations.form.save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
