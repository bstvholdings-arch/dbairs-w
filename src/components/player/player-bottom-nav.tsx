"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { TFunction, TranslationKey } from "@/lib/i18n-types";

/**
 * 玩家端底部导航（大厅 / 活动 / 我的）。
 *
 * 为什么需要它：活动大厅（/promotions）是玩家侧的一级页面，
 * 但大厅是单页布局、没有侧边菜单，玩家只能靠底部导航在
 * 「大厅 ↔ 活动 ↔ 玩家中心」之间切换；不挂这个导航，活动页就成了孤岛。
 *
 * 约定：
 * - 只在玩家可见页面挂载（大厅 `/`、活动大厅 `/promotions`），后台一律不用；
 * - 预览模式下必须带上 `?tenant=`（props.tenantKey），否则从活动页点回大厅
 *   会丢掉租户上下文，落到「最早创建的租户」上（AGENTS.md 第 7 条）；
 * - 固定悬浮在底部居中，页面主体需要自行留出 `pb-28` 级别的底部空间。
 */

type PlayerNavId = "lobby" | "promotions" | "account";

type PlayerNavItem = {
  id: PlayerNavId;
  href: string;
  /** 词典 key（`src/locales/zh.json` 为唯一事实来源，en.json 必须同步） */
  labelKey: TranslationKey;
  /** 兜底文案：词典若缺这个 key（老词典 / 热更新没生效 / 被误删），
   *  用这里的内置短词，绝不把 `playerNav.lobby` 这种原始 key 渲染到界面上。 */
  fallbackLabel: string;
  icon: ReactNode;
};

const NAV_ITEMS: PlayerNavItem[] = [
  {
    id: "lobby",
    href: "/",
    labelKey: "playerNav.lobby",
    fallbackLabel: "大厅",
    icon: <HomeIcon />,
  },
  {
    id: "promotions",
    href: "/promotions",
    labelKey: "playerNav.promotions",
    fallbackLabel: "活动",
    icon: <GiftIcon />,
  },
  {
    id: "account",
    href: "/player/profile",
    labelKey: "playerNav.account",
    fallbackLabel: "我的",
    icon: <UserIcon />,
  },
];

/**
 * 防御性取文案。
 *
 * `t()` 的既有契约是「查不到 key 就把 key 原样返回」，所以缺键时界面上会出现
 * `playerNav.promotions` 这种半成品字符串；这里统一兜到内置文案。
 * 另外 `key` 为空（数据被外部改成脏值 / 未来的动态菜单）时不调用 `t()`，
 * 直接走兜底，避免给 `t()` 传非法参数。
 */
function translateOr(
  t: TFunction,
  key: TranslationKey | null | undefined,
  fallback: string,
): string {
  if (!key) {
    return fallback;
  }

  const value = t(key);

  if (!value || value === key) {
    return fallback;
  }

  return value;
}

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[18px] w-[18px]"
    >
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6.5 10v9.5h4V15h3v4.5h4V10" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[18px] w-[18px]"
    >
      <rect x="3.5" y="9" width="17" height="11" rx="1.8" />
      <path d="M3.5 13h17" />
      <path d="M12 9v11" />
      <path d="M12 9C10.5 6 9.3 5 8 5a2 2 0 0 0 0 4Z" />
      <path d="M12 9c1.5-3 2.7-4 4-4a2 2 0 0 1 0 4Z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[18px] w-[18px]"
    >
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20c0-3.6 3.2-6.2 7.2-6.2s7.2 2.6 7.2 6.2" />
    </svg>
  );
}

function isActiveItem(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PlayerBottomNav({
  tenantKey = null,
}: {
  /** 预览模式下的租户标识；为空表示按域名访问，不需要透传 */
  tenantKey?: string | null;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();

  function withTenant(href: string) {
    if (!tenantKey) {
      return href;
    }

    const params = new URLSearchParams({ tenant: tenantKey });

    return `${href}?${params.toString()}`;
  }

  return (
    <nav
      aria-label={translateOr(t, "playerNav.aria", "玩家端导航")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex justify-center px-3 pb-3"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-stretch gap-1 rounded-2xl border border-brand/20 bg-[#060606]/92 p-1.5 shadow-[0_-14px_48px_-24px_rgba(0,0,0,0.95)] backdrop-blur-xl">
        {NAV_ITEMS.map((item) => {
          const active = isActiveItem(pathname, item.href);

          return (
            <Link
              key={item.id}
              href={withTenant(item.href)}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-1.5 text-[10px] font-semibold transition-colors ${
                active
                  ? "border-brand/30 bg-brand/12 text-brand-pale"
                  : "border-transparent text-neutral-500 hover:border-white/10 hover:bg-white/[0.03] hover:text-neutral-200"
              }`}
            >
              {item.icon}
              <span className="leading-none">
                {translateOr(t, item.labelKey, item.fallbackLabel)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
