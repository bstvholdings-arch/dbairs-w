"use client";

import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";

export function LogoutButton() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { t } = useLanguage();

  async function handleLogout() {
    setIsLoggingOut(true);

    // 登录 cookie 是 httpOnly 的，只能由服务端清除；接口失败也要继续跳转。
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 网络异常时仍然跳回登录页，避免按钮卡在 loading 状态。
    }

    localStorage.removeItem("token");

    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoggingOut}
      aria-label={t("logout.aria")}
      className="group inline-flex h-9 items-center gap-2 rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/5 px-2.5 text-xs font-medium text-[#d4af37] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 hover:text-[#f0d27c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
      <span className="hidden sm:inline">
        {isLoggingOut ? t("logout.busy") : t("logout.label")}
      </span>
      <span className="sm:hidden">{t("logout.short")}</span>
    </button>
  );
}
