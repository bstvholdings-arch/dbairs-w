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
  isValidCallbackUrl,
  isValidContactEmail,
  type IntegrationTenantRow,
} from "@/lib/integrations";

/**
 * 商户对接资料编辑弹窗（区域 D 的【编辑】）。
 *
 * 只允许改两件事：
 *   contactEmail      对接联系邮箱（发密钥 / 通知的默认收件人）
 *   apiCallbackUrl    商户专属回调地址（可选，留空 = 沿用平台默认）
 * 专属 API Key 不在这里改：重置密钥是独立动作，走 POST /reset-key，
 * 避免「顺手保存」把正在使用的密钥改坏。
 */
export function TenantContactModal({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: IntegrationTenantRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const emailRef = useRef<HTMLInputElement>(null);

  const [contactEmail, setContactEmail] = useState(tenant.contactEmail);
  const [callbackUrl, setCallbackUrl] = useState(tenant.apiCallbackUrl);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      emailRef.current?.focus();
      emailRef.current?.select();
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

    const email = contactEmail.trim();
    const callback = callbackUrl.trim();

    if (!email && !callback) {
      setError(t("integrations.form.error.empty"));
      return;
    }

    if (email && !isValidContactEmail(email)) {
      setError(t("integrations.form.error.emailInvalid"));
      return;
    }

    if (callback && !isValidCallbackUrl(callback)) {
      setError(t("integrations.form.error.callbackInvalid"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactEmail: email,
          apiCallbackUrl: callback,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !data.success) {
        setError(data.error || t("integrations.error.network"));
        return;
      }

      onSaved();
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
        className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f0d27c]/80 to-transparent" />
        <form onSubmit={handleSubmit}>
          <div className="max-h-[80vh] overflow-y-auto px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] uppercase tracking-[0.22em] text-[#d4af37]/60">
                  {t("integrations.form.eyebrow")}
                </p>
                <h2
                  id={titleId}
                  className="mt-1 text-lg font-semibold text-white"
                >
                  {t("integrations.form.title")}
                </h2>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {tenant.name}
                  <span className="ml-2 font-mono text-[10px] text-neutral-600">
                    {tenant.subdomain}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-white/20 hover:text-neutral-200 disabled:opacity-50"
                aria-label={t("common.close")}
              >
                ✕
              </button>
            </div>

            <label className="mt-5 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("integrations.form.contactEmail")}
              </span>
              <input
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="off"
                maxLength={120}
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder={t("integrations.form.contactEmailPlaceholder")}
                className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
              />
              <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
                {t("integrations.form.emailHint")}
              </span>
            </label>

            <label className="mt-4 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("integrations.form.callbackUrl")}
              </span>
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                maxLength={500}
                value={callbackUrl}
                onChange={(event) => setCallbackUrl(event.target.value)}
                placeholder={t("integrations.form.callbackUrlPlaceholder")}
                className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
              />
              <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
                {t("integrations.form.callbackHint")}
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
