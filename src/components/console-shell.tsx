"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ADMIN_ROLE_LABEL_KEYS } from "@/lib/i18n-keys";
import type { TranslationKey } from "@/lib/i18n-types";
import { formatInteger } from "@/lib/format";
import { can, type Permission } from "@/lib/rbac";

import { RbacDeniedNotice } from "@/components/rbac-denied-notice";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { LogoutButton } from "@/app/logout-button";
import type { AdminRole } from "@/lib/session";

type NavIconName =
  | "dashboard"
  | "providers"
  | "games"
  | "tenants"
  | "storefront"
  | "gateways"
  | "withdrawal"
  | "finance"
  | "players"
  | "kyc"
  | "promotions"
  | "bonus"
  | "rebate"
  | "ai"
  | "staff"
  | "integrations"
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
  // API 与集成中心：回调地址 / IP 白名单 / 平台密钥状态 / 商户对接资料，
  // 密钥属于最高敏感配置，只有 super_admin 拥有 integrations 权限
  {
    labelKey: "nav.integrations",
    href: "/admin/integrations",
    icon: "integrations",
    permission: "integrations",
  },
  // 前台装修：主色 + 大厅模块开关/排序，影响的是玩家看到的 / 与品牌展馆
  {
    labelKey: "nav.storefront",
    href: "/admin/storefront",
    icon: "storefront",
    permission: "storefront",
  },
  // 注意：收款网关已彻底下放给商户（商户自行对接支付商），
  // 平台后台不再提供 Payment Gateways 配置页；
  // 超管只在「API 与集成中心 → 支付通道」页签只读监控商户的对接状态。
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

/**
 * 商户后台菜单：概览 / 玩家 / 提现审批 / KYC / 支付网关 / 财务 / 客服记录 / 站点设置。
 *
 * 平台侧的任何全局配置（租户管理、游戏库、AI 中控台、员工管理）
 * 都不会出现在这里。支付网关（/tenant/payments）已按去中心化支付架构
 * 下放给商户：商户自己填 API Endpoint、收款钱包地址与 API Secret，
 * 平台只读监控对接状态，不再提供统一收款网关。
 */

/**
 * 提现审批页路径。
 *
 * 导航栏的「待审批」角标只挂在这一项上，所以路径单独抽成常量，
 * 菜单项与角标判断共用同一份，改路径时不会漏掉其中一个。
 */
const TENANT_WITHDRAWALS_HREF = "/tenant/withdrawals";

const TENANT_ADMIN_NAV: NavItem[] = [
  {
    labelKey: "nav.tenantOverview",
    href: "/tenant/dashboard",
    icon: "dashboard",
  },
  { labelKey: "nav.tenantPlayers", href: "/tenant/players", icon: "players" },
  // 提现审批：商户就是出款方，审批必须在一级菜单一眼可见（入口太深 = 出款积压）
  {
    labelKey: "nav.tenantWithdrawals",
    href: TENANT_WITHDRAWALS_HREF,
    icon: "withdrawal",
  },
  // KYC 审核：只处理本站玩家提交的实名资料
  { labelKey: "nav.tenantKyc", href: "/tenant/kyc", icon: "kyc" },
  // 活动管理：玩家前台 /promotions 的分类与 Banner（活动图上传 + 跳转链接）
  {
    labelKey: "nav.tenantPromotions",
    href: "/tenant/promotions",
    icon: "promotions",
  },
  // 红利活动：注册 / 存款 / 首充彩金 + 流水要求（领了没打满不能提现）
  {
    labelKey: "nav.tenantBonuses",
    href: "/tenant/bonuses",
    icon: "bonus",
  },
  // 洗码返水：按品类配置每日返水费率，定时任务结算前一天流水
  {
    labelKey: "nav.tenantRebates",
    href: "/tenant/rebates",
    icon: "rebate",
  },
  // 支付网关：商户自行对接支付商（充值通道的唯一来源）
  {
    labelKey: "nav.tenantPayments",
    href: "/tenant/payments",
    icon: "gateways",
  },
  { labelKey: "nav.tenantFinance", href: "/tenant/finance", icon: "finance" },
  { labelKey: "nav.tenantAiLogs", href: "/tenant/ai-logs", icon: "ai" },
  {
    labelKey: "nav.tenantSettings",
    href: "/tenant/settings",
    icon: "storefront",
  },
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
    case "withdrawal":
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="19" height="12" rx="2" />
          <path d="M12 15V9" />
          <path d="M9.4 11.6 12 9l2.6 2.6" />
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
    case "integrations":
      return (
        <svg {...common}>
          <path d="M9 3v5" />
          <path d="M15 3v5" />
          <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
          <path d="M12 17v4" />
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
    case "kyc":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="9" cy="11" r="2.2" />
          <path d="M5.8 16.4c.6-1.6 1.9-2.4 3.2-2.4s2.6.8 3.2 2.4" />
          <path d="M15.5 10h3" />
          <path d="M15.5 13.5h2" />
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
    case "promotions":
      return (
        <svg {...common}>
          <rect x="3.5" y="9" width="17" height="11" rx="1.8" />
          <path d="M3.5 13h17" />
          <path d="M12 9v11" />
          <path d="M12 9C10.5 6 9.3 5 8 5a2 2 0 0 0 0 4Z" />
          <path d="M12 9c1.5-3 2.7-4 4-4a2 2 0 0 1 0 4Z" />
        </svg>
      );
    case "bonus":
      return (
        <svg {...common}>
          <path d="M12 3.5l2.2 4.5 4.9.7-3.5 3.4.8 4.9-4.4-2.3-4.4 2.3.8-4.9L4.9 8.7l4.9-.7Z" />
        </svg>
      );
    case "rebate":
      return (
        <svg {...common}>
          <path d="M19 5 5 19" />
          <circle cx="7.6" cy="7.6" r="2.3" />
          <circle cx="16.4" cy="16.4" r="2.3" />
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
  // 对比度：未选中用 text-neutral-300（原 neutral-500 在纯黑底上几乎看不清），
  // 悬停变白、选中变金 + 加粗 + 内描边，三种状态一眼能分出来。
  // 图标用 currentColor，跟着文字一起提亮，不需要单独改色。
  return `flex shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
    active
      ? "border-[#d4af37]/45 bg-[#d4af37]/[0.14] font-semibold text-[#f7e0a1] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.18)]"
      : "border-transparent text-neutral-300 hover:border-[#d4af37]/25 hover:bg-white/[0.06] hover:text-white"
  }`;
}
export function ConsoleShell({
  role,
  username,
  tenantName,
  previewTenantKey,
  impersonation,
  pendingWithdrawalCount = 0,
  children,
}: {
  role: AdminRole;
  username: string;
  tenantName?: string | null;
  /**
   * 当前商户的站点标识（子域名优先，没有则用 id）。
   * 【预览前台】必须带上它跳 `/?tenant=...`：不然跳过去只剩一个裸 `/`，
   * 前台只能按域名 / 会话兜底 —— 本地（或没绑域名时）就会解析成「最早创建的
   * 那个商户」，也就是历史上「代登录 abc 却看到 winvora」的根因。
   */
  previewTenantKey?: string | null;
  /** 超管代登录时传 { adminId, username }，用于渲染顶部安全横幅。 */
  impersonation?: { adminId: string; username: string } | null;
  /**
   * 「提现审批」菜单上的待审批角标（0 = 不显示）。
   * 只由 `tenant/(console)/layout.tsx` 下发的真实计数决定，前端不自己算。
   */
  pendingWithdrawalCount?: number;
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
  // 预览前台只对「有归属租户」的后台有意义；平台后台没有自己的前台，
  // 不做「随便挑一个站点」的兜底（超管要预览某家：/admin/storefront 或代登录）。
  const previewKey =
    typeof previewTenantKey === "string" ? previewTenantKey.trim() : "";
  const previewHref =
    isTenantScope && previewKey
      ? `/?tenant=${encodeURIComponent(previewKey)}`
      : null;

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
            <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.2em] text-neutral-400">
              {roleLabel}
            </p>
          </div>
        </div>

        <div className="px-4 py-4">
          <p className="px-1 text-[9px] uppercase tracking-[0.22em] text-neutral-400">
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
                  <span className="truncate">{t(item.labelKey)}</span>
                  {item.href === TENANT_WITHDRAWALS_HREF &&
                  pendingWithdrawalCount > 0 ? (
                    <span
                      aria-label={t("nav.tenantWithdrawalsPending", {
                        count: formatInteger(pendingWithdrawalCount),
                      })}
                      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d4af37] px-1.5 text-[10px] font-bold text-black"
                    >
                      {pendingWithdrawalCount > 99
                        ? "99+"
                        : formatInteger(pendingWithdrawalCount)}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto border-t border-[#d4af37]/10 px-4 py-4">
          <div className="rounded-xl border border-[#d4af37]/10 bg-[#d4af37]/[0.03] p-3">
            <p className="truncate text-[9px] uppercase tracking-[0.18em] text-neutral-400">
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
                <p className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-neutral-400">
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
              {/* 预览前台：新标签页打开「本商户自己的」大厅，
                  URL 必须带 ?tenant=，否则前台无法确定是哪个站 */}
              {previewHref ? (
                <a
                  href={previewHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("nav.previewLobbyAria")}
                  title={`${t("nav.previewLobbyAria")} · ${scopeLabel}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#d4af37]/15 bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-neutral-400 transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 hover:text-[#f0d27c]"
                >
                  <NavIcon name="preview" />
                  <span className="hidden whitespace-nowrap sm:inline">
                    {t("nav.previewLobby")}
                  </span>
                </a>
              ) : null}
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
                  <span className="whitespace-nowrap">
                    {t(item.labelKey)}
                  </span>
                  {item.href === TENANT_WITHDRAWALS_HREF &&
                  pendingWithdrawalCount > 0 ? (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d4af37] px-1.5 text-[10px] font-bold text-black">
                      {pendingWithdrawalCount > 99
                        ? "99+"
                        : formatInteger(pendingWithdrawalCount)}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {/* 超管代登录：顶部常驻安全提示 + 一键退出 */}
          {impersonation ? (
            <ImpersonationBanner
              tenantName={tenantName ?? t("shell.scope.tenantFallback")}
              adminUsername={impersonation.username}
            />
          ) : null}
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

