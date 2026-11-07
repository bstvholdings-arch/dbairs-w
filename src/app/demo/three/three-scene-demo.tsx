"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { ModelViewer } from "@/components/three/model-viewer";
import { SceneCanvas } from "@/components/three/scene-canvas";
import { THREE_DEMO_MODEL_PATH } from "@/lib/three-assets";

/**
 * 3D 基座联调页（/demo/three）的客户端部分。
 *
 * 这一页只干一件事：证明「页面 → 懒加载入口 → three → WebGL」这条链路是通的。
 * 因此它**故意分成左右两块**，方便一眼定位故障点：
 *
 * - 左：`SceneCanvas` + 纯 JSX 图元（不加载任何素材文件）。
 *   看不到东西 = 容器高度 / WebGL 上下文的问题，与模型无关；
 * - 右：`ModelViewer` 加载 `public/assets/3d/models/ui/demo-cube.glb`。
 *   左边正常、右边空白 = 素材路径或 `.glb` 文件本身的问题（控制台有 [three] 警告）。
 *
 * 两条与业务组件一致的约束（见 AGENTS.md 第 16 条）：
 * 1. 这里 `import` 的只有 `SceneCanvas` / `ModelViewer` 两个轻量入口，
 *    three / fiber / drei 全部走 `next/dynamic({ ssr: false })` 懒加载；
 * 2. 每个容器都自带高度（`aspect-square`），高度为 0 时 WebGL 不报错也不显示。
 */

/** 画布外壳：两个演示块共用，保证「容器必须自带高度」这条只写一次 */
const CANVAS_SHELL =
  "aspect-square w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-black/40";

/** 块标题 / 说明的统一样式，避免十几行重复 className */
const BLOCK_TITLE = "text-sm font-bold text-neutral-100";
const BLOCK_HINT = "mt-1 mb-3 text-[12px] leading-5 text-neutral-500";

export function ThreeSceneDemo() {
  const { t } = useLanguage();

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.38em] text-[#d4af37]">
          {t("threeDemo.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-black text-neutral-50 sm:text-3xl">
          {t("threeDemo.title")}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
          {t("threeDemo.hint")}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
          <h2 className={BLOCK_TITLE}>{t("threeDemo.canvasTitle")}</h2>
          <p className={BLOCK_HINT}>{t("threeDemo.canvasHint")}</p>
          <SceneCanvas className={CANVAS_SHELL} waitForVisible={false}>
            <ambientLight intensity={0.9} />
            <directionalLight position={[4, 6, 6]} intensity={1.8} />
            <mesh rotation={[0.5, 0.8, 0]}>
              <boxGeometry args={[1.6, 1.6, 1.6]} />
              <meshStandardMaterial
                color="#d4af37"
                metalness={0.85}
                roughness={0.25}
              />
            </mesh>
          </SceneCanvas>
        </section>

        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
          <h2 className={BLOCK_TITLE}>{t("threeDemo.modelTitle")}</h2>
          <p className={BLOCK_HINT}>{t("threeDemo.modelHint")}</p>
          <ModelViewer
            src={THREE_DEMO_MODEL_PATH}
            className={CANVAS_SHELL}
            waitForVisible={false}
            fallback={
              <div
                className={`${CANVAS_SHELL} flex items-center justify-center px-6 text-center text-[12px] leading-5 text-neutral-500`}
              >
                {t("threeDemo.modelFallback")}
              </div>
            }
          />
          <p className="mt-2 break-all font-mono text-[11px] text-neutral-600">
            public/assets/3d/{THREE_DEMO_MODEL_PATH}
          </p>
        </section>
      </div>

      <section className="rounded-2xl border border-[#d4af37]/15 bg-[#d4af37]/[0.03] p-4 sm:p-5">
        <h2 className={BLOCK_TITLE}>{t("threeDemo.assetTitle")}</h2>
        <p className="mt-1 text-[12px] leading-5 text-neutral-400">
          {t("threeDemo.assetHint")}
        </p>
      </section>
    </div>
  );
}
