import type { Metadata } from "next";

import { ThemeBackgroundGallery } from "./theme-background-gallery";

export const metadata: Metadata = {
  title: "Theme Background Colors | DBAIRS",
  description:
    "Live preview of the 15 DBAIRS theme background colours: the lobby stays dark, only the ambient glow and the game-card frame / text plate follow the accent colour.",
};

/**
 * 主题背景色预览页（公众可访问，不需要登录）。
 *
 * 用途：AI 销冠回答「网站能不能换色调 / 有没有别的配色」时，
 * 把这一页的 15 个锚点链接发给客户直接看效果。
 *
 * 页面渲染的就是前台真实的 GameCard 组件，不做截图、不做仿制图：
 * 色表一改（src/lib/theme-backgrounds.ts），这里立刻同步。
 * 本页只做展示、不写库 —— 主题色只能由平台在【租户管理 → 开站 / 编辑】时配置。
 */
export default function ThemeBackgroundDemoPage() {
  return (
    <main className="min-h-screen bg-[#050505] px-4 py-10 text-neutral-200">
      <div className="mx-auto w-full max-w-6xl">
        <ThemeBackgroundGallery />
      </div>
    </main>
  );
}
