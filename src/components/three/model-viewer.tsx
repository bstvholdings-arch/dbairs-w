"use client";

import dynamic from "next/dynamic";
import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";

import { isThreeModelPath, resolveThreeAssetUrl } from "@/lib/three-assets";

import type { ModelStageProps } from "./model-stage";
import { SceneCanvas } from "./scene-canvas";

/**
 * 展示一个 3D 模型的完整组件（前台唯一入口）。
 *
 * 职责：路径校验 → 懒加载 → 兜底。业务组件只需要给一个路径：
 *
 *   <ModelViewer src="models/dice.glb" className="aspect-square w-full" />
 *
 * 三条硬规则：
 * 1. **路径必须过 `resolveThreeAssetUrl()`**：相对路径会被补成 `/assets/3d/...`，
 *    脏数据（`javascript:` / `data:` / `//host/x.glb` / 带 `..`）直接判为「没有模型」，
 *    连 WebGL 上下文都不创建；
 * 2. **模型加载失败不能让页面崩**：`.glb` 损坏 / 404 时 `useGLTF` 会抛错，
 *    这里用 ErrorBoundary 接住并渲染 `fallback`（通常是一张封面图或首字母占位）；
 * 3. **只加载模型文件**：传 `.jpg` / `.zip` 这类非模型路径时只打一条开发期警告，
 *    不浪费一次网络请求 + 解析。
 */

const ModelStageLazy = dynamic(() => import("./model-stage"), { ssr: false });

export type ModelViewerProps = {
  /**
   * 模型路径，三种写法都支持：
   * - `models/dice.glb`（相对素材根目录 → `/assets/3d/models/dice.glb`）
   * - `/assets/3d/models/dice.glb`（站内绝对路径）
   * - `https://cdn.example.com/dice.glb`（CDN 直链）
   */
  src: string;
  /** 外层容器类名：**必须带高度**（`h-64` / `aspect-square` 等），否则画布高度为 0 */
  className?: string;
  /** 加载失败 / 路径不合法时的兜底内容（不传就什么都不渲染） */
  fallback?: ReactNode;
  autoRotate?: boolean;
  enableControls?: boolean;
  scale?: number;
  /** 是否等进入视口再加载（默认 true，首屏外的 3D 模块不要抢首屏带宽） */
  waitForVisible?: boolean;
};

type ModelErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ModelErrorBoundaryState = { failed: boolean };

/**
 * 最小错误边界：只为了「模型坏了页面还在」。
 * 用 class 是因为 React 19 仍没有 hooks 版的错误边界。
 */
class ModelErrorBoundary extends Component<
  ModelErrorBoundaryProps,
  ModelErrorBoundaryState
> {
  state: ModelErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ModelErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 只在开发期提示原因：生产环境模型 404 属于内容问题，不该刷玩家控制台
    if (process.env.NODE_ENV !== "production") {
      console.warn("[three] 模型加载失败，已降级为占位：", error.message, info.componentStack);
    }
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}

export function ModelViewer({
  src,
  className,
  fallback = null,
  autoRotate = true,
  enableControls = true,
  scale,
  waitForVisible = true,
}: ModelViewerProps) {
  const url = resolveThreeAssetUrl(src);

  if (!url || !isThreeModelPath(url)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[three] 模型路径不合法或不是 .glb/.gltf，已跳过渲染：${src}`);
    }

    return <>{fallback}</>;
  }

  const stageProps: ModelStageProps = {
    url,
    autoRotate,
    enableControls,
    scale,
  };

  return (
    <ModelErrorBoundary fallback={fallback}>
      <SceneCanvas className={className} waitForVisible={waitForVisible}>
        <Suspense fallback={null}>
          <ModelStageLazy {...stageProps} />
        </Suspense>
      </SceneCanvas>
    </ModelErrorBoundary>
  );
}
