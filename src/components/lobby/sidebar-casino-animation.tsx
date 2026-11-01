"use client";

import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 侧边栏「斗鸡」下方的娱乐场动态大屏。
 *
 * 容器铺满整个侧边栏宽度（h-[120px]），每 10 秒在两个画面之间交替：
 *   画面 A：三粒 🎲 在桌面上做 3D 翻滚；
 *   画面 B：三张 J / Q / K 扑克牌侧滑入场后持续上下浮动。
 * 两帧合计 20 秒一轮，动画写在 globals.css 并用 prefers-reduced-motion 做降级。
 */

const CASINO_FRAME_MS = 10_000;

const CASINO_FRAMES: Array<{
  id: "dice" | "cards";
  labelKey: TranslationKey;
}> = [
  { id: "dice", labelKey: "lobby.sidebarCasino.dice" },
  { id: "cards", labelKey: "lobby.sidebarCasino.cards" },
];

/** 画面 B 的三张牌：黑桃 J / 红心 Q / 方块 K。 */
const CASINO_CARDS: Array<{ rank: string; suit: string; red: boolean }> = [
  { rank: "J", suit: "♠", red: false },
  { rank: "Q", suit: "♥", red: true },
  { rank: "K", suit: "♦", red: true },
];

/** 画面 A：三粒骰子在桌布上不停翻滚（3D 由父级 perspective + 骰子 rotateX/Y/Z 组合实现）。 */
function CasinoDiceStage({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pb-3"
    >
      <div className="lobby-casino-dice-stage relative flex items-end gap-2.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            aria-hidden="true"
            className="lobby-casino-die select-none text-[30px] leading-none drop-shadow-[0_6px_10px_rgba(0,0,0,0.6)]"
          >
            🎲
          </span>
        ))}
      </div>
      <span
        aria-hidden="true"
        className="lobby-casino-table-shadow h-2 w-[108px] rounded-full bg-black/75 blur-[5px]"
      />
    </div>
  );
}

/** 画面 B：三张扑克牌从右侧依次滑入，落位后继续上下浮动。 */
function CasinoCardsStage({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="absolute inset-0 flex items-center justify-center gap-1.5 pb-3"
    >
      {CASINO_CARDS.map((card) => (
        <div key={card.rank} className="lobby-casino-card-enter">
          <div className="lobby-casino-card-float">
            <div
              className={`relative flex h-[56px] w-[38px] flex-col justify-between rounded-[7px] border border-white/55 bg-gradient-to-br from-[#fdfaf1] via-[#f1ebda] to-[#d6ccb1] px-1 py-0.5 shadow-[0_10px_20px_-8px_rgba(0,0,0,0.9)] ${
                card.red ? "text-[#b3261e]" : "text-[#171105]"
              }`}
            >
              <span className="flex items-center justify-between text-[9px] font-black leading-none">
                {card.rank}
                <span aria-hidden="true" className="text-[7px]">
                  {card.suit}
                </span>
              </span>
              <span aria-hidden="true" className="self-center text-[15px] leading-none">
                {card.suit}
              </span>
              <span
                aria-hidden="true"
                className="flex rotate-180 items-center justify-between text-[9px] font-black leading-none"
              >
                {card.rank}
                <span className="text-[7px]">{card.suit}</span>
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SidebarCasinoAnimation({
  className = "",
}: {
  className?: string;
}) {
  const { t } = useLanguage();
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % CASINO_FRAMES.length);
    }, CASINO_FRAME_MS);

    return () => window.clearInterval(timer);
  }, []);

  const frame = CASINO_FRAMES[frameIndex];

  return (
    <div
      className={`mt-3 w-full ${className}`}
      data-sidebar-casino-anim
      data-frame={frame.id}
    >
      <div className="relative h-[120px] w-full overflow-hidden rounded-2xl border border-brand/35 bg-gradient-to-br from-[#1b1405] via-[#080808] to-[#0a0803] shadow-[0_0_32px_-12px_var(--sf-a80),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <span
          aria-hidden="true"
          className="lobby-casino-halo pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,var(--sf-a65),transparent_68%)]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-brand-soft/70 to-transparent"
        />

        <span className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full border border-white/10 bg-black/70 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[0.14em] text-brand-soft">
          <span
            aria-hidden="true"
            className="h-1 w-1 animate-pulse rounded-full bg-emerald-400"
          />
          LIVE
        </span>

        {frame.id === "dice" ? (
          <CasinoDiceStage label={t("lobby.sidebarCasino.dice")} />
        ) : (
          <CasinoCardsStage label={t("lobby.sidebarCasino.cards")} />
        )}

        <div className="absolute inset-x-0 bottom-1.5 z-10 flex items-center justify-center gap-1.5 text-[8px] uppercase tracking-[0.22em]">
          <span className="text-neutral-500">
            {t("lobby.sidebarCasino.label")}
          </span>
          <span aria-hidden="true" className="h-2 w-px bg-white/15" />
          <span className="font-semibold text-brand-soft">
            {t(frame.labelKey)}
          </span>
        </div>
      </div>
    </div>
  );
}
