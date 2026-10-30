"use client";

import type { CSSProperties } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { StorefrontTheme } from "@/lib/storefront";

/**
 * 主题配色的实时预览卡片。
 *
 * 它不画「假颜色」，而是把 buildStorefrontTheme 算出来的同一套 CSS 变量
 * （--primary / --primary-soft / --primary-dark）挂在自己的根节点上，
 * 卡片里的按钮、光晕、胶囊全部用 var(--primary*) 上色。
 * 因此：后台点色块 / 拖深浅滑条 → 这张卡片立即变化，
 * 保存后大厅 / 品牌展馆用的是完全相同的三个颜色值。
 *
 * 底部把三个变量的实际 hsl() 值贴出来，方便运营和开发对账。
 */

const VAR_ROWS = [
  { name: "--primary", key: "primary" },
  { name: "--primary-soft", key: "primarySoft" },
  { name: "--primary-dark", key: "primaryDark" },
] as const;

export function ThemePreviewCard({ theme }: { theme: StorefrontTheme }) {
  const { t } = useLanguage();

  return (
    <aside
      aria-label={t("storefront.color.preview.title")}
      data-theme-preview
      data-theme-preview-brightness={theme.brightness}
      data-theme-preview-primary={theme.primary}
      className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/50 p-3"
      style={theme.style as CSSProperties}
    >
      {/* 主色光晕：直接吃 --primary-soft，拖动滑条时会跟着变亮 / 变暗 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -right-10 h-36 w-36 rounded-full opacity-70 blur-2xl"
        style={{
          background:
            "radial-gradient(circle, var(--primary-soft), transparent 70%)",
        }}
      />

      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
            {t("storefront.color.preview.title")}
          </p>
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold"
            style={{
              borderColor: "var(--primary-soft)",
              color: "var(--primary-soft)",
              background: "color-mix(in srgb, var(--primary) 12%, transparent)",
            }}
            data-theme-preview-brightness-badge
          >
            {theme.brightness}%
          </span>
        </div>

        {/* 模拟大厅里的一小块：卡片底 = --primary-dark，按钮 = 三色渐变，胶囊 = --primary */}
        <div
          className="mt-2.5 rounded-lg border border-primary/30 p-2.5"
          style={{
            background:
              "linear-gradient(160deg, color-mix(in srgb, var(--primary-dark) 65%, #000) 0%, #060606 72%)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[8px] uppercase tracking-[0.18em] text-neutral-500">
                {t("storefront.color.preview.balance")}
              </p>
              <p
                className="mt-0.5 truncate font-mono text-sm font-semibold"
                style={{ color: "var(--primary-soft)" }}
              >
                12,480.00
              </p>
            </div>
            <span
              className="shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em]"
              style={{
                borderColor: "color-mix(in srgb, var(--primary) 55%, transparent)",
                color: "var(--primary)",
              }}
            >
              {t("storefront.color.preview.pill")}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="h-7 flex-1 rounded-md text-center text-[10px] font-bold leading-7"
              data-theme-preview-button
              style={{
                background:
                  "linear-gradient(120deg, var(--primary-soft), var(--primary) 55%, var(--primary-dark))",
                color: "var(--primary-ink)",
                boxShadow: "0 8px 20px -10px var(--primary-soft)",
              }}
            >
              {t("storefront.color.preview.deposit")}
            </span>
            <span
              className="h-7 shrink-0 rounded-md border px-2 text-[10px] font-semibold leading-7"
              style={{
                borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)",
                color: "var(--primary-soft)",
                background: "color-mix(in srgb, var(--primary) 10%, transparent)",
              }}
            >
              {t("storefront.color.preview.highlight")}
            </span>
          </div>
        </div>

        {/* 真正注入的三个 CSS 变量 + 计算后的值 */}
        <p className="mt-2.5 text-[9px] uppercase tracking-[0.2em] text-neutral-600">
          {t("storefront.color.vars")}
        </p>
        <ul className="mt-1 space-y-1">
          {VAR_ROWS.map((row) => (
            <li key={row.name} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                style={{ background: `var(${row.name})` }}
              />
              <code className="font-mono text-[9px] text-neutral-400">
                {row.name}
              </code>
              <code className="ml-auto truncate font-mono text-[9px] text-neutral-500">
                {theme[row.key]}
              </code>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
