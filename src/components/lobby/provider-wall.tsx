"use client";

import { useRouter } from "next/navigation";

import { useLanguage } from "@/components/LanguageProvider";
import { ProviderBrandMark } from "@/components/lobby/provider-brand";
import { formatInteger } from "@/lib/format";
import type { LobbyProviderOption } from "@/lib/lobby-games";
import { providerBrand, providerHallHref } from "@/lib/lobby-providers";
import { selectShowcaseProviders } from "@/lib/provider-showcase";

/**
 * 游戏商品牌墙（Provider Showcase）。
 *
 * 横向滚动，把每个游戏商当成一个「品牌」展示：Logo + 名称 + 游戏数 + 在线人数。
 * 点击任意品牌会通过 next/navigation 的 router 跳转到独立展馆 /provider/[code]，
 * 而不是在当前页过滤——品牌墙是「入口」，左侧 Tab 才是「就地筛选」。
 *
 * 展示哪些品牌、谁排在前面完全由后台【前台装修 → 游戏商商标网格】决定：
 * 只展示 showInShowcase = true 的游戏商，按 sortOrder 从大到小排列（见 lib/provider-showcase.ts）。
 */
export function ProviderWall({
  providers,
  onlineByProvider,
  activeProviderId,
  heading = true,
}: {
  providers: LobbyProviderOption[];
  /** providerId → 该游戏商所有游戏的在线人数合计 */
  onlineByProvider: Map<string, number>;
  /** 当前所在游戏商（展馆页高亮用） */
  activeProviderId?: string;
  /** 是否渲染品牌墙标题栏 */
  heading?: boolean;
}) {
  const router = useRouter();
  const { t } = useLanguage();

  // 后台关掉的品牌不渲染；顺序按 sortOrder 降序（相同则按名称），与后台列表一致
  const showcaseProviders = selectShowcaseProviders(providers);

  if (showcaseProviders.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={t("lobby.providers.title")}
      className="relative overflow-hidden rounded-2xl border border-brand/15 bg-[#070707]/80 p-2.5 sm:p-3.5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,var(--sf-a14),transparent_60%)]"
      />

      {heading ? (
        <div className="relative mb-2.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 px-0.5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-4 w-1 rounded-full bg-gradient-to-b from-brand-soft to-brand-deep"
            />
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-soft">
              {t("lobby.providers.title")}
            </h2>
          </div>
          <p className="text-[9px] tracking-wide text-neutral-500">
            {t("lobby.providers.subtitle")}
          </p>
        </div>
      ) : null}

      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[#070707] to-transparent"
        />
        <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1.5 [scrollbar-width:none] sm:gap-2.5 [&::-webkit-scrollbar]:hidden">
          {showcaseProviders.map((provider) => {
            const brand = providerBrand(provider.name);
            const online = onlineByProvider.get(provider.id) ?? 0;
            const active = activeProviderId === provider.id;

            return (
              // flex-1 + min-w：品牌少时卡片自动撑满整行（右侧不留空白），
              // 品牌多时退回最小宽度并转为横向滑动。
              <li
                key={provider.id}
                data-showcase-provider={provider.name}
                data-showcase-sort-order={provider.sortOrder ?? 0}
                className="flex min-w-[232px] flex-1 snap-start sm:min-w-[272px]"
              >
                <button
                  type="button"
                  onClick={() => router.push(providerHallHref(provider.name))}
                  aria-label={`${provider.name} · ${t("lobby.providers.open")}`}
                  className={`group relative flex h-[92px] w-full items-center gap-3 overflow-hidden rounded-2xl border px-3.5 text-left transition-all duration-300 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/70 sm:h-[108px] sm:gap-4 sm:px-4 lg:h-[116px] ${
                    active
                      ? "border-brand-soft/60 bg-brand-soft/10"
                      : "border-white/[0.07] bg-white/[0.02] hover:border-brand/40"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{
                      backgroundImage: `linear-gradient(100deg, ${brand.secondary}2e 0%, transparent 68%)`,
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
                  />

                  <ProviderBrandMark name={provider.name} size="showcase" />

                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-black uppercase italic leading-tight tracking-[0.02em] text-neutral-100 sm:text-[16px] lg:text-[18px]">
                      {provider.name}
                    </span>
                    <span className="mt-1 block truncate text-[10px] tracking-wide text-neutral-500 sm:text-[11px] lg:text-[12px]">
                      {t("lobby.providers.stats", {
                        games: provider.gameCount ?? 0,
                        online: formatInteger(online),
                      })}
                    </span>
                  </span>

                  <svg
                    viewBox="0 0 24 24"
                    className="relative h-4 w-4 shrink-0 text-neutral-600 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-brand-soft sm:h-5 sm:w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m9 5 7 7-7 7" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
