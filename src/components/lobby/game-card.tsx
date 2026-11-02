"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { GameEmblem } from "@/components/lobby/game-emblem";
import { useOnlineCount } from "@/components/lobby/use-online-count";
import {
  GAME_CARD_STYLES,
  normalizeGameCardStyle,
  type GameCardStyleId,
} from "@/lib/game-card-styles";
import { formatInteger } from "@/lib/format";
import { cardTitle, type LobbyGameCard } from "@/lib/lobby-games";

/**
 * 大厅游戏卡片。
 *
 * 封面 = 高饱和渐变 + 品类图形（老虎机 / 扑克牌 / 斗鸡 / 麻将 / 龙 / 鱼 …），
 * 不再使用风景、建筑等与博彩内容无关的占位图；图形全部是内联 SVG，
 * 离线也不会出现空白卡片。
 *
 * 【封面风格】后台【前台装修 → 游戏封面风格】下发 3 种风格之一
 * （赛博霓虹 / 黑金尊享 / 糖果明亮）。组件只有这一份，
 * 风格差异全部来自 src/lib/game-card-styles.ts 的 token：
 * 固定 class 走 tokens，随卡片主色变化的渐变走 build()。脏值自动回落赛博霓虹。
 *
 * 右上角是【在线人数胶囊】：初始人数由服务端稳定推导（300 ~ 1500），
 * 挂载后每 2 ~ 3 秒跳动一次，并有 300 人保底。
 */
export function GameCard({
  card,
  onPlay,
  style,
}: {
  card: LobbyGameCard;
  onPlay: () => void;
  /** 后台配置的封面风格；不传 / 脏值 = 赛博霓虹（与改造前外观一致） */
  style?: GameCardStyleId | null;
}) {
  const { t } = useLanguage();
  const { art } = card;
  const title = cardTitle(card, t);
  const online = useOnlineCount(card.online);
  const isHot = card.categories.includes("hot");

  const definition = GAME_CARD_STYLES[normalizeGameCardStyle(style)];
  const { tokens } = definition;
  const skin = definition.build(art);

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`${title} · ${card.providerLabel}`}
      data-game-card-style={definition.id}
      className={`group relative block aspect-[3/4] w-full overflow-hidden text-left transition-all duration-300 hover:z-10 hover:-translate-y-2 hover:scale-[1.01] focus:outline-none focus-visible:z-10 focus-visible:-translate-y-2 focus-visible:ring-2 focus-visible:ring-white/55 ${tokens.frame}`}
    >
      {/* 高饱和渐变底（用多少卡片主色由风格决定） */}
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: skin.backdrop }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: skin.glow }}
      />
      {/* 纹理层：赛博 / 黑金是机台格线，糖果是糖霜点阵 */}
      <span aria-hidden="true" className={`absolute inset-0 ${tokens.texture}`} />
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 h-2/3 ${tokens.scrim}`}
      />


      {/* 中央图形：光环 + 内圈 + 图标 */}
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center pb-9"
      >
        <span
          className="absolute h-[78%] w-[78%] rounded-full border transition-transform duration-500 group-hover:scale-105"
          style={{
            borderColor: skin.haloStroke,
            backgroundImage: skin.haloFill,
          }}
        />
        <span
          className="absolute h-[58%] w-[58%] rounded-full border border-dashed transition-transform duration-700 group-hover:rotate-45"
          style={{ borderColor: skin.haloDashed }}
        />
        <span
          className="relative flex h-[46%] w-[46%] items-center justify-center transition-transform duration-500 group-hover:scale-110"
          style={{ color: skin.emblem }}
        >
          <GameEmblem
            emblem={art.emblem}
            className={`h-full w-full ${skin.emblemShadow}`}
          />
        </span>
      </span>

      {/* 顶部 1px 亮边 + 玻璃质感斜向反光（悬停显现） */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-px ${tokens.hairline}`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 ${tokens.edge}`}
      />

      {/* 左上角 HOT 标 */}
      {isHot ? (
        <span
          className={`absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-[2px] text-[8px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${tokens.hot}`}
        >
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
      <span
        className={`absolute right-1.5 top-1.5 inline-flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded-full border px-1.5 py-[3px] text-[9px] font-semibold tabular-nums backdrop-blur-sm ${tokens.online}`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${tokens.onlineDot}`}
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
        <span
          className={`block truncate text-[11px] font-black uppercase leading-tight tracking-[0.03em] sm:text-[12px] ${tokens.title}`}
        >
          {title}
        </span>
        <span
          className={`mt-1 inline-flex max-w-full items-center truncate rounded border px-1.5 py-px text-[8px] font-black uppercase italic tracking-[0.04em] sm:text-[9px] ${tokens.provider}`}
        >
          {card.providerLabel}
        </span>
      </span>

      {/* 悬停：扫光（糖果风不显示，去掉金属 / 霓虹语言的沉重感）+ 播放按钮 */}
      {tokens.sweep ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <span
            className={`absolute -left-1/2 top-0 h-full -translate-x-[160%] skew-x-[-18deg] transition-transform ease-out group-hover:translate-x-[420%] group-focus-visible:translate-x-[420%] ${tokens.sweep}`}
          />
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      >
        <span className={`absolute inset-0 ${tokens.veil}`} />
        <span
          className={`relative flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur ${tokens.play}`}
        >
          <svg
            viewBox="0 0 24 24"
            className={`ml-0.5 h-3.5 w-3.5 ${tokens.playIcon}`}
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
