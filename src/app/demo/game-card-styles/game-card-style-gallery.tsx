"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { GameCard } from "@/components/lobby/game-card";
import {
  GAME_CARD_STYLES,
  GAME_CARD_STYLE_ORDER,
} from "@/lib/game-card-styles";
import { LOBBY_GAMES, readGameImageUrl, type LobbyGameCard } from "@/lib/lobby-games";

/**
 * 演示用 6 张卡片：取的还是大厅同一份目录（含封面图形与在线人数），
 * 只是把数据库里的真实游戏换成了内置样例，保证离线 / 空库也能看到效果。
 */
const DEMO_GAME_IDS = [
  "mahjong-ways",
  "speed-baccarat",
  "jackpot-fishing",
  "cockfight-king",
  "gates-of-olympus",
  "saba-sportsbook",
] as const;

const DEMO_CARDS: LobbyGameCard[] = DEMO_GAME_IDS.flatMap((id) => {
  const game = LOBBY_GAMES.find((item) => item.id === id);

  if (!game) {
    return [];
  }

  return [
    {
      id: game.id,
      name: null,
      titleKey: game.titleKey,
      providerId: null,
      providerLabel: game.provider,
      categories: game.categories,
      online: game.online,
      art: game.art,
      // 演示目录没有真实封面图 → 卡片走「渐变 + 品类图形」占位
      imageUrl: readGameImageUrl(game.imageUrl),
    },
  ];
});

/** 演示页不接游戏，点卡片不跳转（保持与大厅一致的视觉与交互反馈） */
const noop = () => undefined;

/**
 * 三种封面风格的并排实拍：每个风格一个 section + 锚点（#cyberNeon / #royalGold / #candyPop），
 * AI 销冠发给客户的链接就指向这些锚点。
 */
export function GameCardStyleGallery() {
  const { t } = useLanguage();

  return (
    <div className="space-y-10">
      <header>
        <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">
          {t("storefront.gameCard.demoEyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">
          {t("storefront.gameCard.demoTitle")}
        </h1>
        <p className="mt-2 max-w-3xl text-xs leading-6 text-neutral-400">
          {t("storefront.gameCard.demoHint")}
        </p>
      </header>

      {GAME_CARD_STYLE_ORDER.map((id) => {
        const definition = GAME_CARD_STYLES[id];

        return (
          <section key={id} id={id} data-demo-game-card-style={id} className="scroll-mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/10 pb-2">
              <h2 className="text-sm font-semibold text-white">
                {t(definition.labelKey)}
                <span className="ml-2 font-mono text-[10px] font-normal text-neutral-500">
                  {id}
                </span>
              </h2>
              <p className="max-w-xl text-[11px] leading-5 text-neutral-500">
                {t(definition.hintKey)}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {DEMO_CARDS.map((card) => (
                <GameCard
                  key={`${id}-${card.id}`}
                  card={card}
                  style={id}
                  onPlay={noop}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
