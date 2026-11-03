"use client";

import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { GameEmblem } from "@/components/lobby/game-emblem";
import { useOnlineCount } from "@/components/lobby/use-online-count";
import {
  GAME_CARD_STYLES,
  buildPlaceholderSkin,
  normalizeGameCardStyle,
  type GameCardPlaceholderSkin,
  type GameCardStyleId,
} from "@/lib/game-card-styles";
import { formatInteger } from "@/lib/format";
import { cardTitle, type LobbyGameCard, type LobbyGameArt } from "@/lib/lobby-games";

/**
 * 大厅游戏卡片。
 *
 * 构图（由下往上，顺序不能变）：
 * 1. **游戏主图**：`card.imageUrl`（游戏商同步过来的真实封面，见 Game.iconUrl）
 *    用 object-cover 铺满整张卡，原图直出 —— 不叠遮罩、不叠纯色底、不叠渐变、
 *    不加 filter。这是玩家真正要看的东西，任何风格都不许动它。
 * 2. 没有封面图时（空库 / 上游没给图 / 图 404）才退回「渐变 + 品类图形」占位，
 *    保证卡片不会是空白方块（内联 SVG，离线可用）。
 * 3. **文字区底板**（游戏名 + 游戏商）：风格的第二个落点，只压卡片底部一条。
 * 4. **外框**（边框 / 圆角 / 悬停发光）：风格的第一个落点。
 *
 * 3 种风格（赛博霓虹 / 黑金尊享 / 糖果明亮）只改第 3、4 层与徽章配色，
 * 差异全部来自 src/lib/game-card-styles.ts 的 token；脏值自动回落赛博霓虹。
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
  // 占位封面与风格无关（只由游戏自己的 art 推导），有真实封面图时根本不会渲染
  const skin = buildPlaceholderSkin(art);

  /**
   * 封面图加载失败（404 / 403 / 防盗链 / 断网）时回退到品类图形占位：
   * 只记住「失败的那张图」的地址，换一张卡或后台换了封面地址后会自动重试，
   * 不会因为一次失败就永久破图。
   */
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const imageUrl = card.imageUrl;
  const showImage = Boolean(imageUrl) && brokenImageUrl !== imageUrl;

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`${title} · ${card.providerLabel}`}
      data-game-card-style={definition.id}
      data-game-card-cover={showImage ? "image" : "placeholder"}
      className={`group relative block aspect-[3/4] w-full overflow-hidden bg-[#05070c] text-left transition-all duration-300 hover:z-10 hover:-translate-y-2 hover:scale-[1.01] focus:outline-none focus-visible:z-10 focus-visible:-translate-y-2 focus-visible:ring-2 focus-visible:ring-white/55 ${tokens.frame}`}
    >
      {/* ① 游戏主图 —— 卡片主体，原图直出。
             这里刻意没有：遮罩层、纯色底、渐变、filter、blend，
             风格一律靠外框 + 底部文字底板表达。 */}
      {showImage && imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={title}
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setBrokenImageUrl(imageUrl)}
          data-game-card-image
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      ) : (
        <GameCardPlaceholder art={art} skin={skin} />
      )}


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

      {/* ③ 底部文字区底板：风格的第二个落点。
             只压住卡片底部这一条（深色半透明 / 纯黑 / 明亮半透明白），
             主图主体完整露出来 —— 全卡压暗的 scrim 层已经删掉了。 */}
      <span
        className={`absolute inset-x-0 bottom-0 flex flex-col gap-1 px-2 pb-2 pt-1.5 ${tokens.panel}`}
      >
        <span
          className={`block truncate text-[11px] font-black uppercase leading-tight tracking-[0.03em] sm:text-[12px] ${tokens.title}`}
        >
          {title}
        </span>
        <span
          className={`inline-flex max-w-full items-center gap-1 self-start truncate rounded border px-1.5 py-px text-[8px] font-black uppercase italic tracking-[0.04em] sm:text-[9px] ${tokens.provider}`}
        >
          {card.providerLabel}
        </span>
      </span>

      {/* ④ 悬停金色流光（只有黑金风有）：alpha ≤ 0.16 + soft-light，
             只提亮一档，不遮挡、不偏色 —— 赛博 / 糖果风为 null，图片上什么都不加。 */}
      {tokens.tint ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 ${tokens.tint}`}
        />
      ) : null}

      {/* 悬停播放按钮：只加按钮，不加暗色罩（不再压暗图片） */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur ${tokens.play}`}
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

/**
 * 占位封面：**只在「这条游戏没有封面图 / 图加载失败」时渲染**。
 *
 * 与真实封面图互斥 —— 有图时这一层根本不存在，
 * 所以游戏主图永远不会被渐变、光晕或色块盖住。
 */
function GameCardPlaceholder({
  art,
  skin,
}: {
  art: LobbyGameArt;
  skin: GameCardPlaceholderSkin;
}) {
  return (
    <span aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <span
        className="absolute inset-0"
        style={{ backgroundImage: skin.backdrop }}
      />
      <span
        className="absolute inset-0"
        style={{ backgroundImage: skin.glow }}
      />
      <span className="absolute inset-0 flex items-center justify-center pb-12">
        <span
          className="absolute h-[74%] w-[74%] rounded-full border transition-transform duration-500 group-hover:scale-105"
          style={{
            borderColor: skin.haloStroke,
            backgroundImage: skin.haloFill,
          }}
        />
        <span
          className="absolute h-[56%] w-[56%] rounded-full border border-dashed transition-transform duration-700 group-hover:rotate-45"
          style={{ borderColor: skin.haloDashed }}
        />
        <span
          className="relative flex h-[44%] w-[44%] items-center justify-center transition-transform duration-500 group-hover:scale-110"
          style={{ color: skin.emblem }}
        >
          <GameEmblem
            emblem={art.emblem}
            className={`h-full w-full ${skin.emblemShadow}`}
          />
        </span>
      </span>
    </span>
  );
}
