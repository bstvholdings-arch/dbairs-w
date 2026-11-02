import type { Metadata } from "next";

import { GameCardStyleGallery } from "./game-card-style-gallery";

export const metadata: Metadata = {
  title: "Game Card Cover Styles | DBAIRS",
  description:
    "Live preview of the three DBAIRS lobby game-card cover styles: Cyber Neon, Royal Gold and Candy Pop.",
};

/**
 * 游戏封面风格预览页（公众可访问，不需要登录）。
 *
 * 用途：AI 销冠回答「网站长什么样 / 有没有别的风格 / 能不能换封面」时，
 * 把这一页的 3 个锚点链接发给客户直接看效果。
 *
 * 页面渲染的就是前台真实的 GameCard 组件，不做截图、不做仿制图：
 * 风格 token 一改（src/lib/game-card-styles.ts），这里立刻同步。
 * 本页只做展示、不写库——风格只能由平台在【租户管理 → 开站 / 编辑】时配置。
 */
export default function GameCardStyleDemoPage() {
  return (
    <main className="min-h-screen bg-[#050505] px-4 py-10 text-neutral-200">
      <div className="mx-auto w-full max-w-6xl">
        <GameCardStyleGallery />
      </div>
    </main>
  );
}
