"use client";

import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { GameEmblem } from "@/components/lobby/game-emblem";
import { useOnlineCount } from "@/components/lobby/use-online-count";
import { formatInteger } from "@/lib/format";
import { cardTitle, type LobbyGameCard, type LobbyGameArt } from "@/lib/lobby-games";

/**
 * 大厅 / 品牌展馆的游戏卡片。
 *
 * 构图（由下往上，顺序不能变）：
 * 1. **游戏主图**：`card.imageUrl`（游戏商同步过来的真实封面，见 Game.iconUrl）
 *    用 object-cover 铺满整张卡，原图直出 —— 不叠遮罩、不叠纯色底、不叠渐变、
 *    不加 filter。这是玩家真正要看的东西，**任何主题背景色都不许动它**。
 * 2. 没有封面图时（空库 / 上游没给图 / 图 404）才退回「渐变 + 品类图形」占位，
 *    保证卡片不会是空白方块（内联 SVG，离线可用）。
 * 3. **文字区底板**（游戏名 + 游戏商）：深黑半透明 + 主题色细描边，只压底部一条。
 * 4. **外框**：1px 主题色描边 + 深色投影，悬停整圈提亮。
 *
 * 颜色从哪来：卡片**不接收任何颜色 prop**，主题背景色（15 选 1）由根节点用
 * `buildThemeBackgroundStyle()` 注入 `--tb-*` CSS 变量后继承下来，
 * 卡片只用 `.tb-card*` 这几个固定 class（样式见 globals.css 的「主题背景色」区块）。
 * 所以「加一种主题色」= 改 src/lib/theme-backgrounds.ts 的色表，不碰本文件。
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
      data-game-card
      data-game-card-cover={showImage ? "image" : "placeholder"}
      className="tb-card group relative block aspect-[3/4] w-full overflow-hidden rounded-2xl bg-[#05070c] text-left hover:z-10 hover:-translate-y-2 hover:scale-[1.01] focus:outline-none focus-visible:z-10"
    >
      {/* ① 游戏主图 —— 卡片主体，原图直出。
             这里刻意没有：遮罩层、纯色底、渐变、filter、blend。 */}
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
          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        <GameCardPlaceholder art={art} />
      )}

      {/* 左上角 HOT 标 */}
      {isHot ? (
        <span className="tb-card__hot absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-[2px] text-[8px] font-black uppercase tracking-[0.12em] backdrop-blur-sm">
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
      <span className="tb-card__online absolute right-1.5 top-1.5 inline-flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded-full px-1.5 py-[3px] text-[9px] font-semibold tabular-nums backdrop-blur-sm">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400"
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

      {/* ③ 底部文字区底板：深黑半透明 + 主题色细描边，只压住底部一条，
             主图主体完整露出来（全卡压暗的 scrim 层、浅色底板都已删除）。 */}
      <span className="tb-card__plate absolute inset-x-0 bottom-0 flex flex-col gap-1 px-2 pb-2 pt-1.5">
        <span className="tb-card__name block truncate text-[11px] font-black uppercase leading-tight tracking-[0.03em] sm:text-[12px]">
          {title}
        </span>
        <span className="tb-card__provider inline-flex max-w-full items-center gap-1 self-start truncate rounded px-1.5 py-px text-[8px] font-black uppercase italic tracking-[0.04em] sm:text-[9px]">
          {card.providerLabel}
        </span>
      </span>

      {/* 悬停播放按钮：只加按钮，不加暗色罩（不压暗图片） */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span className="tb-card__play flex h-9 w-9 items-center justify-center rounded-full">
          <svg
            viewBox="0 0 24 24"
            className="ml-0.5 h-3.5 w-3.5"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 5.5v13l11-6.5-11-6.5Z" />
          </svg>
        </span>
      </span>
    </button>
  );

/**
 * 占位封面的内联样式。
 *
 * **与主题背景色完全无关**：只由游戏自己的 art（深色端 + 高饱和主色）推导，
 * 15 种主题色下占位封面长得一模一样 —— 主题色只改外框与文字底板描边，
 * 绝不会把整张卡刷成某个主题色的底色。
 */
type GameCardPlaceholderSkin = {
  backdrop: string;
  glow: string;
  haloFill: string;
  haloStroke: string;
  haloDashed: string;
  emblem: string;
  emblemShadow: string;
};

/** `#rrggbb` / `#rgb` → `rgba(r, g, b, alpha)`；解析失败时按透明处理，绝不抛错 */
function withAlpha(hex: string, alpha: number): string {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const value = Number.parseInt(full, 16);

  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function buildPlaceholderSkin({
  base,
  accent,
}: LobbyGameArt): GameCardPlaceholderSkin {
  return {
    backdrop: `linear-gradient(158deg, ${base} 0%, #04060a 74%)`,
    glow:
      `radial-gradient(120% 86% at 18% 0%, ${withAlpha(accent, 0.45)} 0%, transparent 58%), ` +
      `radial-gradient(95% 72% at 88% 10%, ${withAlpha(accent, 0.22)} 0%, transparent 62%)`,
    haloFill: `radial-gradient(circle at 50% 38%, ${withAlpha(accent, 0.3)} 0%, transparent 66%)`,
    haloStroke: withAlpha(accent, 0.32),
    haloDashed: withAlpha(accent, 0.2),
    emblem: accent,
    emblemShadow: "drop-shadow-[0_10px_22px_rgba(0,0,0,0.8)]",
  };
}

/**
 * 占位封面：**只在「这条游戏没有封面图 / 图加载失败」时渲染**。
 *
 * 与真实封面图互斥 —— 有图时这一层根本不存在，
 * 所以游戏主图永远不会被渐变、光晕或色块盖住。
 */
function GameCardPlaceholder({ art }: { art: LobbyGameArt }) {
  const skin = buildPlaceholderSkin(art);

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

}
