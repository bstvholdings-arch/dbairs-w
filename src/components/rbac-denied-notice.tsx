"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useLanguage } from "@/components/LanguageProvider";
import {
  PERMISSION_LABEL_KEYS,
  RBAC_ROLE_NAME_KEYS,
} from "@/lib/i18n-keys";
import { isPermission, type AdminRole } from "@/lib/rbac";

/**
 * 「无权限」提示条。
 *
 * 非授权角色强行输入 URL 时，proxy 会把他送回自己的首页并带上
 * ?denied=<权限点>，这里负责把提示画出来，并提供「知道了」清除参数。
 * 放在 ConsoleShell 里，因此平台后台与租户控制台共用同一套提示。
 */
export function RbacDeniedNotice({ role }: { role: AdminRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const denied = searchParams.get("denied");

  if (!denied) {
    return null;
  }

  const permissionLabel = isPermission(denied)
    ? t(PERMISSION_LABEL_KEYS[denied])
    : t("rbac.permission.tenantZone");

  function dismiss() {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("denied");
    const query = nextParams.toString();

    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div
      role="alert"
      data-rbac-denied={denied}
      data-rbac-role={role}
      className="mb-5 flex flex-col gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-red-400/40 text-[10px] font-bold text-red-300"
        >
          !
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-red-200">
            {t("rbac.denied")}
          </p>
          <p className="mt-0.5 text-[10px] leading-5 text-neutral-400">
            {t("rbac.deniedDetail", {
              permission: permissionLabel,
              role: t(RBAC_ROLE_NAME_KEYS[role]),
            })}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] px-3 text-[10px] text-neutral-300 transition-colors hover:border-red-400/40 hover:text-red-200"
      >
        {t("rbac.dismiss")}
      </button>
    </div>
  );
}
