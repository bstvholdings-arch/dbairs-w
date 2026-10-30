"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ADMIN_ROLE_LABEL_KEYS } from "@/lib/i18n-keys";
import type { TranslationKey } from "@/lib/i18n-types";
import { can, type Permission } from "@/lib/rbac";

import { RbacDeniedNotice } from "@/components/rbac-denied-notice";
import { LogoutButton } from "@/app/logout-button";
import type { AdminRole } from "@/lib/session";

type NavIconName =
  | "dashboard"
  | "providers"
  | "games"
  | "tenants"
  | "storefront"
  | "gateways"
  | "finance"
  | "players"
  | "ai"
  | "staff"
  | "preview";

type NavItem = {
  labelKey: TranslationKey;
  href: string;
  icon: NavIconName;
  /**
   * 访问该菜单需要的权限点，与 src/lib/rbac.ts 的矩阵一一对应。
   * 租户控制台整体按角色分区（只有 tenant_admin 能进来），因此租户菜单不设权限点。
   */
  permission?: Permission;
};

/**
 * 平台后台菜单：不区分角色，渲染时按 ROLE_PERMISSIONS 过滤。
 * 新增菜单时只要给出 permission，财务 / 技术 / 客服的菜单会自动收敛。
 */
const PLATFORM_NAV: NavItem[] = [
  {
    labelKey: "nav.dashboard",
    href: "/admin",
    icon: "dashboard",
    permission: "dashboard",
  },
  {
    labelKey: "nav.providers",
    href: "/admin/providers",
    icon: "providers",
    permission: "providers",
  },
  {
    labelKey: "nav.games",
    href: "/admin/games",
    icon: "games",
    permission: "games",
  },
  {
    labelKey: "nav.tenants",
    href: "/admin/tenants",
    icon: "tenants",
    permission: "tenants",
  },
  // 前台装修：主色 + 大厅模块开关/排序，影响的是玩家看到的 / 与品牌展馆
  {
    labelKey: "nav.storefront",
    href: "/admin/storefront",
    icon: "storefront",
    permission: "storefront",
  },
  {
    labelKey: "nav.payments",
    href: "/admin/payments",
    icon: "gateways",
    permission: "payments",
  },
  {
    labelKey: "nav.finance",
    href: "/finance",
    icon: "finance",
    permission: "finance",
  },
  // AI 中控台：销售对话 + 战败分析，线索联系方式敏感，只有 super_admin 拥有 aiConsole 权限
  {
    labelKey: "nav.aiConsole",
    href: "/admin/ai-console",
    icon: "ai",
    permission: "aiConsole",
  },
  // 员工管理：只有 super_admin 拥有 staff 权限
  {
    labelKey: "nav.staff",
    href: "/admin/staff",
    icon: "staff",
    permission: "staff",
  },
];

const TENANT_ADMIN_NAV: NavItem[] = [
  { labelKey: "nav.tenantDashboard", href: "/tenant", icon: "dashboard" },
  {
    labelKey: "nav.tenantProviders",
    href: "/tenant/providers",
    icon: "providers",
  },
  { labelKey: "nav.tenantPlayers", href: "/tenant/players", icon: "players" },
  {
    labelKey: "nav.tenantPayments",
    href: "/tenant/payments",
    icon: "gateways",
  },
  { labelKey: "nav.finance", href: "/finance", icon: "finance" },
];


function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "h-4 w-4 shrink-0",
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "providers":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M7 7V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2" />
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 12h8" />
          <path d="M8 16h5" />
        </svg>
      );
    case "games":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M8 9.5h.01M12 9.5h.01M16 9.5h.01" />
          <path d="M8 14.5h.01M12 14.5h.01M16 14.5h.01" />
        </svg>
      );
    case "tenants":
      return (
        <svg {...common}>
          <path d="M3 21h18" />
          <path d="M5 21V7l7-4 7 4v14" />
          <path d="M9 21v-5h6v5" />
          <path d="M9 10h.01M15 10h.01" />
        </svg>
      );
    case "storefront":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2.5" />
          <path d="M3 8.5h18" />
          <path d="M9.5 8.5V21" />
          <path d="M13.5 12.5h4" />
          <path d="M13.5 16h3" />
        </svg>
      );
    case "gateways":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
          <path d="M7 15h3" />
          <path d="M15 15h2" />
        </svg>
      );
    case "finance":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
          <path d="M7 15h4" />
        </svg>
      );
    case "players":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
          <path d="M18 14.5c2 .8 3 2.8 3 5.5" />
        </svg>
      );
    case "ai":
      return (
        <svg {...common}>
          <path d="M12 3v3" />
          <path d="M12 18v3" />
          <path d="M4.2 7.2l2.1 2.1" />
          <path d="M17.7 14.7l2.1 2.1" />
          <path d="M3 12h3" />
          <path d="M18 12h3" />
          <circle cx="12" cy="12" r="3.6" />
        </svg>
      );
    case "staff":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" />
          <path d="M17 5.5 18.6 7 21 4.5" />
        </svg>
      );
    case "preview":
      return (
        <svg {...common}>
          <path d="M14 4h6v6" />
          <path d="M20 4l-7.5 7.5" />
          <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        </svg>
      );
  }
}

function isItemActive(pathname: string, item: NavItem, basePath: string) {
  if (item.href === basePath) {
    return pathname === item.href;
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function navClass(active: boolean) {
  return `flex shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
    active
      ? "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]"
      : "border-transparent text-neutral-500 hover:border-[#d4af37]/10 hover:bg-white/[0.03] hover:text-neutral-200"
  }`;
}
export function ConsoleShell({
  role,
  username,
  tenantName,
  children,
}: {
  role: AdminRole;
  username: string;
  tenantName?: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  // 租户控制台 / 平台后台只靠角色分区，菜单本身再按权限矩阵收敛。
  const isTenantScope = role === "tenant_admin";
  const basePath = isTenantScope ? "/tenant" : "/admin";
  const navItems = isTenantScope
    ? TENANT_ADMIN_NAV
    : PLATFORM_NAV.filter(
        (item) => !item.permission || can(role, item.permission),
      );
  const roleLabel = t(ADMIN_ROLE_LABEL_KEYS[role]);
  const scopeLabel = isTenantScope
    ? (tenantName ?? t("shell.scope.tenantFallback"))
    : t("shell.scope.platformAdmin");

  return (
    <div className="relative min-h-screen bg-[#050505] font-sans text-neutral-200">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -left-40 -top-48 h-[34rem] w-[34rem] rounded-full bg-[#d4af37]/[0.07] blur-[150px]" />
        <div className="absolute -bottom-52 -right-40 h-[36rem] w-[36rem] rounded-full bg-[#8a6a1f]/10 blur-[170px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(212,175,55,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(212,175,55,0.035)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_75%)]" />
      </div>

      <aside className="relative z-30 hidden border-[#d4af37]/10 bg-[#070707]/95 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r">
        <div className="flex items-center gap-3 border-b border-[#d4af37]/10 px-5 py-5">
          <Link
            href={basePath}
            aria-label={t("nav.backDashboard")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/20 to-transparent text-sm font-bold text-[#f0d27c] transition-colors hover:border-[#d4af37]/50"
          >
            D
          </Link>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.18em] text-[#f0d27c]">
              DBAIRS
            </p>
            <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.2em] text-neutral-600">
              {roleLabel}
            </p>
          </div>
        </div>

        <div className="px-4 py-4">
          <p className="px-1 text-[9px] uppercase tracking-[0.22em] text-neutral-700">
            {t("nav.section")}
          </p>
          <nav className="mt-3 space-y-1" aria-label={t("nav.mainAria")}>
            {navItems.map((item) => {
              const active = isItemActive(pathname, item, basePath);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={navClass(active)}
                >
                  <NavIcon name={item.icon} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto border-t border-[#d4af37]/10 px-4 py-4">
          <div className="rounded-xl border border-[#d4af37]/10 bg-[#d4af37]/[0.03] p-3">
            <p className="truncate text-[9px] uppercase tracking-[0.18em] text-neutral-700">
              {t(isTenantScope ? "shell.scope.tenant" : "shell.scope.platform")}
            </p>
            <p className="mt-1 truncate text-xs text-[#f0d27c]">{scopeLabel}</p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d4af37]/25 bg-[#d4af37]/10 text-[10px] font-semibold text-[#f0d27c]">
              {username.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">
              {username}
            </span>
            <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="relative z-20 lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-[#d4af37]/10 bg-[#050505]/90 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href={basePath}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 text-xs font-bold text-[#f0d27c] lg:hidden"
              >
                D
              </Link>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold tracking-[0.16em] text-[#f0d27c]">
                  {scopeLabel}
                </p>
                <p className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-neutral-600">
                  {roleLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-[#d4af37]/15 bg-white/[0.02] px-3 py-1.5 sm:flex">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-[10px] text-neutral-500">
                  {t(
                    isTenantScope
                      ? "shell.service.tenant"
                      : "shell.service.platform",
                  )}
                </span>
              </div>
              <LanguageSwitcher />
              {/* 预览前台：新标签页打开玩家大厅 /，后台操作不影响大厅浏览 */}
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("nav.previewLobbyAria")}
                title={t("nav.previewLobbyAria")}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#d4af37]/15 bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-neutral-400 transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 hover:text-[#f0d27c]"
              >
                <NavIcon name="preview" />
                <span className="hidden whitespace-nowrap sm:inline">
                  {t("nav.previewLobby")}
                </span>
              </a>
              <LogoutButton />
            </div>
          </div>

          <nav
            aria-label={t("nav.mobileAria")}
            className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-6 lg:hidden"
          >
            {navItems.map((item) => {
              const active = isItemActive(pathname, item, basePath);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={navClass(active)}
                >
                  <NavIcon name={item.icon} />
                  <span className="whitespace-nowrap">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {/* 越权访问被 proxy 重定向回来时（?denied=权限点）在这里提示 */}
          <Suspense fallback={null}>
            <RbacDeniedNotice role={role} />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}

