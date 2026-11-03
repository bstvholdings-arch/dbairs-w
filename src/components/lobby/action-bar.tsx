"use client";

import type { ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  MissionMedalIcon,
  PlayerAuthIcon,
  ReferralGiftIcon,
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
    icon: <DepositGemIcon />,
  },
  {
    id: "withdraw",
    labelKey: "lobby.withdraw",
    icon: <MoneyBagIcon />,
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
 *
 * 物理动效（纯 CSS，关键帧在 globals.css 的「Deposit 金币雨」/「Withdraw 疯狂喷金币」区块）：
 * - Deposit：金色发光钱袋徽章 + 4 枚 ≥24px 的大金币边下落边自转、闪烁（金币雨）；
 * - Withdraw：💰 常态呼吸缩放，悬停 / 键盘聚焦时左右剧烈摇晃 + 8 枚金币从袋心
 *   向左右上方抛物线炸开（放大 2 倍以上、360° 自转、金色强光晕 + 喷发闪光）。
 * 金币层都是 `pointer-events-none`；金币雨 z-[5] 在图标之上、文案（z-10）之下，
 * 既不挡点击，也不会盖住 Deposit / Withdraw 的文字。
 * Withdraw 卡特意不加 `overflow-hidden`（金币要能飞出卡外才够冲击力），
 * 高光扫光 / 顶边细线改用内层 overflow-hidden 容器兜住。
 */
export function LobbyActionBar({
  onAction,
  loggedIn = false,
}: {
  onAction: (action: LobbyActionId) => void;
  /** 已登录时 auth 卡改成「我的账户」，点击直接进玩家中心 */
  loggedIn?: boolean;
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
            data-lobby-action={action.id}
            className={`group/action relative flex flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2.5 transition-all duration-300 hover:z-10 hover:scale-105 hover:-translate-y-0.5 hover:shadow-[0_0_15px_var(--sf-a50)] focus:outline-none focus-visible:z-10 focus-visible:scale-105 focus-visible:ring-2 focus-visible:ring-brand-soft/60 focus-visible:shadow-[0_0_15px_var(--sf-a50)] sm:gap-2 sm:px-3 sm:py-4 ${
              /* Withdraw 卡故意不裁切：金币要能飞出口袋冲进卡外才有冲击力，
                 高光扫光 / 顶边描边另用一层 overflow-hidden 兜住 */
              action.id === "withdraw" ? "" : "overflow-hidden"
            } ${
              action.primary
                ? "border-amber-300/45 bg-gradient-to-b from-amber-400/25 via-amber-500/10 to-transparent shadow-[0_0_20px_-8px_rgba(255,196,0,0.8)] ring-1 ring-inset ring-amber-200/30 hover:border-amber-200/80 hover:from-amber-300/35 hover:ring-amber-200/50"
                : "border-white/[0.07] bg-white/[0.02] hover:border-brand-soft/70 hover:bg-black/60"
            }`}
          >
            {/* 金币雨：z-[5] 压在图标之上（金币从钱袋前落下更有分量），
                但在文案之下（文案是 z-10），所以永远不会盖住 Deposit 字样 */}
            {action.id === "deposit" ? <DepositCoinRain /> : null}

            {/* 高光扫过 + 顶边细线：必须裁在卡内，所以单独套一层 overflow-hidden */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
            >
              <span className="absolute inset-y-0 -left-1/3 w-1/3 -translate-x-full skew-x-[-20deg] bg-white/20 blur-[2px] transition-transform duration-700 group-hover/action:translate-x-[420%]" />
              <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            </span>

            <span
              className={`relative flex items-center justify-center transition-all duration-300 group-hover/action:scale-110 ${
                action.primary
                  ? // 充值卡：金色徽章自带金边光晕，不再套浅色底板
                    "h-10 w-10 sm:h-14 sm:w-14"
                  : "h-8 w-8 rounded-lg border border-brand/25 bg-black/40 text-brand-soft group-hover/action:border-brand-soft/70 group-hover/action:bg-brand/15 sm:h-11 sm:w-11 sm:rounded-xl"
              }`}
            >
              {action.icon}
            </span>

            <span
              className={`relative z-10 text-center text-[9px] font-semibold leading-tight tracking-wide break-words transition-colors duration-300 sm:text-[11px] ${
                action.primary
                  ? "text-amber-100 [text-shadow:0_1px_2px_rgba(0,0,0,0.85)]"
                  : "text-neutral-300 group-hover/action:text-brand-pale"
              }`}
            >
              {action.id === "auth" && loggedIn
                ? t("lobby.action.account")
                : t(action.labelKey)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Deposit 卡的主图标：钱袋 💰 + 纯 CSS 立体金币徽章。
 *
 * 三层叠出来的「金矿」质感（类名规则见 globals.css 的「Deposit 金矿」区块）：
 * - `.tb-deposit-glow`：背后呼吸的金色光晕，往外一圈一圈地亮；
 * - `.tb-deposit-medal`：径向金色渐变的币面 + 内高光 + 金边 + 慢速扫过的金属流光；
 * - 💰 emoji 本身带金色 drop-shadow，一眼看出是钱而不是白色加号。
 * 尺寸按断点给（40px → 56px），比原先 h-8/w-8 的浅色底板大一圈。
 */
function DepositGemIcon() {
  return (
    <span className="relative flex h-10 w-10 items-center justify-center sm:h-14 sm:w-14">
      <span
        aria-hidden="true"
        className="tb-deposit-glow absolute -inset-1.5 rounded-full"
      />
      <span
        aria-hidden="true"
        className="tb-deposit-medal absolute inset-0 overflow-hidden rounded-full"
      />
      <span
        aria-hidden="true"
        className="relative select-none text-[26px] leading-none drop-shadow-[0_0_10px_rgba(255,196,0,0.95)] sm:text-[36px]"
      >
        💰
      </span>
    </span>
  );
}

/**
 * Deposit 卡的「金币雨」。
 *
 * 4 枚 24px（sm 28px）纯 CSS 金币，从按钮顶边持续坠落：
 * `tb-coin-fall` 里同时做 translateY 下落、rotate(360deg) 自转、
 * 以及 opacity 1 → 0.5 → 1 的闪烁；每枚用不同的 left / duration / 负 animation-delay
 * 错开，看起来就是真在下金币。
 * 整层 `z-[5]`：压在图标之上、文案之下（文案是 z-10），pointer-events-none 不挡点击。
 */
function DepositCoinRain() {
  return (
    <span
      aria-hidden="true"
      data-lobby-coins="rain"
      className="tb-coin-rain pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-xl"
    >
      <span className="tb-coin tb-coin--1" />
      <span className="tb-coin tb-coin--2" />
      <span className="tb-coin tb-coin--3" />
      <span className="tb-coin tb-coin--4" />
    </span>
  );
}

/** 喷射金币的序号：1–8，一一对应 globals.css 里的 `.tb-fly-coin--N` 抛物线参数。 */
const BURST_COINS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Withdraw 卡的钱袋子图标（💰 + 「疯狂喷金币」）。
 *
 * - 常态：`.tb-moneybag` 以袋底为原点极慢「呼吸」缩放，仿佛袋里有钱在动；
 * - 金币**常驻喷射**（与 Deposit 的金币雨同一节奏：2.4 / 2.9 / 2.6 / 3.1s，
 *   错峰 0 / -0.7 / -1.4 / -2s），8 枚金币从袋心锚点 `.tb-bag-coins` 向左右上方
 *   沿抛物线炸开，边飞边 360° 自转，并伴随一次金色闪光；
 *   负延迟让首帧就已经「喷到半空」，页面加载即生效，不需要鼠标移上去；
 * - 悬停 / 键盘聚焦（`[data-lobby-action="withdraw"]:hover`）只额外让袋身左右摇晃，
 *   不再承担「启动动画」的职责；
 * - `prefers-reduced-motion` 下全部关闭（见 globals.css 末尾）。
 */
function MoneyBagIcon() {
  return (
    <span className="relative flex h-6 w-6 items-center justify-center">
      {/* 喷发闪光：垫在袋身下面，只负责「炸开」那一下的亮度 */}
      <span aria-hidden="true" className="tb-bag-flash pointer-events-none absolute" />
      <span
        aria-hidden="true"
        className="tb-moneybag relative select-none text-[21px] leading-none sm:text-[26px]"
      >
        💰
      </span>
      {/* 喷射层：零尺寸锚点钉在袋心，8 枚金币都从这里起飞（压在袋身之上） */}
      <span
        aria-hidden="true"
        data-lobby-coins="burst"
        className="tb-bag-coins pointer-events-none absolute"
      >
        {BURST_COINS.map((index) => (
          <span key={index} className={`tb-fly-coin tb-fly-coin--${index}`} />
        ))}
      </span>
    </span>
  );
}

