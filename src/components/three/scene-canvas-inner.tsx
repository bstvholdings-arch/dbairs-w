"use client";

import { Canvas } from "@react-three/fiber";
import type { ComponentProps } from "react";

/**
 * 真正创建 WebGL 上下文的组件。
 *
 * **只能**由 `scene-canvas.tsx` 通过 `next/dynamic({ ssr: false })` 懒加载，
 * 任何页面 / 组件都**不要**直接 import 本文件 —— 一旦静态 import，
 * three（约 600KB 压缩前）+ fiber 就会被塞进首屏 bundle，直接拖垮 LCP。
 *
 * 这里只做三件事：给默认相机 / 开抗锯齿 / 限制 DPR。
 * 具体场景内容（模型、灯光、控制器）由调用方作为 children 传进来。
 */

export type SceneCanvasInnerProps = {
  children?: React.ReactNode;
  camera?: ComponentProps<typeof Canvas>["camera"];
  /** "always" 持续渲染；"demand" 只在需要时渲染（静态展示 / 减弱动态效果时用） */
  frameloop?: ComponentProps<typeof Canvas>["frameloop"];
  shadows?: ComponentProps<typeof Canvas>["shadows"];
  dpr?: ComponentProps<typeof Canvas>["dpr"];
  className?: string;
  style?: ComponentProps<typeof Canvas>["style"];
  onCreated?: ComponentProps<typeof Canvas>["onCreated"];
};

/** 默认相机：略微俯视的正面视角，适合放单个产品级模型 */
const DEFAULT_CAMERA: NonNullable<SceneCanvasInnerProps["camera"]> = {
  position: [0, 0.6, 6],
  fov: 45,
  near: 0.1,
  far: 100,
};

/**
 * 渲染像素比上限。手机 3x 屏全量渲染会直接过热降频，
 * 3D 场景封顶 2 已经足够清晰（这也是 R3F 官方建议值）。
 */
const MAX_DPR = 2;

export default function SceneCanvasInner({
  children,
  camera = DEFAULT_CAMERA,
  frameloop = "always",
  shadows = false,
  dpr = [1, MAX_DPR],
  className,
  style,
  onCreated,
}: SceneCanvasInnerProps) {
  return (
    <Canvas
      camera={camera}
      frameloop={frameloop}
      shadows={shadows}
      dpr={dpr}
      className={className}
      style={style}
      onCreated={onCreated}
      gl={{
        antialias: true,
        // 透明背景：3D 场景要能叠在大厅的深色底纹上，不要自己刷一块白底
        alpha: true,
        powerPreference: "high-performance",
      }}
    >
      {children}
    </Canvas>
  );
}
