"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { TranslationKey } from "@/lib/i18n-types";
import type { PasswordResetAccountType } from "@/lib/password-reset";
import { readPlayerEmail, readPlayerPassword } from "@/lib/player-validation";

type ApiResponse = {
  success?: boolean;
  message?: string;
  code?: string;
  error?: string;
  accountType?: PasswordResetAccountType;
};

const FIELD_CLASS =
  "mt-1.5 h-12 w-full rounded-xl border border-[#d4af37]/20 bg-[#0f0f0f] px-3.5 text-sm text-[#f5efe0] caret-[#d4af37] outline-none transition-colors placeholder:text-neutral-600 hover:border-[#d4af37]/40 focus:border-[#d4af37]/70 focus:ring-2 focus:ring-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-60";

const API_ERROR_KEYS: Record<string, TranslationKey> = {
  invalid_request: "passwordReset.error.generic",
  password_invalid: "passwordReset.error.passwordInvalid",
  password_mismatch: "passwordReset.error.passwordMismatch",
  reset_token_invalid: "passwordReset.error.tokenInvalid",
  reset_failed: "passwordReset.error.generic",
};

function errorKeyFrom(data: ApiResponse): TranslationKey | null {
  return data.code ? (API_ERROR_KEYS[data.code] ?? null) : null;
}

function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050505] px-4 py-12 font-sans text-neutral-200">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-[#d4af37]/10 blur-[140px]" />
        <div className="absolute -bottom-48 -right-40 h-[34rem] w-[34rem] rounded-full bg-[#8a6a1f]/15 blur-[160px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.72)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(212,175,55,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(212,175,55,0.06)_1px,transparent_1px)] [background-size:64px_64px] opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      <div className="relative z-10 w-full max-w-[26rem]">
        <div className="mb-6 flex items-start justify-between gap-4">
          <Link href="/" className="group flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#f0d27c] shadow-[0_0_24px_-8px_rgba(212,175,55,0.7)]">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m12 3 7 5-7 13L5 8l7-5Z" />
                <path d="m5 8 7 4 7-4" />
                <path d="M12 12v9" />
              </svg>
            </span>
            <span>
              <span className="block text-sm font-bold tracking-[0.22em] text-[#f5efe0] transition-colors group-hover:text-[#f0d27c]">
                {t("player.auth.brandTitle")}
              </span>
              <span className="mt-0.5 block text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/55">
                {t("passwordReset.brandSubtitle")}
              </span>
            </span>
          </Link>
          <LanguageSwitcher />
        </div>

        <section className="relative overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-[#0a0a0a]/95 p-6 shadow-[0_30px_80px_-40px_rgba(212,175,55,0.45)] sm:p-7">
          <span
            aria-hidden="true"
            className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/70 to-transparent"
          />
          {children}
        </section>

        <p className="mt-5 text-center text-[10px] leading-5 text-neutral-600">
          {t("passwordReset.secureNote")}
        </p>
      </div>
    </main>
  );
}

function ResetField({
  label,
  className,
  ...props
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d4af37]/75">
        {label}
      </span>
      <input
        {...props}
        className={`${FIELD_CLASS}${className ? ` ${className}` : ""}`}
      />
    </label>
  );
}

function PrimaryButton({
  loading,
  loadingKey,
  labelKey,
}: {
  loading: boolean;
  loadingKey: TranslationKey;
  labelKey: TranslationKey;
}) {
  const { t } = useLanguage();

  return (
    <button
      type="submit"
      disabled={loading}
      className="group relative mt-1 flex h-12 w-full items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(110deg,#7a5c17_0%,#f0d27c_45%,#d4af37_55%,#7a5c17_100%)] [background-position:0%_50%] [background-size:200%_100%] text-sm font-bold tracking-[0.1em] text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-all duration-500 hover:[background-position:100%_50%] hover:shadow-[0_16px_40px_-10px_rgba(212,175,55,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0d27c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 -left-1/3 w-1/3 -translate-x-full skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-[420%]"
      />
      <span className="relative">{t(loading ? loadingKey : labelKey)}</span>
    </button>
  );
}

function LoginLinks({
  accountType = null,
}: {
  accountType?: PasswordResetAccountType | null;
}) {
  const { t } = useLanguage();
  const showPlayer = accountType !== "admin";
  const showAdmin = accountType !== "player";

  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px]">
      {showPlayer ? (
        <Link
          href="/player/login"
          className="font-semibold text-[#d4af37]/85 transition-colors hover:text-[#f0d27c]"
        >
          {t("passwordReset.backToPlayerLogin")}
        </Link>
      ) : null}
      {showAdmin ? (
        <Link
          href="/login"
          className="font-semibold text-[#d4af37]/85 transition-colors hover:text-[#f0d27c]"
        >
          {t("passwordReset.backToAdminLogin")}
        </Link>
      ) : null}
    </div>
  );
}

function InvalidLinkState() {
  const { t } = useLanguage();

  return (
    <div role="alert">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#d4af37]/60">
        {t("passwordReset.eyebrow")}
      </p>
      <h1 className="mt-2 text-2xl font-bold text-[#f5efe0]">
        {t("passwordReset.invalidLinkTitle")}
      </h1>
      <p className="mt-2 text-sm leading-6 text-neutral-500">
        {t("passwordReset.invalidLinkMessage")}
      </p>
      <Link
        href="/forgot-password"
        className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#7a5c17] via-[#d4af37] to-[#7a5c17] text-sm font-bold tracking-[0.1em] text-[#171105] transition-opacity hover:opacity-90"
      >
        {t("passwordReset.tryAgain")}
      </Link>
      <LoginLinks />
    </div>
  );
}

export function ForgotPasswordForm() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  useEffect(() => {
    document.title = t("passwordReset.forgotDocumentTitle");
  }, [t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);

    const normalizedEmail = readPlayerEmail(email);

    if (!normalizedEmail) {
      setErrorKey("passwordReset.error.emailInvalid");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data: ApiResponse = await response
        .json()
        .catch(() => ({}) as ApiResponse);

      if (!response.ok || !data.success) {
        setErrorKey(errorKeyFrom(data) ?? "passwordReset.error.generic");
        return;
      }

      // 接口刻意不区分邮箱是否存在，前端也只展示统一的“已发送”状态。
      setSent(true);
    } catch {
      setErrorKey("passwordReset.error.network");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      {sent ? (
        <div role="status">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#f0d27c]">
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m5 12 4.5 4.5L19 7" />
            </svg>
          </span>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#d4af37]/60">
            {t("passwordReset.eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[#f5efe0]">
            {t("passwordReset.sentTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            {t("passwordReset.sentMessage")}
          </p>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setEmail("");
              setErrorKey(null);
            }}
            className="mt-6 h-11 w-full rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/[0.06] text-xs font-semibold tracking-[0.08em] text-[#f0d27c] transition-colors hover:border-[#d4af37]/45 hover:bg-[#d4af37]/10"
          >
            {t("passwordReset.tryAgain")}
          </button>
          <LoginLinks />
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#d4af37]/60">
            {t("passwordReset.eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[#f5efe0]">
            {t("passwordReset.forgotTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            {t("passwordReset.forgotSubtitle")}
          </p>

          <div className="mt-6">
            <ResetField
              label={t("passwordReset.email")}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              placeholder={t("passwordReset.emailPlaceholder")}
            />
          </div>

          {errorKey ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] leading-5 text-red-300"
            >
              {t(errorKey)}
            </p>
          ) : null}

          <div className="mt-5">
            <PrimaryButton
              loading={submitting}
              loadingKey="passwordReset.sending"
              labelKey="passwordReset.sendLink"
            />
          </div>

          <LoginLinks />
        </form>
      )}
    </AuthShell>
  );
}


export function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [accountType, setAccountType] =
    useState<PasswordResetAccountType | null>(null);
  const [tokenRejected, setTokenRejected] = useState(!token.trim());
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  useEffect(() => {
    document.title = t("passwordReset.resetDocumentTitle");
  }, [t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);

    const normalizedPassword = readPlayerPassword(password);

    if (!normalizedPassword) {
      setErrorKey("passwordReset.error.passwordInvalid");
      return;
    }

    if (confirmPassword !== normalizedPassword) {
      setErrorKey("passwordReset.error.passwordMismatch");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          newPassword: normalizedPassword,
          confirmPassword,
        }),
      });
      const data: ApiResponse = await response
        .json()
        .catch(() => ({}) as ApiResponse);

      if (!response.ok || !data.success) {
        if (data.code === "reset_token_invalid") {
          setTokenRejected(true);
          return;
        }

        setErrorKey(errorKeyFrom(data) ?? "passwordReset.error.generic");
        return;
      }

      setAccountType(
        data.accountType === "admin" || data.accountType === "player"
          ? data.accountType
          : null,
      );
      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch {
      setErrorKey("passwordReset.error.network");
    } finally {
      setSubmitting(false);
    }
  }

  if (tokenRejected) {
    return (
      <AuthShell>
        <InvalidLinkState />
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell>
        <div role="status">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#f0d27c]">
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m5 12 4.5 4.5L19 7" />
            </svg>
          </span>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#d4af37]/60">
            {t("passwordReset.eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[#f5efe0]">
            {t("passwordReset.successTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            {t("passwordReset.successMessage")}
          </p>
          {accountType ? (
            <Link
              href={accountType === "admin" ? "/login" : "/player/login"}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#7a5c17] via-[#d4af37] to-[#7a5c17] text-sm font-bold tracking-[0.1em] text-[#171105] transition-opacity hover:opacity-90"
            >
              {t(
                accountType === "admin"
                  ? "passwordReset.backToAdminLogin"
                  : "passwordReset.backToPlayerLogin",
              )}
            </Link>
          ) : (
            <LoginLinks />
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} noValidate>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#d4af37]/60">
          {t("passwordReset.eyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#f5efe0]">
          {t("passwordReset.resetTitle")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          {t("passwordReset.resetSubtitle")}
        </p>

        <div className="mt-6 space-y-4">
          <ResetField
            label={t("passwordReset.newPassword")}
            type="password"
            name="newPassword"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            placeholder={t("passwordReset.passwordPlaceholder")}
          />
          <ResetField
            label={t("passwordReset.confirmPassword")}
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={submitting}
            placeholder={t("passwordReset.confirmPasswordPlaceholder")}
          />
        </div>

        {errorKey ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] leading-5 text-red-300"
          >
            {t(errorKey)}
          </p>
        ) : null}

        <div className="mt-5">
          <PrimaryButton
            loading={submitting}
            loadingKey="passwordReset.resetting"
            labelKey="passwordReset.resetSubmit"
          />
        </div>

        <div className="mt-5 text-center">
          <Link
            href="/forgot-password"
            className="text-[11px] font-semibold text-[#d4af37]/80 transition-colors hover:text-[#f0d27c]"
          >
            {t("passwordReset.tryAgain")}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

