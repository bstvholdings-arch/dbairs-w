"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  THEME_BRIGHTNESS_MAX,
  THEME_BRIGHTNESS_MIN,
  THEME_COLOR_PRESETS,
  isValidThemeColor,
} from "@/lib/storefront";
import type { TenantSiteSettings } from "@/lib/tenant-console";

export function TenantSettingsView({
  settings,
}: {
  settings: TenantSiteSettings;
}) {
  const { t } = useLanguage();
  const [hex, setHex] = useState(settings.themeColor.hex);
  const [brightness, setBrightness] = useState(settings.themeColor.brightness);
  const [showTopbarChat, setShowTopbarChat] = useState(
    settings.layout.showTopbarChat,
  );
  const [showSidebarCasinoAnim, setShowSidebarCasinoAnim] = useState(
    settings.layout.showSidebarCasinoAnim,
  );
  const [languageStyle, setLanguageStyle] = useState(
    settings.layout.languageStyle,
  );
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    document.title = t("tenantSettings.documentTitle");
  }, [t]);

  async function handleSave() {
    const nextHex = hex.trim().toLowerCase();

    if (!isValidThemeColor(nextHex)) {
      setBanner({ tone: "error", text: t("tenantSettings.error.invalidColor") });
      return;
    }

    setSaving(true);
    setBanner(null);

    try {
      const response = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          themeColor: { hex: nextHex, brightness },
          layout: {
            showTopbarChat,
            showSidebarCasinoAnim,
            languageStyle,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        settings?: TenantSiteSettings;
      } | null;

      if (!response.ok) {
        setBanner({
          tone: "error",
          text: payload?.error || t("tenantSettings.error.saveFailed"),
        });
        return;
      }

      if (payload?.settings) {
        setHex(payload.settings.themeColor.hex);
        setBrightness(payload.settings.themeColor.brightness);
        setLanguageStyle(payload.settings.layout.languageStyle);
      }

      setBanner({ tone: "ok", text: t("tenantSettings.banner.saved") });
    } catch {
      setBanner({ tone: "error", text: t("common.networkError") });
    } finally {
      setSaving(false);
    }
  }

  const facts = [
    { label: t("tenantSettings.site.name"), value: settings.tenantName },
    { label: t("tenantSettings.site.domain"), value: settings.domain },
    { label: t("tenantSettings.site.subdomain"), value: settings.subdomain },
    { label: t("tenantSettings.site.status"), value: settings.status },
  ];

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("tenantSettings.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantSettings.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          {t("tenantSettings.subtitle")}
        </p>
      </header>

      {banner ? (
        <p
          className={`mt-4 rounded-lg border px-3 py-2 text-[11px] ${
            banner.tone === "ok"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/25 bg-red-400/10 text-red-200"
          }`}
        >
          {banner.text}
        </p>
      ) : null}

      <section className="mt-6 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-5">
        <h2 className="text-sm font-medium text-neutral-200">
          {t("tenantSettings.site.title")}
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {fact.label}
              </dt>
              <dd className="mt-1 truncate text-xs text-neutral-300">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-5">
        <h2 className="text-sm font-medium text-neutral-200">
          {t("tenantSettings.skin.title")}
        </h2>
        <p className="mt-1 text-[10px] text-neutral-600">
          {t("tenantSettings.skin.subtitle")}
        </p>

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
              {t("tenantSettings.skin.hexLabel")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {THEME_COLOR_PRESETS.map((preset) => {
                const selected =
                  preset.value.toLowerCase() === hex.toLowerCase();

                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setHex(preset.value)}
                    title={t(preset.labelKey)}
                    aria-pressed={selected}
                    className={`h-9 w-9 rounded-lg border-2 transition-transform hover:scale-105 ${
                      selected ? "border-[#f5e6b8]" : "border-white/[0.08]"
                    }`}
                    style={{ backgroundColor: preset.value }}
                  >
                    <span className="sr-only">{t(preset.labelKey)}</span>
                  </button>
                );
              })}
            </div>

            <label className="mt-4 block text-[10px] uppercase tracking-[0.16em] text-neutral-600">
              {t("tenantSettings.skin.hexLabel")}
              <input
                value={hex}
                onChange={(event) => setHex(event.target.value)}
                maxLength={7}
                spellCheck={false}
                className="mt-1.5 h-9 w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 font-mono text-xs text-neutral-200 focus:border-[#d4af37]/45 focus:outline-none"
              />
            </label>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.16em] text-neutral-600">
              {t("tenantSettings.skin.brightnessLabel")}
              <input
                type="range"
                min={THEME_BRIGHTNESS_MIN}
                max={THEME_BRIGHTNESS_MAX}
                value={brightness}
                onChange={(event) => setBrightness(Number(event.target.value))}
                className="mt-2 w-full accent-[#d4af37]"
              />
            </label>
            <p className="mt-1 font-mono text-xs text-[#f0d27c]">
              {brightness}
            </p>

            <div
              className="mt-4 flex items-center justify-center rounded-xl border border-[#d4af37]/15 bg-black/50 py-6 font-mono text-xs"
              style={{ color: hex }}
            >
              {hex.toUpperCase()}
            </div>
          </div>
        </div>
      </section>


      <section className="mt-4 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-5">
        <h2 className="text-sm font-medium text-neutral-200">
          {t("tenantSettings.layout.title")}
        </h2>
        <p className="mt-1 text-[10px] text-neutral-600">
          {t("tenantSettings.layout.subtitle")}
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5">
            <span className="text-xs text-neutral-300">
              {t("tenantSettings.layout.showTopbarChat")}
            </span>
            <input
              type="checkbox"
              checked={showTopbarChat}
              onChange={(event) => setShowTopbarChat(event.target.checked)}
              className="h-4 w-4 accent-[#d4af37]"
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5">
            <span className="text-xs text-neutral-300">
              {t("tenantSettings.layout.showSidebarCasinoAnim")}
            </span>
            <input
              type="checkbox"
              checked={showSidebarCasinoAnim}
              onChange={(event) =>
                setShowSidebarCasinoAnim(event.target.checked)
              }
              className="h-4 w-4 accent-[#d4af37]"
            />
          </label>

          <label className="block rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5 text-xs text-neutral-300">
            {t("tenantSettings.layout.languageStyle")}
            <input
              value={languageStyle}
              onChange={(event) => setLanguageStyle(event.target.value)}
              maxLength={16}
              className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 text-xs text-neutral-200 focus:border-[#d4af37]/45 focus:outline-none"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="mt-4 inline-flex h-9 items-center rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-4 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("tenantSettings.actions.save")}
        </button>
      </section>

      <section className="mt-4 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-5">
        <h2 className="text-sm font-medium text-neutral-200">
          {t("tenantSettings.tools.title")}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/tenant/providers"
            className="inline-flex h-9 items-center rounded-lg border border-[#d4af37]/20 px-3 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
          >
            {t("tenantSettings.tools.rates")}
          </Link>
          <Link
            href="/tenant/payments"
            className="inline-flex h-9 items-center rounded-lg border border-[#d4af37]/20 px-3 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
          >
            {t("tenantSettings.tools.payments")}
          </Link>
        </div>
        <p className="mt-3 text-[10px] leading-5 text-neutral-600">
          {t("tenantSettings.tools.note")}
        </p>
      </section>
    </div>
  );
}

