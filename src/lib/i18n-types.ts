import zh from "@/locales/zh.json";

export type Language = "zh" | "en";

/**
 * 以中文词典为唯一事实来源；新增文案时先补 zh.json，
 * TypeScript 会在 t("...") 处提示缺失的 key。
 */
export type TranslationKey = keyof typeof zh;

export type TranslationValues = Record<string, string | number>;

export type TFunction = (
  key: TranslationKey,
  values?: TranslationValues,
) => string;
