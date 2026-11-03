"use client";

import type { CSSProperties } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { GameCard } from "@/components/lobby/game-card";
import { LOBBY_GAMES, readGameImageUrl, type LobbyGameCard } from "@/lib/lobby-games";
import { pickDemoGameCover } from "@/lib/game-cover-catalog";
import {
  buildThemeBackgroundStyle,
  THEME_BACKGROUNDS,
  THEME_BACKGROUND_ORDER,
} from "@/lib/theme-backgrounds";

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
      // 演示目录已经配好示例真实封面；万一漏配就从封面池补一张
      imageUrl:
        readGameImageUrl(game.imageUrl) ?? pickDemoGameCover(game.id),
    },
  ];
});

/** 演示页不接游戏，点卡片不跳转（保持与大厅一致的视觉与交互反馈） */
const noop = () => undefined;

/**
 * 15 种主题背景色的并排实拍：每种颜色一个 section + 锚点（#obsidian / #royalPurple / …），
 * AI 销冠发给客户的链接就指向这些锚点。
 *
 * 每个 section 自己注入 `--tb-*` 变量（buildThemeBackgroundStyle），
 * 里面渲染的是**同一个 GameCard 组件**：底色永远深色，只有环境光、
 * 外框描边与文字底板描边跟随主题色变化。
 */
export function ThemeBackgroundGallery() {
  const { t } = useLanguage();

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">
          {t("storefront.themeBackground.demoEyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">
          {t("storefront.themeBackground.demoTitle")}
        </h1>
        <p className="mt-2 max-w-3xl text-xs leading-6 text-neutral-400">
          {t("storefront.themeBackground.demoHint")}
        </p>
      </header>

      {THEME_BACKGROUND_ORDER.map((id) => {
        const definition = THEME_BACKGROUNDS[id];

        return (
          <section
            key={id}
            id={id}
            data-demo-theme-background={id}
            className="scroll-mt-6 overflow-hidden rounded-2xl border border-white/[0.08]"
            style={buildThemeBackgroundStyle(id) as CSSProperties}
          >
            <div className="tb-lobby-bg relative px-4 py-5">
              {/* 呼吸光晕：颜色来自本 section 的 --tb-rgb */}
              <span
                aria-hidden="true"
                className="tb-aura -left-10 -top-16 h-48 w-48"
              />
              <span
                aria-hidden="true"
                className="tb-aura tb-aura--slow -right-12 bottom-[-6rem] h-56 w-56"
              />

              <div className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/10 pb-2">
                <h2 className="text-sm font-semibold text-white">
                  {t(definition.labelKey)}
                  <span className="ml-2 font-mono text-[10px] font-normal text-neutral-500">
                    {id}
                  </span>
                </h2>
                <p className="font-mono text-[10px] text-neutral-500">
                  {definition.base} · {definition.accent}
                </p>
              </div>

              <div className="relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {DEMO_CARDS.map((card) => (
                  <GameCard key={`${id}-${card.id}`} card={card} onPlay={noop} />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
