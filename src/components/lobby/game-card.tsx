"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { GameEmblem } from "@/components/lobby/game-emblem";
import { useOnlineCount } from "@/components/lobby/use-online-count";
import { formatInteger } from "@/lib/format";
import { cardTitle, type LobbyGameCard } from "@/lib/lobby-games";

/**
 * 大厅游戏卡片。
 *
 * 封面 = 高饱和渐变 + 品类图形（老虎机 / 扑克牌 / 斗鸡 / 麻将 / 龙 / 鱼 …），
 * 不再使用风景、建筑等与博彩内容无关的占位图；图形全部是内联 SVG，
 * 离线也不会出现空白卡片。
 *
 * 右上角是【在线人数胶囊】：初始人数由服务端稳定推导（300 ~ 1500），
 * 挂载后每 2 ~ 3 秒跳动一次，并有 300 人保底。
 */
export function GameCard({
  card,
  onPlay,
}: {
  card: LobbyGameCard;
  onPlay: () => void;
}) {
  const { t } = useLanguage();
  const { art } = card;
  const title = cardTitle(card, t);
  const online = useOnlineCount(card.online);
  const isHot = card.categories.includes("hot");

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`${title} · ${card.providerLabel}`}
      className="group relative block aspect-[3/4] w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#080808] text-left transition-all duration-300 hover:z-10 hover:-translate-y-2 hover:scale-[1.01] hover:border-brand-soft/60 hover:shadow-[0_28px_55px_-18px_var(--sf-a65)] focus:outline-none focus-visible:z-10 focus-visible:-translate-y-2 focus-visible:ring-2 focus-visible:ring-brand-soft/70"
    >
      {/* 高饱和渐变底 */}
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(158deg, ${art.base} 0%, #070707 78%)`,
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(115% 85% at 20% 0%, ${art.accent}66 0%, transparent 58%), radial-gradient(95% 70% at 85% 12%, ${art.accent}3d 0%, transparent 62%)`,
        }}
      />
      {/* 机台格线：老虎机「滚轮窗口」质感 */}
      <span
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.14] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,0.9)_0_1px,transparent_1px_26px)]"
      />
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-[linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.55)_58%,#000_100%)]"
      />

      {/* 中央图形：光环 + 内圈 + 图标 */}
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center pb-9"
      >
        <span
          className="absolute h-[78%] w-[78%] rounded-full border transition-transform duration-500 group-hover:scale-105"
          style={{
            borderColor: `${art.accent}33`,
            backgroundImage: `radial-gradient(circle at 50% 38%, ${art.accent}30 0%, transparent 66%)`,
          }}
        />
        <span
          className="absolute h-[58%] w-[58%] rounded-full border border-dashed transition-transform duration-700 group-hover:rotate-45"
          style={{ borderColor: `${art.accent}2b` }}
        />
        <span
          className="relative flex h-[46%] w-[46%] items-center justify-center transition-transform duration-500 group-hover:scale-110"
          style={{ color: art.accent }}
        >
          <GameEmblem
            emblem={art.emblem}
            className="h-full w-full drop-shadow-[0_10px_22px_rgba(0,0,0,0.8)]"
          />
        </span>
      </span>

      {/* 顶部高光描边 */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent"
      />
      {/* 玻璃质感：悬停时叠一层斜向反光 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(135deg,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0.05)_26%,transparent_46%,transparent_72%,rgba(255,255,255,0.1)_100%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
      />

      {/* 左上角 HOT 标 */}
      {isHot ? (
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full border border-brand-soft/45 bg-brand-soft/15 px-1.5 py-[2px] text-[8px] font-black uppercase tracking-[0.12em] text-brand-pale backdrop-blur-sm">
          <svg
            viewBox="0 0 24 24"
            className="h-2.5 w-2.5"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2.5c.7 3.6-2.5 5-2.5 7.6 0 1.4 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0-.7-.2-1.3-.6-2 2.6 1.4 4.2 3.9 4.2 6.6A5.9 5.9 0 0 1 12 21.5a5.9 5.9 0 0 1-5.7-3.7C5.4 13.4 10 9.9 12 2.5Z" />
          </svg>
          HOT
        </span>
      ) : null}

      {/* 右上角：在线人数胶囊（每 2~3 秒跳动，保底 300 人） */}
      <span className="absolute right-1.5 top-1.5 inline-flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded-full border border-emerald-300/25 bg-black/65 px-1.5 py-[3px] text-[9px] font-semibold tabular-nums text-emerald-300 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.9)] backdrop-blur-sm">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.95)]"
        />
        <span
          key={online.tick}
          className="inline-block animate-[online-tick_520ms_ease-out] motion-reduce:animate-none"
        >
          {formatInteger(online.count)}
        </span>
        <span className="sr-only">
          {t("lobby.playersOnline", { count: formatInteger(online.count) })}
        </span>
      </span>

      {/* 底部：游戏名 + 游戏商 */}
      <span className="absolute inset-x-1.5 bottom-1.5 block">
        <span className="block truncate text-[11px] font-black uppercase leading-tight tracking-[0.03em] text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] sm:text-[12px]">
          {title}
        </span>
        <span className="mt-1 inline-flex max-w-full items-center truncate rounded border border-brand/35 bg-black/70 px-1.5 py-px text-[8px] font-black uppercase italic tracking-[0.04em] text-brand-soft sm:text-[9px]">
          {card.providerLabel}
        </span>
      </span>

      {/* 悬停：扫光 + 播放按钮 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <span className="absolute -left-1/2 top-0 h-full w-2/5 -translate-x-[160%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/65 to-transparent blur-[2px] transition-transform duration-700 ease-out group-hover:translate-x-[420%] group-focus-visible:translate-x-[420%]" />
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      >
        <span className="absolute inset-0 bg-black/35" />
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-brand-soft/70 bg-brand-soft/15 backdrop-blur">
          <svg
            viewBox="0 0 24 24"
            className="ml-0.5 h-3.5 w-3.5 text-brand-soft"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 5.5v13l11-6.5-11-6.5Z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
