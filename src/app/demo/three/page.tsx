import type { Metadata } from "next";

import { ThreeSceneDemo } from "./three-scene-demo";

export const metadata: Metadata = {
  title: "Three.js Scene Demo | DBAIRS",
  description:
    "Live check that the DBAIRS 3D foundation works: a code-only SceneCanvas cube next to a real .glb loaded through ModelViewer (three / fiber / drei are lazy-loaded).",
  // 联调页不该被搜索引擎收录（不是给玩家看的内容页）
  robots: { index: false, follow: false },
};

/**
 * 3D 基座联调页（公众可访问，不需要登录、不查库、不需要 `?tenant=`）。
 *
 * 用途：改完 `src/components/three/*` 或换了机器的显卡 / 浏览器之后，
 * 打开这一页就能确认 WebGL 链路是通的，不用先去大厅里翻一个还没接好的模块。
 *
 * 两条与「主题背景色预览页」一致的约束：
 * 1. 路径必须登记在 `src/proxy.ts` 的 `PUBLIC_PREVIEW_PATHS` 里（常量
 *    `THREE_DEMO_PATH`），否则未登录访问会被登录校验重定向到 /login；
 * 2. 本页只渲染本地组件：不写库、不读会话、不依赖任何租户数据，
 *    所以也不需要 `requireStorefront()` —— 直接访问 `/demo/three` 即可。
 */
export default function ThreeDemoPage() {
  return (
    <main className="min-h-screen bg-[#050505] px-4 py-10 text-neutral-200">
      <div className="mx-auto w-full max-w-5xl">
        <ThreeSceneDemo />
      </div>
    </main>
  );
}
