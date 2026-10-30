"use client";

import { useLanguage } from "@/components/LanguageProvider";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className={`inline-flex shrink-0 items-center rounded-full border border-brand/25 bg-black/40 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}
    >
      <button
        type="button"
        onClick={() => setLanguage("zh")}
        aria-pressed={language === "zh"}
        aria-label={t("language.switchToZh")}
        title={t("language.switchToZh")}
        className={`h-7 min-w-8 rounded-full px-2 text-[10px] font-semibold leading-none transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
          language === "zh"
            ? "bg-gradient-to-r from-brand-deep via-brand-soft to-brand-deep text-brand-ink shadow-[0_4px_12px_-4px_var(--sf-a80)]"
            : "text-neutral-500 hover:text-brand-soft"
        }`}
      >
        ä¸­
      </button>
      <button
        type="button"
        onClick={() => setLanguage("en")}
        aria-pressed={language === "en"}
        aria-label={t("language.switchToEn")}
        title={t("language.switchToEn")}
        className={`h-7 min-w-8 rounded-full px-2 text-[10px] font-semibold leading-none transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
          language === "en"
            ? "bg-gradient-to-r from-brand-deep via-brand-soft to-brand-deep text-brand-ink shadow-[0_4px_12px_-4px_var(--sf-a80)]"
            : "text-neutral-500 hover:text-brand-soft"
        }`}
      >
        EN
      </button>
    </div>
  );
}
