"use client";

import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 大厅顶部的中奖跑马灯。
 *
 * - 内容全部来自本地演示数据，不请求接口，首屏即可滚动；
 * - 用两份完全相同的事件列表 + CSS transform 位移 50% 实现无缝循环，
 *   不依赖 JS 定时器，标签页切到后台也不会积压动画；
 * - 金色为主，超级大奖用红色徽章 / 红字做偶尔的高亮；
 * - 悬停、键盘聚焦时暂停，prefers-reduced-motion 下停止滚动（见 globals.css）。
 */
type WinnerEvent = {
  id: string;
  player: string;
  provider: string;
  amount: string;
  /** 普通中奖显示游戏名，超级大奖不需要 */
  gameKey?: TranslationKey;
  jackpot?: boolean;
};

const WINNER_EVENTS: WinnerEvent[] = [
  {
    id: "ab8",
    player: "ab8",
    provider: "PG Soft",
    gameKey: "lobby.game.mahjongWays",
    amount: "$5,000",
  },
  {
    id: "wi2",
    player: "wi2",
    provider: "SCR888",
    amount: "$18,888",
    jackpot: true,
  },
  {
    id: "kx9",
    player: "kx9",
    provider: "Evo888",
    gameKey: "lobby.game.speedBaccarat",
    amount: "$2,400",
  },
  {
    id: "jm4",
    player: "jm4",
    provider: "Joker",
    gameKey: "lobby.game.fortuneTiger",
    amount: "$7,650",
  },
  {
    id: "luna7",
    player: "luna7",
    provider: "FastSpin",
    gameKey: "lobby.game.sugarRush",
    amount: "$1,280",
  },
  {
    id: "ry6",
    player: "ry6",
    provider: "PG Soft",
    gameKey: "lobby.game.gatesOfOlympus",
    amount: "$12,000",
  },
];

export function WinnerTicker() {
  const { t } = useLanguage();

  return (
    <section
      aria-label={t("lobby.ticker.label")}
      className="winner-ticker relative flex overflow-hidden rounded-xl border border-brand/20 bg-[linear-gradient(90deg,rgba(24,18,4,0.98),rgba(7,7,7,0.94))] shadow-[0_16px_40px_-28px_var(--sf-a65)]"
    >
      {/* 左侧 LIVE 标签：固定在跑马灯前面，不参与滚动 */}
      <div className="relative z-10 flex shrink-0 items-center gap-1.5 border-r border-brand/20 bg-[#0b0903] px-2.5 py-2 sm:px-3">
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]" />
        </span>
        <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-[0.16em] text-brand-soft sm:text-[10px]">
          {t("lobby.ticker.label")}
        </span>
      </div>

      {/* 滚动区：两侧做淡出遮罩，避免文字从硬边突然出现 */}
      <div className="relative min-w-0 flex-1 overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_4%,black_96%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_4%,black_96%,transparent)]">
        <div className="winner-ticker-track flex w-max">
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              aria-hidden={copy === 1 ? true : undefined}
              className="flex shrink-0 items-center gap-5 pr-5 sm:gap-8 sm:pr-8"
            >
              {WINNER_EVENTS.map((event) => (
                <li
                  key={`${copy}-${event.id}`}
                  className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[10px] font-semibold tracking-wide sm:text-[11px]"
                >
                  <span
                    aria-hidden="true"
                    className={
                      event.jackpot
                        ? "text-[13px] drop-shadow-[0_0_6px_rgba(244,63,94,0.85)]"
                        : "text-[13px] drop-shadow-[0_0_5px_var(--sf-soft-a55)]"
                    }
                  >
                    {event.jackpot ? "🔥" : "🎉"}
                  </span>

                  {event.jackpot ? (
                    <span className="rounded border border-rose-400/40 bg-rose-500/15 px-1.5 py-px text-[8px] font-black uppercase tracking-[0.12em] text-rose-300 sm:text-[9px]">
                      {t("lobby.ticker.jackpotBadge")}
                    </span>
                  ) : null}

                  <span
                    className={
                      event.jackpot
                        ? "text-rose-300 drop-shadow-[0_1px_6px_rgba(244,63,94,0.35)]"
                        : "text-brand-soft"
                    }
                  >
                    {t(
                      event.jackpot
                        ? "lobby.ticker.jackpot"
                        : "lobby.ticker.win",
                      {
                        player: event.player,
                        provider: event.provider,
                        game: event.gameKey ? t(event.gameKey) : "",
                        amount: event.amount,
                      },
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
