"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  DEFAULT_GAME_CARD_STYLE,
  GAME_CARD_STYLES,
  GAME_CARD_STYLE_ORDER,
  type GameCardStyleId,
} from "@/lib/game-card-styles";
import {
  buildStorefrontTheme,
  DEFAULT_STOREFRONT_LANGUAGE_STYLE,
  DEFAULT_STOREFRONT_MODULES,
  DEFAULT_STOREFRONT_SIDEBAR_CASINO,
  DEFAULT_STOREFRONT_TOPBAR_CHAT,
  DEFAULT_THEME_BRIGHTNESS,
  DEFAULT_THEME_COLOR,
  isValidThemeColor,
  moveStorefrontModule,
  normalizeLanguageStyle,
  normalizeThemeColor,
  parseLanguageStyle,
  STOREFRONT_MODULE_HINT_KEYS,
  STOREFRONT_MODULE_LABEL_KEYS,
  THEME_BRIGHTNESS_MAX,
  THEME_BRIGHTNESS_MIN,
  THEME_COLOR_PRESETS,
  type StorefrontModule,
  type StorefrontModuleId,
} from "@/lib/storefront";
import {
  DEFAULT_STOREFRONT_PRESET,
  STOREFRONT_PRESETS,
  STOREFRONT_PRESET_ORDER,
  type StorefrontPresetId,
} from "@/lib/storefront-presets";

import type {
  StorefrontProviderRow,
  StorefrontSaveResponse,
  StorefrontTenantRow,
} from "./types";
import { ProviderShowcasePanel } from "./provider-showcase-panel";
import { ThemePreviewCard } from "./theme-preview-card";
import { ArrowIcon, SectionTitle } from "./ui";

/** 用于判断「有没有未保存改动」的指纹（模板 + 封面风格 + 主色 + 深浅 + 模块开关顺序 + 互动组件） */
function signature(
  preset: StorefrontPresetId,
  gameCardStyle: GameCardStyleId,
  themeColor: string,
  brightness: number,
  modules: StorefrontModule[],
  interactions: {
    showTopbarChat: boolean;
    showSidebarCasinoAnim: boolean;
    languageStyle: string;
  },
) {
  return [
    `preset:${preset}`,
    `card:${gameCardStyle}`,
    `${themeColor}@${brightness}`,
    ...modules.map((module) => `${module.id}:${module.visible ? 1 : 0}`),
    `topbarChat:${interactions.showTopbarChat ? 1 : 0}`,
    `sidebarCasino:${interactions.showSidebarCasinoAnim ? 1 : 0}`,
    `language:${interactions.languageStyle}`,
  ].join("|");
}

function defaultModules() {
  return DEFAULT_STOREFRONT_MODULES.map((module) => ({ ...module }));
}

/**
 * 模板缩略图：只画「排布关系」，不复制真实大厅的组件树。
 *
 * 高度比例直接取自 token（heroHeight.lg / moduleGap / mode），
 * 因此以后调 token，缩略图会自动跟着变，不会出现「缩略图与前台不一致」。
 */
function PresetThumb({
  id,
  active,
}: {
  id: StorefrontPresetId;
  active: boolean;
}) {
  const { tokens } = STOREFRONT_PRESETS[id];
  const heroRatio = Number.parseInt(tokens.heroHeight.lg, 10) || 330;
  const block = active ? "bg-brand/50" : "bg-white/[0.12]";
  const cta = active ? "bg-brand-soft/80" : "bg-white/25";

  return (
    <div
      aria-hidden="true"
      className="flex h-14 w-full rounded-lg border border-white/[0.07] bg-black/40 p-1.5"
      style={{ gap: tokens.moduleGap }}
    >
      {tokens.mode === "bento" ? (
        <div
          className="grid flex-1 grid-cols-2"
          style={{ gap: tokens.moduleGap }}
        >
          <span
            className={`col-span-2 rounded ${block}`}
            style={{ flexBasis: 0 }}
          />
          <span className={`rounded ${cta}`} />
          <span className={`rounded ${block}`} />
        </div>
      ) : tokens.mode === "editorial" ? (
        <div
          className="grid flex-1 grid-cols-[1.55fr_1fr]"
          style={{ gap: tokens.moduleGap }}
        >
          <span className={`row-span-2 rounded ${block}`} />
          <span className={`rounded ${cta}`} />
          <span className={`rounded ${block}`} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col" style={{ gap: tokens.moduleGap }}>
          <span
            className={`rounded ${block}`}
            style={{ flexBasis: 0, flexGrow: heroRatio }}
          />
          <span
            className={`rounded ${cta}`}
            style={{ flexBasis: 0, flexGrow: 45 }}
          />
          <span
            className={`rounded ${block}`}
            style={{ flexBasis: 0, flexGrow: 110 }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * 游戏封面风格缩略图：只画「卡片的视觉语言」（底色 / 边框 / 中央图形 / 文字条），
 * 颜色直接取自 GAME_CARD_STYLES 的 swatch，因此缩略图与前台卡片永远同源。
 */
function GameCardStyleThumb({ id }: { id: GameCardStyleId }) {
  const { swatch } = GAME_CARD_STYLES[id];

  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden rounded-lg border"
      style={{ backgroundColor: swatch.frame, borderColor: swatch.rim }}
    >
      <span
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(75% 60% at 50% 26%, ${swatch.glow}55 0%, transparent 72%)`,
        }}
      />
      <span
        className="absolute left-1/2 top-[34%] h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{ borderColor: swatch.rim, backgroundColor: `${swatch.glow}22` }}
      />
      <span
        className="absolute inset-x-2 bottom-4 h-1.5 rounded-full"
        style={{ backgroundColor: swatch.ink }}
      />
      <span
        className="absolute inset-x-2 bottom-1.5 h-1 w-8 rounded-full"
        style={{ backgroundColor: swatch.rim }}
      />
    </div>
  );
}

/**
 * 后台【前台装修】可视化编辑器。
 *
 * 左侧是配置（租户 / 主色 / 三大模块的开关与顺序），右侧是真实前台的 iframe 预览。
 * 保存后会把 configuration 写进 Tenant.themeColor 与 Tenant.layoutConfig，
 * 刷新 iframe（或直接打开 `/`）就能看到前台按新配置渲染 —— 不做任何前端假数据。
 */
export function StorefrontClient({
  initialTenants,
  initialTenantId,
  initialProviders,
}: {
  initialTenants: StorefrontTenantRow[];
  initialTenantId: string | null;
  /** 全部游戏商（含未上架），用于页面底部的商标网格编排 */
  initialProviders: StorefrontProviderRow[];
}) {
  const { t } = useLanguage();

  const [tenants, setTenants] = useState(initialTenants);
  const [selectedId, setSelectedId] = useState<string | null>(initialTenantId);

  const selected = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedId) ?? null,
    [selectedId, tenants],
  );

  const [preset, setPreset] = useState<StorefrontPresetId>(
    selected?.preset ?? DEFAULT_STOREFRONT_PRESET,
  );
  const [gameCardStyle, setGameCardStyle] = useState<GameCardStyleId>(
    selected?.gameCardStyle ?? DEFAULT_GAME_CARD_STYLE,
  );
  const [themeColor, setThemeColor] = useState(
    selected?.themeColor ?? DEFAULT_THEME_COLOR,
  );
  const [brightness, setBrightness] = useState(
    selected?.themeBrightness ?? DEFAULT_THEME_BRIGHTNESS,
  );
  const [hexDraft, setHexDraft] = useState(themeColor);
  const [modules, setModules] = useState<StorefrontModule[]>(
    selected?.modules ?? defaultModules(),
  );
  const [showTopbarChat, setShowTopbarChat] = useState(
    selected?.showTopbarChat ?? DEFAULT_STOREFRONT_TOPBAR_CHAT,
  );
  const [showSidebarCasinoAnim, setShowSidebarCasinoAnim] = useState(
    selected?.showSidebarCasinoAnim ?? DEFAULT_STOREFRONT_SIDEBAR_CASINO,
  );
  const [languageStyle, setLanguageStyle] = useState(
    selected?.languageStyle ?? DEFAULT_STOREFRONT_LANGUAGE_STYLE,
  );

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [previewKey, setPreviewKey] = useState(0);

  // 预览卡片、色阶与前台都调用同一个函数：
  // HEX → HSL → 套用 brightness → 算出 --primary / --primary-soft / --primary-dark
  const theme = useMemo(
    () => buildStorefrontTheme({ hex: themeColor, brightness }),
    [brightness, themeColor],
  );

  const normalizedLanguageStyle = useMemo(
    () => normalizeLanguageStyle(languageStyle),
    [languageStyle],
  );
  const languageLabels = useMemo(
    () => parseLanguageStyle(normalizedLanguageStyle),
    [normalizedLanguageStyle],
  );

  const baseline = useMemo(
    () =>
      signature(
        selected?.preset ?? DEFAULT_STOREFRONT_PRESET,
        selected?.gameCardStyle ?? DEFAULT_GAME_CARD_STYLE,
        selected?.themeColor ?? DEFAULT_THEME_COLOR,
        selected?.themeBrightness ?? DEFAULT_THEME_BRIGHTNESS,
        selected?.modules ?? defaultModules(),
        {
          showTopbarChat: selected?.showTopbarChat ?? DEFAULT_STOREFRONT_TOPBAR_CHAT,
          showSidebarCasinoAnim:
            selected?.showSidebarCasinoAnim ?? DEFAULT_STOREFRONT_SIDEBAR_CASINO,
          languageStyle:
            selected?.languageStyle ?? DEFAULT_STOREFRONT_LANGUAGE_STYLE,
        },
      ),
    [selected],
  );
  const dirty =
    signature(preset, gameCardStyle, themeColor, brightness, modules, {
      showTopbarChat,
      showSidebarCasinoAnim,
      languageStyle: normalizedLanguageStyle,
    }) !== baseline;

  const previewHref = selected
    ? `/?tenant=${encodeURIComponent(selected.subdomain || selected.id)}`
    : "/";

  function selectTenant(id: string) {
    const next = tenants.find((tenant) => tenant.id === id);

    if (!next) {
      return;
    }

    setSelectedId(id);
    setPreset(next.preset);
    setGameCardStyle(next.gameCardStyle);
    setThemeColor(next.themeColor);
    setBrightness(next.themeBrightness);
    setHexDraft(next.themeColor);
    setModules(next.modules.map((module) => ({ ...module })));
    setShowTopbarChat(next.showTopbarChat);
    setShowSidebarCasinoAnim(next.showSidebarCasinoAnim);
    setLanguageStyle(next.languageStyle);
    setError("");
    setSavedAt(null);
    setPreviewKey((current) => current + 1);
  }

  function applyColor(raw: string) {
    if (!isValidThemeColor(raw)) {
      return;
    }

    const next = normalizeThemeColor(raw);
    setThemeColor(next);
    setHexDraft(next);
  }

  function toggleModule(id: StorefrontModuleId) {
    setModules((current) =>
      current.map((module) =>
        module.id === id ? { ...module, visible: !module.visible } : module,
      ),
    );
  }

  function moveModule(id: StorefrontModuleId, direction: -1 | 1) {
    setModules((current) => moveStorefrontModule(current, id, direction));
  }

  const resetDefaults = useCallback(() => {
    setPreset(DEFAULT_STOREFRONT_PRESET);
    setGameCardStyle(DEFAULT_GAME_CARD_STYLE);
    setThemeColor(DEFAULT_THEME_COLOR);
    setBrightness(DEFAULT_THEME_BRIGHTNESS);
    setHexDraft(DEFAULT_THEME_COLOR);
    setModules(defaultModules());
    setShowTopbarChat(DEFAULT_STOREFRONT_TOPBAR_CHAT);
    setShowSidebarCasinoAnim(DEFAULT_STOREFRONT_SIDEBAR_CASINO);
    setLanguageStyle(DEFAULT_STOREFRONT_LANGUAGE_STYLE);
    setError("");
  }, []);

  const save = useCallback(async () => {
    if (!selected) {
      setError(t("storefront.tenant.empty"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/admin/storefront", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selected.id,
          // 服务端会存成 {"hex":"#d4af37","brightness":50}
          themeColor: { hex: themeColor, brightness },
          layoutConfig: {
            preset,
            gameCardStyle,
            modules,
            showTopbarChat,
            showSidebarCasinoAnim,
            languageStyle: normalizedLanguageStyle,
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | StorefrontSaveResponse
        | null;

      if (!response.ok || !payload?.tenant) {
        setError(payload?.error ?? t("storefront.saveError"));
        return;
      }

      const saved = payload.tenant;

      // 保存成功后把「已保存基线」同步成服务端返回值，
      // 这样未保存提示会立刻消失，且以数据库里的归一化结果为准。
      setTenants((current) =>
        current.map((tenant) => (tenant.id === saved.id ? saved : tenant)),
      );
      setPreset(saved.preset);
      setGameCardStyle(saved.gameCardStyle);
      setThemeColor(saved.themeColor);
      setBrightness(saved.themeBrightness);
      setHexDraft(saved.themeColor);
      setModules(saved.modules.map((module) => ({ ...module })));
      setShowTopbarChat(saved.showTopbarChat);
      setShowSidebarCasinoAnim(saved.showSidebarCasinoAnim);
      setLanguageStyle(saved.languageStyle);
      setSavedAt(
        new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      // 刷新右侧真实前台预览，让改动立刻可见
      setPreviewKey((current) => current + 1);
    } catch {
      setError(t("storefront.saveError"));
    } finally {
      setSaving(false);
    }
  }, [
    brightness,
    gameCardStyle,
    modules,
    normalizedLanguageStyle,
    preset,
    selected,
    showSidebarCasinoAnim,
    showTopbarChat,
    t,
    themeColor,
  ]);

  if (tenants.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-14 text-center">
        <p className="text-sm font-semibold text-neutral-200">
          {t("storefront.tenant.empty")}
        </p>
        <Link
          href="/admin/tenants"
          className="mt-4 inline-flex h-9 items-center rounded-lg border border-brand/30 px-4 text-[11px] font-semibold text-brand-soft transition-colors hover:bg-brand/10"
        >
          {t("storefront.tenant.emptyAction")}
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-brand-soft/80">
            {t("storefront.eyebrow")}
          </p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-neutral-100">
            {t("storefront.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-neutral-500">
            {t("storefront.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300">
              {t("storefront.unsaved")}
            </span>
          ) : savedAt ? (
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
              {t("storefront.savedAt", { time: savedAt })}
            </span>
          ) : null}

          <button
            type="button"
            onClick={resetDefaults}
            className="h-9 rounded-lg border border-white/[0.08] px-3 text-[11px] font-medium text-neutral-400 transition-colors hover:border-white/20 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
          >
            {t("storefront.resetDefaults")}
          </button>

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !selected}
            className="h-9 rounded-lg bg-gradient-to-r from-brand-soft via-brand to-brand-deep px-4 text-[11px] font-bold text-brand-ink shadow-[0_10px_26px_-12px_var(--sf-a85)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
          >
            {saving ? t("storefront.saving") : t("storefront.save")}
          </button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300"
        >
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        <div className="space-y-4">
          {/* ① 选择要装修的站点 */}
          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <SectionTitle
              title={t("storefront.tenant.title")}
              hint={t("storefront.tenant.hint")}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {tenants.map((tenant) => {
                const active = tenant.id === selectedId;

                return (
                  <button
                    key={tenant.id}
                    type="button"
                    onClick={() => selectTenant(tenant.id)}
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 ${
                      active
                        ? "border-brand-soft/60 bg-brand/10"
                        : "border-white/[0.07] bg-white/[0.02] hover:border-brand/30 hover:bg-brand/[0.04]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-6 w-6 shrink-0 rounded-lg border border-white/10"
                      style={{
                        backgroundColor: buildStorefrontTheme({
                          hex: tenant.themeColor,
                          brightness: tenant.themeBrightness,
                        }).brand,
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-semibold text-neutral-200">
                        {tenant.name}
                      </span>
                      <span className="block truncate text-[9px] uppercase tracking-[0.14em] text-neutral-600">
                        {tenant.subdomain}.{tenant.domain.split(".").slice(-1)[0]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ② 排版模板：一套组件 + 5 组 layout token（不做 5 套独立布局） */}
          <section
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"
            data-storefront-preset-picker
          >
            <SectionTitle
              title={t("storefront.preset.title")}
              hint={t("storefront.preset.hint")}
            />

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {STOREFRONT_PRESET_ORDER.map((id) => {
                const definition = STOREFRONT_PRESETS[id];
                const active = preset === id;

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreset(id)}
                    aria-pressed={active}
                    data-storefront-preset-option={id}
                    className={`rounded-xl border p-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 ${
                      active
                        ? "border-brand-soft/60 bg-brand/[0.08]"
                        : "border-white/[0.07] bg-white/[0.015] hover:border-brand/30 hover:bg-brand/[0.04]"
                    }`}
                  >
                    <PresetThumb id={id} active={active} />
                    <span className="mt-2 flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-[11px] font-semibold ${
                          active ? "text-brand-soft" : "text-neutral-200"
                        }`}
                      >
                        {t(definition.labelKey)}
                      </span>
                      {active ? (
                        <span className="shrink-0 rounded-full border border-brand/40 bg-brand/15 px-1.5 py-px text-[9px] font-bold text-brand-soft">
                          {t("storefront.preset.active")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[9px] leading-relaxed text-neutral-500">
                      {t(definition.hintKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ③ 游戏封面风格：一套 GameCard + 3 组 token（不复制组件） */}
          <section
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"
            data-game-card-style-picker
          >
            <SectionTitle
              title={t("storefront.gameCard.title")}
              hint={t("storefront.gameCard.hint")}
            />

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {GAME_CARD_STYLE_ORDER.map((id) => {
                const definition = GAME_CARD_STYLES[id];
                const active = gameCardStyle === id;

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setGameCardStyle(id)}
                    aria-pressed={active}
                    data-game-card-style-option={id}
                    className={`rounded-xl border p-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 ${
                      active
                        ? "border-brand-soft/60 bg-brand/[0.08]"
                        : "border-white/[0.07] bg-white/[0.015] hover:border-brand/30 hover:bg-brand/[0.04]"
                    }`}
                  >
                    <GameCardStyleThumb id={id} />
                    <span className="mt-2 flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-[11px] font-semibold ${
                          active ? "text-brand-soft" : "text-neutral-200"
                        }`}
                      >
                        {t(definition.labelKey)}
                      </span>
                      {active ? (
                        <span className="shrink-0 rounded-full border border-brand/40 bg-brand/15 px-1.5 py-px text-[9px] font-bold text-brand-soft">
                          {t("storefront.gameCard.active")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[9px] leading-relaxed text-neutral-500">
                      {t(definition.hintKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ④ 主题配色引擎：15 色预设 + 深浅滑动条 + 实时预览卡片 */}
          <section
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"
            data-theme-engine
          >
            <SectionTitle
              title={t("storefront.color.title")}
              hint={t("storefront.color.hint")}
            />

            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,290px)]">
              <div className="space-y-3">
                {/* 自定义色号：原生取色器 + HEX 输入 + 当前生效颜色 */}
                <div className="flex flex-wrap items-center gap-3">
                  <label className="relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-white/15 shadow-[0_10px_30px_-16px_var(--sf-a95)]">
                    <span className="sr-only">{t("storefront.color.pick")}</span>
                    <input
                      type="color"
                      value={theme.hex}
                      onChange={(event) => applyColor(event.target.value)}
                      data-theme-color-picker
                      className="h-full w-full cursor-pointer border-0 bg-transparent p-0"
                    />
                  </label>

                  <div>
                    <p className="text-[9px] uppercase tracking-[0.2em] text-neutral-600">
                      {t("storefront.color.hex")}
                    </p>
                    <input
                      value={hexDraft}
                      onChange={(event) => {
                        setHexDraft(event.target.value);
                        applyColor(event.target.value);
                      }}
                      onBlur={() => setHexDraft(theme.hex)}
                      spellCheck={false}
                      maxLength={7}
                      data-theme-hex-input
                      className="mt-1 h-9 w-32 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 font-mono text-xs uppercase tracking-[0.08em] text-neutral-100 focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/25"
                    />
                  </div>

                  <div className="ml-auto text-right">
                    <p className="text-[9px] uppercase tracking-[0.2em] text-neutral-600">
                      {t("storefront.color.effective")}
                    </p>
                    <p
                      className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-soft"
                      data-theme-effective
                    >
                      {theme.brand}
                    </p>
                  </div>
                </div>

                {/* 15 种预设主色：点一下只换色号，深浅滑条位置保持不变 */}
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] text-neutral-600">
                    {t("storefront.color.presets")}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {THEME_COLOR_PRESETS.map((preset) => {
                      const active = themeColor === preset.value;

                      return (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => applyColor(preset.value)}
                          aria-pressed={active}
                          aria-label={`${t(preset.labelKey)} ${preset.value}`}
                          title={`${t(preset.labelKey)} · ${preset.value}`}
                          data-theme-preset={preset.value}
                          style={{ backgroundColor: preset.value }}
                          className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                            active ? "border-white/80" : "border-white/15"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* 深浅滑动条：0 = 最暗，50 = 色号原样，100 = 最亮 */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] uppercase tracking-[0.2em] text-neutral-600">
                      {t("storefront.color.brightness")}
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-[11px] font-semibold text-brand-soft"
                        data-theme-brightness-value
                      >
                        {brightness}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setBrightness(DEFAULT_THEME_BRIGHTNESS)}
                        disabled={brightness === DEFAULT_THEME_BRIGHTNESS}
                        className="rounded-md border border-white/[0.08] px-2 py-0.5 text-[9px] text-neutral-400 transition-colors hover:border-white/20 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t("storefront.color.brightnessReset")}
                      </button>
                    </div>
                  </div>

                  <input
                    type="range"
                    min={THEME_BRIGHTNESS_MIN}
                    max={THEME_BRIGHTNESS_MAX}
                    step={1}
                    value={brightness}
                    onChange={(event) => setBrightness(Number(event.target.value))}
                    aria-label={t("storefront.color.brightness")}
                    aria-valuetext={`${brightness}%`}
                    data-theme-brightness
                    style={{ accentColor: theme.brand }}
                    className="mt-2 h-2 w-full cursor-pointer rounded-full bg-white/10"
                  />

                  <div className="mt-1 flex justify-between text-[9px] text-neutral-600">
                    <span>{t("storefront.color.brightnessDark")}</span>
                    <span>{t("storefront.color.brightnessBase")}</span>
                    <span>{t("storefront.color.brightnessLight")}</span>
                  </div>
                  <p className="mt-1 text-[9px] leading-relaxed text-neutral-600">
                    {t("storefront.color.brightnessHint")}
                  </p>
                </div>
              </div>

              {/* 实时预览：点色块 / 拖滑条时，主色、按钮、光晕立即变化 */}
              <ThemePreviewCard theme={theme} />
            </div>

            <p className="mt-3.5 text-[9px] uppercase tracking-[0.2em] text-neutral-600">
              {t("storefront.color.derived")}
            </p>
            <div className="mt-1.5 grid grid-cols-5 gap-1.5">
              {DERIVED_TOKENS.map((token) => (
                <div
                  key={token}
                  className="rounded-lg border border-white/[0.06] bg-black/30 p-1.5"
                >
                  <span
                    className="block h-6 rounded-md border border-white/[0.06]"
                    style={{ backgroundColor: theme[token] }}
                  />
                  <span className="mt-1 block truncate text-[9px] uppercase tracking-[0.06em] text-neutral-500">
                    {t(`storefront.color.derived.${token}`)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ⑤ 模块开关 + 排序 */}
          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <SectionTitle
              title={t("storefront.modules.title")}
              hint={t("storefront.modules.hint")}
            />

            <ol className="mt-3 space-y-2">
              {modules.map((module, index) => (
                <li
                  key={module.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                    module.visible
                      ? "border-brand/20 bg-brand/[0.05]"
                      : "border-white/[0.06] bg-white/[0.01] opacity-70"
                  }`}
                >
                  <span className="w-4 shrink-0 text-center font-mono text-[10px] text-neutral-600">
                    {index + 1}
                  </span>
                  <ModuleIcon id={module.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-neutral-200">
                      {t(STOREFRONT_MODULE_LABEL_KEYS[module.id])}
                    </p>
                    <p className="truncate text-[10px] text-neutral-500">
                      {t(STOREFRONT_MODULE_HINT_KEYS[module.id])}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveModule(module.id, -1)}
                      disabled={index === 0}
                      aria-label={`${t("storefront.order.up")} ${t(STOREFRONT_MODULE_LABEL_KEYS[module.id])}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] text-neutral-400 transition-colors hover:border-brand/40 hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
                    >
                      <ArrowIcon direction="up" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveModule(module.id, 1)}
                      disabled={index === modules.length - 1}
                      aria-label={`${t("storefront.order.down")} ${t(STOREFRONT_MODULE_LABEL_KEYS[module.id])}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] text-neutral-400 transition-colors hover:border-brand/40 hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
                    >
                      <ArrowIcon direction="down" />
                    </button>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={module.visible}
                    onClick={() => toggleModule(module.id)}
                    aria-label={t(STOREFRONT_MODULE_LABEL_KEYS[module.id])}
                    className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 ${
                      module.visible
                        ? "border-brand/50 bg-brand/70"
                        : "border-white/15 bg-white/[0.06]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
                        module.visible
                          ? "left-[18px] bg-brand-ink"
                          : "left-0.5 bg-neutral-400"
                      }`}
                    />
                  </button>

                  <span className="hidden w-12 shrink-0 text-right text-[9px] uppercase tracking-[0.1em] text-neutral-600 lg:block">
                    {module.visible
                      ? t("storefront.module.visible")
                      : t("storefront.module.hidden")}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* ⑥ 互动组件：顶栏 AI 客服 / 侧边栏娱乐场动效 / 语言按钮文案 */}
          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <SectionTitle
              title={t("storefront.interactions.title")}
              hint={t("storefront.interactions.hint")}
            />

            <div className="mt-3 space-y-2">
              <InteractionRow
                icon="chat"
                title={t("storefront.interactions.topbarChat")}
                hint={t("storefront.interactions.topbarChatHint")}
                checked={showTopbarChat}
                onToggle={() => setShowTopbarChat((current) => !current)}
                toggleLabel={t("storefront.interactions.topbarChat")}
                stateLabel={
                  showTopbarChat
                    ? t("storefront.interactions.on")
                    : t("storefront.interactions.off")
                }
              />
              <InteractionRow
                icon="casino"
                title={t("storefront.interactions.sidebarCasino")}
                hint={t("storefront.interactions.sidebarCasinoHint")}
                checked={showSidebarCasinoAnim}
                onToggle={() => setShowSidebarCasinoAnim((current) => !current)}
                toggleLabel={t("storefront.interactions.sidebarCasino")}
                stateLabel={
                  showSidebarCasinoAnim
                    ? t("storefront.interactions.on")
                    : t("storefront.interactions.off")
                }
              />
            </div>

            <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.015] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="storefront-language-style"
                  className="text-[11px] font-semibold text-neutral-200"
                >
                  {t("storefront.interactions.languageStyle")}
                </label>
                <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[10px] font-bold text-brand-soft">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-3 w-3"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
                  </svg>
                  {languageLabels.zh}/{languageLabels.en}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-neutral-500">
                {t("storefront.interactions.languageStyleHint")}
              </p>
              <input
                id="storefront-language-style"
                type="text"
                value={languageStyle}
                maxLength={9}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setLanguageStyle(event.target.value)}
                onBlur={() => setLanguageStyle(normalizedLanguageStyle)}
                placeholder={t(
                  "storefront.interactions.languageStylePlaceholder",
                )}
                className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 font-mono text-[12px] uppercase tracking-[0.12em] text-neutral-100 placeholder:text-neutral-600 focus:border-brand/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/50"
              />
            </div>
          </section>
        </div>



        {/* ⑦ 真实前台预览：直接 iframe 大厅本身，保存后 key 变化 → 重新加载 */}
        <aside className="space-y-2.5">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"
                />
                <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-soft">
                  {t("storefront.preview.title")}
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreviewKey((current) => current + 1)}
                  className="h-7 rounded-md border border-white/[0.08] px-2 text-[10px] text-neutral-400 transition-colors hover:border-brand/40 hover:text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60"
                >
                  {t("storefront.preview.refresh")}
                </button>
                <Link
                  href={previewHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-7 items-center rounded-md border border-brand/30 bg-brand/10 px-2 text-[10px] font-semibold text-brand-soft transition-colors hover:bg-brand/20"
                >
                  {t("storefront.preview.open")}
                </Link>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-500">
              {t("storefront.preview.hint")}
            </p>
            <p className="mt-1 truncate font-mono text-[9px] text-neutral-600">
              {previewHref}
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
            <iframe
              key={previewKey}
              src={previewHref}
              title={t("storefront.preview.title")}
              className="h-[560px] w-full border-0"
            />
          </div>
        </aside>
      </div>

      {/* ⑧ 游戏商商标网格：Logo + 显示开关 + 上下移动，保存后前台品牌墙立即按新顺序渲染 */}
      <ProviderShowcasePanel
        initialProviders={initialProviders}
        onSaved={() => setPreviewKey((current) => current + 1)}
      />
    </div>
  );
}

/**
 * 主色派生出来的 5 个色阶 token（顺序即预览顺序）
 */
const DERIVED_TOKENS = ["brand", "soft", "pale", "deep", "ink"] as const;

/** 模块图标：与大厅里的视觉一一对应（轮播 / 功能岛 / 品牌墙） */
function ModuleIcon({ id }: { id: StorefrontModuleId }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "h-5 w-5 shrink-0 text-brand-soft",
  };

  if (id === "hero") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="12" rx="2.5" />
        <path d="m9 9 4 2.5L9 14z" />
        <path d="M8 20h8" />
      </svg>
    );
  }

  if (id === "action") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="8" height="7" rx="2" />
        <rect x="13" y="4" width="8" height="7" rx="2" />
        <rect x="3" y="13" width="8" height="7" rx="2" />
        <rect x="13" y="13" width="8" height="7" rx="2" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 8h7v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M13 8h7v5a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3z" />
      <path d="M6 5.5 7.5 8M17 5.5 18.5 8" />
    </svg>
  );
}

/** 互动组件图标：顶栏客服 / 侧边栏娱乐场 */
function InteractionIcon({ kind }: { kind: "chat" | "casino" }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "h-5 w-5 shrink-0 text-brand-soft",
  };

  if (kind === "chat") {
    return (
      <svg {...common}>
        <path d="M4 5.5h16v10H9l-5 4z" />
        <path d="M8 9h8M8 12h5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18" />
      <path d="m7 13 1.5-1.5L10 13l-1.5 1.5zM14 13l1.5-1.5L17 13l-1.5 1.5z" />
    </svg>
  );
}

/** 互动组件开关行：样式与模块开关保持一致 */
function InteractionRow({
  icon,
  title,
  hint,
  checked,
  onToggle,
  toggleLabel,
  stateLabel,
}: {
  icon: "chat" | "casino";
  title: string;
  hint: string;
  checked: boolean;
  onToggle: () => void;
  toggleLabel: string;
  stateLabel: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        checked
          ? "border-brand/20 bg-brand/[0.05]"
          : "border-white/[0.06] bg-white/[0.01] opacity-70"
      }`}
    >
      <InteractionIcon kind={icon} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold text-neutral-200">
          {title}
        </p>
        <p className="text-[10px] leading-relaxed text-neutral-500">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        aria-label={toggleLabel}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/60 ${
          checked
            ? "border-brand/50 bg-brand/70"
            : "border-white/15 bg-white/[0.06]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
            checked ? "left-[18px] bg-brand-ink" : "left-0.5 bg-neutral-400"
          }`}
        />
      </button>
      <span className="hidden w-12 shrink-0 text-right text-[9px] uppercase tracking-[0.1em] text-neutral-600 lg:block">
        {stateLabel}
      </span>
    </div>
  );
}

