import en from "@/locales/en.json";
import zh from "@/locales/zh.json";

import type { TranslationKey } from "./i18n-types";

/**
 * 服务端客服回复文案。
 *
 * 玩家侧 AI 客服的回复要同时「展示给玩家」和「写进 AiChatLog 供商户后台查看」，
 * 因此必须在服务端拿到与界面一致的多语言文案（不能依赖浏览器里的 LanguageProvider）。
 * 这里直接读词典：找不到 key 时回退英文，再回退中文，绝不返回 undefined。
 */

export type SupportLanguage = "zh" | "en";

export function isSupportLanguage(value: unknown): value is SupportLanguage {
  return value === "zh" || value === "en";
}

export function getSupportReplyText(
  language: SupportLanguage,
  key: TranslationKey,
): string {
  const dictionary = language === "zh" ? zh : en;

  return dictionary[key] ?? en[key] ?? zh[key] ?? "";
}
