"use client";

import { Center, OrbitControls, useGLTF } from "@react-three/drei";
import { useMemo } from "react";

/**
 * 一个 `.glb` / `.gltf` 模型的「舞台」：灯光 + 居中 + 可选旋转控制。
 *
 * **只能**由 `model-viewer.tsx` 通过 `next/dynamic({ ssr: false })` 懒加载：
 * 本文件 import 了 `@react-three/drei`（体积远大于 three 本身），
 * 一旦被页面静态引用，drei 的整包就会进首屏 bundle。
 *
 * 注意：
 * - `useGLTF` 有内置缓存，同一个 url 只会下载 / 解析一次；
 * - 这里对 scene 做了一次 `clone`，同一页面渲染多个相同模型时不会互相抢 transform 与材质状态；
 * - 模型路径**必须**是 `resolveThreeAssetUrl()` 解析过的合法地址（模型加载器不接受脏值）。
 */

export type ModelStageProps = {
  url: string;
  /** 自动缓慢旋转（减弱动态效果时由外层降级成单帧渲染，不会一直转） */
  autoRotate?: boolean;
  /** 允许鼠标 / 触摸拖拽旋转缩放 */
  enableControls?: boolean;
  /** 相对缩放（模型单位差异大时用来微调到合适大小） */
  scale?: number;
};

/** 主光 + 环境光：够亮但不过曝，深色站点上金 / 银材质不会发死 */
const KEY_LIGHT_POSITION: [number, number, number] = [4, 6, 6];

export default function ModelStage({
  url,
  autoRotate = true,
  enableControls = true,
  scale = 1,
}: ModelStageProps) {
  const gltf = useGLTF(url);
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={KEY_LIGHT_POSITION} intensity={1.6} />
      <Center>
        <primitive object={model} scale={scale} />
      </Center>
      {enableControls ? (
        <OrbitControls
          autoRotate={autoRotate}
          autoRotateSpeed={0.8}
          enablePan={false}
          enableZoom={false}
          // 限位：不允许把模型翻到背面 / 抬头看天花板
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={(Math.PI * 2) / 3}
        />
      ) : null}
    </>
  );
}
