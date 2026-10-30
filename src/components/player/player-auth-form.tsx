"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { TranslationKey } from "@/lib/i18n-types";
import { playerErrorKey } from "@/lib/player-errors";
import {
  readPlayerEmail,
  readPlayerPassword,
  readPlayerReferralCode,
  readPlayerUsername,
} from "@/lib/player-validation";
import { buildStorefrontTheme } from "@/lib/storefront";

type AuthMode = "login" | "register";

type ApiErrorPayload = {
  error?: string;
  code?: string;
};

const PLAYER_DEFAULT_THEME = "#d4af37";

const FIELD_CLASS =
  "mt-1.5 h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-brand/50 focus:ring-1 focus:ring-brand/25";

/** 只允许站内相对路径，防止 ?next=https://evil 之类的开放跳转。 */
function safeNextPath(value: string) {
  const next = value.trim();

  if (!next.startsWith("/") || next.startsWith("//")) {
    return "";
  }

  return next;
}

/**
 * 玩家登录 / 注册表单。
 * 与后台管理员登录完全独立：成功后只写 httpOnly `player_token`，不碰管理员会话。
 */
export function PlayerAuthForm({
  mode,
  nextPath,
  site,
  referralCode,
}: {
  mode: AuthMode;
  nextPath: string;
  site: string;
  referralCode: string;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const theme = useMemo(() => buildStorefrontTheme(PLAYER_DEFAULT_THEME), []);

  const safeNext = safeNextPath(nextPath);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referral, setReferral] = useState(
    readPlayerReferralCode(referralCode) || "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const isRegister = mode === "register";

  useEffect(() => {
    document.title = isRegister
      ? t("player.auth.registerDocumentTitle")
      : t("player.auth.loginDocumentTitle");
  }, [isRegister, t]);

  function buildHref(target: AuthMode) {
    const params = new URLSearchParams();

    if (safeNext) {
      params.set("next", safeNext);
    }

    if (site) {
      params.set("site", site);
    }

    if (target === "register" && referral) {
      params.set("ref", referral);
    }

    const query = params.toString();

    return `/player/${target}${query ? `?${query}` : ""}`;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setErrorMessage("");

    const normalizedUsername = readPlayerUsername(username);

    if (!normalizedUsername) {
      setErrorKey("player.error.usernameInvalid");
      return;
    }

    const normalizedPassword = readPlayerPassword(password);

    if (!normalizedPassword) {
      setErrorKey("player.error.passwordInvalid");
      return;
    }

    let normalizedEmail = "";

    if (isRegister) {
      const parsedEmail = readPlayerEmail(email);

      if (parsedEmail === null) {
        setErrorKey("player.error.emailInvalid");
        return;
      }

      normalizedEmail = parsedEmail;

      if (confirmPassword !== password) {
        setErrorKey("player.error.passwordMismatch");
        return;
      }
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/player/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(
          isRegister
            ? {
                username: normalizedUsername,
                password: normalizedPassword,
                confirmPassword,
                email: normalizedEmail,
                referralCode: referral,
                ...(site ? { site } : {}),
              }
            : {
                username: normalizedUsername,
                password: normalizedPassword,
                ...(site ? { site } : {}),
              },
        ),
      });

      const data = (await response
        .json()
        .catch(() => ({}))) as ApiErrorPayload;

      if (!response.ok) {
        setErrorKey(
          playerErrorKey(data.code) ??
            (isRegister
              ? "player.error.generic"
              : "player.error.invalidCredentials"),
        );
        setErrorMessage(data.error ?? "");
        return;
      }

      router.replace(safeNext || "/player/profile");
      router.refresh();
    } catch {
      setErrorKey("common.networkError");
      setErrorMessage("");
    } finally {
      setSubmitting(false);
    }
  }

  const errorText = errorKey ? t(errorKey) : errorMessage;
  const titleKey = isRegister
    ? "player.auth.registerTitle"
    : "player.auth.loginTitle";
  const subtitleKey = isRegister
    ? "player.auth.registerSubtitle"
    : "player.auth.loginSubtitle";

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#040404] font-sans text-neutral-200"
      style={theme.style}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand/10 blur-[160px]" />
        <div className="absolute -right-32 top-24 h-[30rem] w-[30rem] rounded-full bg-fuchsia-600/10 blur-[160px]" />
        <div className="absolute bottom-[-20rem] left-1/3 h-[34rem] w-[34rem] rounded-full bg-cyan-500/10 blur-[180px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_5%,transparent_70%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,black_5%,transparent_70%)]" />
      </div>

      <header className="relative z-10 border-b border-brand/10 bg-[#050505]/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-pale via-brand to-brand-deep text-[11px] font-black tracking-tight text-brand-ink shadow-[0_0_28px_-8px_var(--sf-a95)]">
              DB
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/30"
              />
            </span>
            <span className="leading-none">
              <span className="block bg-gradient-to-r from-brand-pale via-brand-soft to-brand-deep bg-clip-text text-[15px] font-black tracking-[0.24em] text-transparent">
                DB AIRS
              </span>
              <span className="mt-1.5 block text-[8px] uppercase tracking-[0.34em] text-neutral-600">
                {t("player.auth.eyebrow")}
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link
              href="/"
              className="hidden h-9 items-center rounded-full border border-white/[0.08] px-4 text-[11px] font-semibold text-neutral-400 transition-colors hover:border-brand/30 hover:text-brand-soft sm:inline-flex"
            >
              {t("player.auth.backToLobby")}
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-[1200px] items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-8 lg:py-16">
        <section className="hidden lg:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.38em] text-brand-soft/80">
            {t("player.auth.eyebrow")}
          </p>
          <h1 className="mt-4 max-w-lg text-4xl font-black leading-tight text-neutral-50">
            {t("player.auth.brandTitle")}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-neutral-400">
            {t("player.auth.brandSubtitle")}
          </p>

          <ul className="mt-8 space-y-3">
            {(
              [
                "player.auth.featureWallet",
                "player.auth.featureHistory",
                "player.auth.featureBonus",
                "player.auth.featureReferral",
              ] as TranslationKey[]
            ).map((key) => (
              <li
                key={key}
                className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/10 text-brand-soft">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m5 12.5 4.2 4L19 7" />
                  </svg>
                </span>
                <span className="text-xs text-neutral-300">{t(key)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-8 max-w-md text-[10px] leading-4 text-neutral-600">
            {t("player.auth.secureNote")}
          </p>
        </section>

        <section>
          <div className="relative overflow-hidden rounded-2xl border border-brand/20 bg-[#080808]/95 p-6 shadow-[0_40px_120px_-40px_var(--sf-a50)] sm:p-8">
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-soft to-transparent"
            />
            <h2 className="text-xl font-bold text-neutral-50">{t(titleKey)}</h2>
            <p className="mt-1.5 text-xs leading-5 text-neutral-500">
              {t(subtitleKey)}
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <AuthField
                label={t("player.auth.username")}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                maxLength={32}
                required
                placeholder={t("player.auth.usernamePlaceholder")}
              />

              {isRegister ? (
                <AuthField
                  label={t("player.auth.email")}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  maxLength={120}
                  placeholder={t("player.auth.emailPlaceholder")}
                />
              ) : null}

              <AuthField
                label={t("player.auth.password")}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
                placeholder={t("player.auth.passwordPlaceholder")}
              />

              {isRegister ? (
                <>
                  <AuthField
                    label={t("player.auth.confirmPassword")}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder={t("player.auth.confirmPasswordPlaceholder")}
                  />

                  <AuthField
                    label={t("player.auth.referralCode")}
                    value={referral}
                    onChange={(event) =>
                      setReferral(event.target.value.toUpperCase())
                    }
                    maxLength={16}
                    placeholder={t("player.auth.referralPlaceholder")}
                    className="uppercase tracking-[0.12em] placeholder:normal-case placeholder:tracking-normal"
                  />
                </>
              ) : null}

              {errorText ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] leading-5 text-red-300"
                >
                  {errorText}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft text-sm font-bold text-brand-ink shadow-[0_18px_40px_-18px_var(--sf-a95)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? t(
                      isRegister
                        ? "player.auth.registering"
                        : "player.auth.loggingIn",
                    )
                  : t(isRegister ? "player.auth.register" : "player.auth.login")}
              </button>
            </form>

            <p className="mt-5 text-center text-[11px] text-neutral-500">
              {isRegister
                ? t("player.auth.hasAccount")
                : t("player.auth.noAccount")}{" "}
              <Link
                href={buildHref(isRegister ? "login" : "register")}
                className="font-semibold text-brand-soft transition-colors hover:text-brand-pale"
              >
                {isRegister
                  ? t("player.auth.backToLogin")
                  : t("player.auth.createAccount")}
              </Link>
            </p>

            {!isRegister ? (
              <p className="mt-2 text-center text-[11px]">
                <Link
                  href="/forgot-password"
                  className="font-semibold text-brand-soft/80 transition-colors hover:text-brand-pale"
                >
                  {t("player.auth.forgotPassword")}
                </Link>
              </p>
            ) : null}

            <p className="mt-3 text-center text-[10px] leading-4 text-neutral-600 lg:hidden">
              {t("player.auth.secureNote")}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function AuthField({
  label,
  className,
  ...props
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </span>
      <input
        {...props}
        className={`${FIELD_CLASS}${className ? ` ${className}` : ""}`}
      />
    </label>
  );
}

