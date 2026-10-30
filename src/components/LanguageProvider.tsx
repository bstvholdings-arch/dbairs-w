"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import en from "@/locales/en.json";
import zh from "@/locales/zh.json";
import type {
  Language,
  TFunction,
  TranslationKey,
  TranslationValues,
} from "@/lib/i18n-types";

const LANGUAGE_STORAGE_KEY = "dbairs.language";

const dictionaries = {
  zh,
  en,
} satisfies Record<Language, Record<TranslationKey, string>>;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: TFunction;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function isLanguage(value: unknown): value is Language {
  return value === "zh" || value === "en";
}

/**
 * 文案占位符替换。
 *
 * 历史上词典里同时存在两种写法：`{{name}}`（旧文案）和 `{name}`（新文案）。
 * 两种都必须支持，否则 `{name} is now unlisted` 会被原样渲染到界面上。
 * 没有传对应变量时保留占位符原文，方便排查漏传的参数。
 */
const PLACEHOLDER_PATTERN = /\{\{\s*([\w.]+)\s*\}\}|\{\s*([\w.]+)\s*\}/g;

function interpolate(template: string, values?: TranslationValues) {
  if (!values) {
    return template;
  }

  return template.replace(
    PLACEHOLDER_PATTERN,
    (
      match: string,
      doubleBracedName?: string,
      singleBracedName?: string,
    ) => {
      const name = doubleBracedName ?? singleBracedName ?? "";

      return Object.prototype.hasOwnProperty.call(values, name)
        ? String(values[name])
        : match;
    },
  );
}


export function LanguageProvider({ children }: { children: ReactNode }) {
  // The server cannot read localStorage, so the first paint always uses
  // English. A stored preference is restored after mount to avoid hydration
  // mismatches while keeping the default experience English.
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    let restoreFrame = 0;

    try {
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);

      if (isLanguage(stored)) {
        // 放到下一帧再更新，避免 effect 内同步 setState 触发级联渲染。
        restoreFrame = window.requestAnimationFrame(() => {
          setLanguageState(stored);
        });
      }
    } catch {
      // 隐私模式或存储被禁用时保持默认中文。
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === LANGUAGE_STORAGE_KEY && isLanguage(event.newValue)) {
        setLanguageState(event.newValue);
      }
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      if (restoreFrame) {
        window.cancelAnimationFrame(restoreFrame);
      }

      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.language = language;
  }, [language]);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);

    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // 存储不可用时仍然允许当前页面即时切换。
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === "zh" ? "en" : "zh");
  }, [language, setLanguage]);

  const t = useCallback<TFunction>(
    (key, values) => {
      const dictionary = dictionaries[language];
      const template = dictionary[key] ?? dictionaries.en[key] ?? key;

      return interpolate(template, values);
    },
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }

  return context;
}
