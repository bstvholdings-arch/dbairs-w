"use client";

import type { ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  DepositIcon,
  MissionMedalIcon,
  PlayerAuthIcon,
  ReferralGiftIcon,
  WithdrawIcon,
} from "@/components/lobby/hall-actions";
import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 核心功能岛的动作标识。
 * 只有 deposit 是真流程（打开充值弹窗），其余目前都是「即将上线」占位。
 */
export type LobbyActionId =
  | "mission"
  | "referral"
  | "deposit"
  | "withdraw"
  | "auth";

type LobbyAction = {
  id: LobbyActionId;
  labelKey: TranslationKey;
  /** 主操作（充值）用金色描边强调，其余走暗色玻璃卡 */
  primary?: boolean;
  icon: ReactNode;
};

const ACTIONS: LobbyAction[] = [
  {
    id: "mission",
    labelKey: "lobby.mission",
    icon: <MissionMedalIcon />,
  },
  {
    id: "referral",
    labelKey: "lobby.referral",
    icon: <ReferralGiftIcon />,
  },
  {
    id: "deposit",
    labelKey: "lobby.deposit",
    primary: true,
    icon: <DepositIcon className="h-6 w-6" />,
  },
  {
    id: "withdraw",
    labelKey: "lobby.withdraw",
    icon: <WithdrawIcon className="h-6 w-6" />,
  },
  {
    // 登录 / 注册合成一张卡：两个入口在演示环境都只弹「即将上线」
    id: "auth",
    labelKey: "lobby.action.auth",
    icon: <PlayerAuthIcon className="h-6 w-6" />,
  },
];

/**
 * 核心功能岛（Action Bar）。
 *
 * 从 Header 里搬出来的 Mission / Referral / Deposit / Withdraw / Login·Register，
 * 现在是 Hero 轮播下方独立的一排图标卡：
 * - 手机端固定 5 列，卡片压缩到「图标 + 9px 两行文字」，不会挤成一团；
 * - ≥640px 变成带副标题的宽卡；
 * - 悬停时卡片放大到 105%、背景加深、边框亮起金黄色光晕，并扫过一道高光。
 */
export function LobbyActionBar({
  onAction,
}: {
  onAction: (action: LobbyActionId) => void;
}) {
  const { t } = useLanguage();

  return (
    <section
      aria-label={t("lobby.action.title")}
      className="relative overflow-hidden rounded-2xl border border-brand/15 bg-[#070707]/80 p-2.5 sm:p-3.5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,var(--sf-a12),transparent_58%)]"
      />

      <div className="relative mb-2.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 px-0.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-4 w-1 rounded-full bg-gradient-to-b from-brand-soft to-brand-deep"
          />
          <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-soft">
            {t("lobby.action.title")}
          </h2>
        </div>
        <p className="text-[9px] tracking-wide text-neutral-500">
          {t("lobby.action.subtitle")}
        </p>
      </div>

      <div className="relative grid grid-cols-5 gap-1.5 sm:gap-2.5">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onAction(action.id)}
            className={`group/action relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border px-1 py-2.5 transition-all duration-300 hover:z-10 hover:scale-105 hover:-translate-y-0.5 hover:shadow-[0_0_15px_var(--sf-a50)] focus:outline-none focus-visible:z-10 focus-visible:scale-105 focus-visible:ring-2 focus-visible:ring-brand-soft/60 focus-visible:shadow-[0_0_15px_var(--sf-a50)] sm:gap-2 sm:px-3 sm:py-4 ${
              action.primary
                ? "border-brand-soft/45 bg-gradient-to-b from-brand/25 to-brand/[0.06] hover:border-brand-soft hover:from-brand/40 hover:to-brand/[0.14]"
                : "border-white/[0.07] bg-white/[0.02] hover:border-brand-soft/70 hover:bg-black/60"
            }`}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 -left-1/3 w-1/3 -translate-x-full skew-x-[-20deg] bg-white/20 blur-[2px] transition-transform duration-700 group-hover/action:translate-x-[420%]"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
            />

            <span
              className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-300 group-hover/action:scale-110 sm:h-11 sm:w-11 sm:rounded-xl ${
                action.primary
                  ? "bg-brand-soft text-brand-ink shadow-[0_8px_22px_-10px_var(--sf-soft-a95)] group-hover/action:shadow-[0_10px_26px_-8px_var(--sf-soft-a100)]"
                  : "border border-brand/25 bg-black/40 text-brand-soft group-hover/action:border-brand-soft/70 group-hover/action:bg-brand/15"
              }`}
            >
              {action.icon}
            </span>

            <span
              className={`relative text-center text-[9px] font-semibold leading-tight tracking-wide break-words transition-colors duration-300 sm:text-[11px] ${
                action.primary
                  ? "text-brand-pale"
                  : "text-neutral-300 group-hover/action:text-brand-pale"
              }`}
            >
              {t(action.labelKey)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
