"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";

/**
 * 超管代登录商户后台时的顶部安全横幅。
 *
 * 目标：让操作者时刻清楚「我现在看到的是某个商户的数据」，
 * 并提供一个「一键退出」把票据 cookie 清掉、回到租户管理列表。
 */
export function ImpersonationBanner({
  tenantName,
  adminUsername,
}: {
  tenantName: string;
  adminUsername: string;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleExit() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/admin/impersonation", {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        redirectTo?: string;
        error?: string;
      };

      if (!response.ok || !data.success) {
        setError(data.error || t("impersonation.banner.exitFailed"));
        return;
      }

      router.replace(data.redirectTo || "/admin/tenants");
      router.refresh();
    } catch {
      setError(t("impersonation.banner.exitFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-400/[0.08] px-4 py-3 text-amber-100 shadow-[0_18px_40px_-30px_rgba(251,191,36,0.9)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-400/15 text-sm">
            !
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.12em]">
              {t("impersonation.banner.title")}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-amber-200/90">
              {t("impersonation.banner.body", {
                tenant: tenantName,
                admin: adminUsername,
              })}
            </p>
            {error ? (
              <p className="mt-1 text-[11px] text-red-300">{error}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleExit()}
          disabled={busy}
          className="h-9 shrink-0 self-start rounded-xl border border-amber-300/40 bg-amber-300/15 px-3 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/25 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
        >
          {busy ? t("common.saving") : t("impersonation.banner.exit")}
        </button>
      </div>
    </div>
  );
}
