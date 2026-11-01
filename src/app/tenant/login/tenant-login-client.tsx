"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LOGIN_ERROR_KEYS } from "@/lib/i18n-keys";
import type { TranslationKey } from "@/lib/i18n-types";
import { TENANT_HOME_PATH } from "@/lib/rbac";

type LoginResponse = {
  success?: boolean;
  token?: string;
  role?: string;
  error?: string;
};

/**
 * 商户后台独立登录页的表单。
 *
 * 与平台 /login 的差异：
 * 1. 请求体带 portal: "tenant"，非 tenant_admin 账号由 /api/auth/login 直接 403；
 * 2. 登录成功强制跳转 /tenant/dashboard，不接受 next 参数（避免被带到平台后台）。
 * 视觉沿用主登录页的金色卡片 / 渐变按钮样式。
 */
export function TenantLoginClient() {
  const { t } = useLanguage();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!identifier.trim() || !password) {
      setError("login.error.required");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: identifier.trim(),
          password,
          portal: "tenant",
        }),
      });

      const data: LoginResponse = await response
        .json()
        .catch(() => ({}) as LoginResponse);

      if (!response.ok || !data.success || !data.token) {
        const errorKey = data.error
          ? LOGIN_ERROR_KEYS[data.error as keyof typeof LOGIN_ERROR_KEYS]
          : undefined;

        setError(errorKey ?? "login.error.fallback");
        return;
      }

      // 登录 cookie 已由接口以 httpOnly 形式下发；这里整页跳转，
      // 让商户后台的会话状态完全重新初始化。
      window.location.href = TENANT_HOME_PATH;
    } catch {
      setError("login.error.network");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050505] px-4 py-12 font-sans text-neutral-200">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-[#d4af37]/10 blur-[140px]" />
        <div className="absolute -bottom-48 -right-40 h-[34rem] w-[34rem] rounded-full bg-[#8a6a1f]/15 blur-[160px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.72)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(212,175,55,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(212,175,55,0.06)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_72%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_72%)]" />
      </div>

      <section className="relative w-full max-w-[420px]">
        <div
          aria-hidden="true"
          className="absolute -inset-px rounded-[20px] bg-gradient-to-b from-[#d4af37]/30 via-[#d4af37]/5 to-transparent"
        />

        <div className="relative overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-[#0a0a0a]/95 px-6 py-9 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9),0_0_60px_-25px_rgba(212,175,55,0.45)] backdrop-blur-xl sm:px-10 sm:py-11">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f0d27c]/80 to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-3 rounded-xl border border-[#d4af37]/10"
          />

          <div className="relative">
            <div className="absolute right-0 top-0 z-10">
              <LanguageSwitcher />
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d4af37]/40 bg-[#d4af37]/5 shadow-[0_0_30px_-8px_rgba(212,175,55,0.55)]">
                <svg
                  viewBox="0 0 24 24"
                  className="h-7 w-7"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12 2.5 21 12l-9 9.5L3 12l9-9.5Z"
                    stroke="url(#gold-diamond-tenant)"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M12 7.5 16.5 12 12 16.5 7.5 12 12 7.5Z"
                    fill="url(#gold-diamond-tenant)"
                    fillOpacity="0.85"
                  />
                  <defs>
                    <linearGradient
                      id="gold-diamond-tenant"
                      x1="3"
                      y1="2.5"
                      x2="21"
                      y2="21.5"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop stopColor="#f7e7a8" />
                      <stop offset="0.5" stopColor="#d4af37" />
                      <stop offset="1" stopColor="#8a6a1f" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <p className="mt-5 bg-gradient-to-r from-[#f7e7a8] via-[#d4af37] to-[#a8842a] bg-clip-text text-[11px] font-semibold uppercase tracking-[0.45em] text-transparent">
                {t("tenantLogin.eyebrow")}
              </p>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#f8f3e6] sm:text-[34px]">
                {t("tenantLogin.welcome")}
              </h1>
              <p className="mt-2 text-sm leading-6 text-neutral-500">
                {t("tenantLogin.subtitle")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
              <div>
                <label
                  htmlFor="tenant-identifier"
                  className="mb-2 flex items-center justify-between text-[11px] font-medium tracking-[0.18em] text-[#d4af37]/75"
                >
                  <span>{t("tenantLogin.identifier")}</span>
                  <span className="text-[9px] tracking-[0.22em] text-neutral-700">
                    {t("tenantLogin.identifierHint")}
                  </span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#d4af37]/45">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-[18px] w-[18px]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
                      <path d="m4 7 8 6 8-6" />
                    </svg>
                  </span>
                  <input
                    id="tenant-identifier"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    placeholder={t("tenantLogin.identifierPlaceholder")}
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    disabled={loading}
                    className="h-12 w-full rounded-lg border border-[#d4af37]/20 bg-[#0f0f0f] pl-11 pr-4 text-base text-[#f5efe0] caret-[#d4af37] outline-none transition-colors duration-300 placeholder:text-neutral-600 hover:border-[#d4af37]/40 focus:border-[#d4af37]/70 focus:ring-2 focus:ring-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="tenant-password"
                  className="mb-2 flex items-center justify-between text-[11px] font-medium tracking-[0.18em] text-[#d4af37]/75"
                >
                  <span>{t("login.password")}</span>
                  <span className="text-[9px] tracking-[0.22em] text-neutral-700">
                    {t("login.passwordHint")}
                  </span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#d4af37]/45">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-[18px] w-[18px]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
                      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                      <path d="M12 14.5v2" />
                    </svg>
                  </span>
                  <input
                    id="tenant-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder={t("login.passwordPlaceholder")}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={loading}
                    className="h-12 w-full rounded-lg border border-[#d4af37]/20 bg-[#0f0f0f] pl-11 pr-12 text-base text-[#f5efe0] caret-[#d4af37] outline-none transition-colors duration-300 placeholder:text-neutral-600 hover:border-[#d4af37]/40 focus:border-[#d4af37]/70 focus:ring-2 focus:ring-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    disabled={loading}
                    aria-pressed={showPassword}
                    aria-label={
                      showPassword
                        ? t("login.hidePassword")
                        : t("login.showPassword")
                    }
                    title={
                      showPassword
                        ? t("login.hidePassword")
                        : t("login.showPassword")
                    }
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 transition-colors hover:text-[#d4af37] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {showPassword ? (
                      <svg
                        viewBox="0 0 24 24"
                        className="h-[18px] w-[18px]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.7a2 2 0 0 0 2.8 2.8" />
                        <path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c5.5 0 9 7 9 7a15.8 15.8 0 0 1-2.4 3.3" />
                        <path d="M6.6 6.7A15.6 15.6 0 0 0 3 12s3.5 7 9 7a9.6 9.6 0 0 0 4.1-.9" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        className="h-[18px] w-[18px]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3.5 py-3 text-[13px] leading-5 text-red-300"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="mt-0.5 h-4 w-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5v5" />
                    <path d="M12 16.5h.01" />
                  </svg>
                  <span>{t(error)}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="group relative flex h-12 w-full items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(110deg,#7a5c17_0%,#f0d27c_45%,#d4af37_55%,#7a5c17_100%)] [background-position:0%_50%] [background-size:200%_100%] text-sm font-bold tracking-[0.12em] text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-all duration-500 hover:[background-position:100%_50%] hover:shadow-[0_16px_40px_-10px_rgba(212,175,55,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0d27c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 -left-1/3 w-1/3 -translate-x-full skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-[420%]"
                />
                <span className="relative flex items-center gap-2">
                  {loading ? t("login.submitting") : t("tenantLogin.submit")}
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14" />
                    <path d="m13 6 6 6-6 6" />
                  </svg>
                </span>
              </button>
            </form>

            <div className="mt-4 flex items-center justify-center gap-4 text-[11px] font-semibold">
              <Link
                href="/forgot-password"
                className="text-[#d4af37]/80 transition-colors hover:text-[#f0d27c]"
              >
                {t("login.forgotPassword")}
              </Link>
              <span aria-hidden="true" className="text-neutral-700">
                ·
              </span>
              <Link
                href="/login"
                className="text-neutral-500 transition-colors hover:text-neutral-300"
              >
                {t("tenantLogin.platformEntry")}
              </Link>
            </div>

            <p className="mt-5 text-center text-[11px] leading-5 text-neutral-600">
              {t("tenantLogin.notice")}
            </p>

            <div className="mt-7 flex items-center justify-between border-t border-[#d4af37]/10 pt-5 text-[9px] uppercase tracking-[0.22em] text-neutral-700">
              <span>{t("login.secureAccess")}</span>
              <span className="flex items-center gap-1.5 text-[#d4af37]/45">
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V6l-7-3Z" />
                </svg>
                TLS 1.3
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
