import { redirect } from "next/navigation";

import { THEME_BACKGROUND_PREVIEW_PATH } from "@/lib/theme-backgrounds";

/**
 * 旧路径兜底：改造前的「3 种封面风格」预览页（/demo/game-card-styles）。
 *
 * 客户手里的老链接不能 404（AI 销冠曾经把它发给过客户），
 * 这里直接跳到新的 15 色主题背景预览页。本页不查库、不读会话。
 */
export default function LegacyGameCardStyleDemoPage() {
  redirect(THEME_BACKGROUND_PREVIEW_PATH);
}
