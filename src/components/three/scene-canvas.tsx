"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { SceneCanvasInnerProps } from "./scene-canvas-inner";

/**
 * 3D 场景的统一入口（前台所有 WebGL 都从这里进来）。
 *
 * 它负责四件事，业务组件不需要重复实现：
 * 1. **懒加载**：`@react-three/fiber` / `three` 通过 `next/dynamic({ ssr: false })`
 *    单独打包，页面首屏不会下载 3D 引擎（静态 import 会把 ~600KB 压进首屏，LCP 直接崩）；
 * 2. **进入视口才挂载**：默认先用 IntersectionObserver 等元素快进屏幕（提前 200px）才创建
 *    WebGL 上下文 —— 首屏外的 3D 模块不该抢首屏带宽，也不该在后台烧 GPU；
 * 3. **尊重 prefers-reduced-motion**：系统开了「减弱动态效果」时把 `frameloop` 降级成
 *    `"demand"`（只在需要时渲染一帧），动画停住但画面仍在，与全站其它动画同一口径；
 * 4. **尺寸兜底**：外层容器铺满 + `relative`，`Canvas` 自己铺满容器。
 *    ⚠️ 容器**必须有高度**（`h-64` / `aspect-square` 之类），否则 WebGL 画布高度为 0，看起来「什么都没有」。
 *
 * 用法：
 *   <SceneCanvas className="aspect-square w-full">
 *     <ambientLight intensity={0.8} />
 *     <MyModel />
 *   </SceneCanvas>
 */

const SceneCanvasLazy = dynamic(() => import("./scene-canvas-inner"), {
  ssr: false,
});

/** 系统「减弱动态效果」的媒体查询：与 globals.css 里各动画的降级口径一致 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function canUseMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (!canUseMatchMedia()) {
    return () => {};
  }

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

function getReducedMotionSnapshot(): boolean {
  if (!canUseMatchMedia()) {
    return false;
  }

  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** 服务端 / 首帧快照恒为 false：动画照常渲染，水合后再按系统设置降级 */
function getServerReducedMotionSnapshot(): boolean {
  return false;
}

export type SceneCanvasProps = SceneCanvasInnerProps & {
  /** 外层容器类名：决定尺寸 / 圆角 / 位置；渲染前用它占住版面，不会引起布局跳动 */
  className?: string;
  /** 是否等进入视口再加载 three（默认 true）。已经确定在首屏的关键展示可设 false */
  waitForVisible?: boolean;
  /** 视口判定提前量，默认提前 200px 开始加载 */
  rootMargin?: string;
};

function usePrefersReducedMotion(): boolean {
  // 用 useSyncExternalStore 而不是「effect 里 setState」：
  // 1. 服务端渲染时取 false（快照函数独立），不会出现 hydration 不一致；
  // 2. 系统设置变化由订阅回调驱动，不在 effect 体内同步 setState（eslint react-hooks 明确禁止）。
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot,
  );
}

export function SceneCanvas({
  className,
  waitForVisible = true,
  rootMargin = "200px",
  frameloop,
  children,
  ...rest
}: SceneCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(!waitForVisible);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!waitForVisible || mounted) {
      return;
    }

    const node = containerRef.current;

    // 容器还没就绪 / 极老浏览器没有 IntersectionObserver：
    // 下一帧直接挂载 —— 不要因为缺少 API 就永远不显示，
    // 也不要在 effect 体内同步 setState（eslint react-hooks/set-state-in-effect）。
    if (!node || typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setMounted(true), 0);

      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [waitForVisible, mounted, rootMargin]);

  // 减弱动态效果时只按需渲染（静态一帧），否则用调用方指定值
  const resolvedFrameloop = prefersReducedMotion ? "demand" : (frameloop ?? "always");

  return (
    <div
      ref={containerRef}
      className={className ? `relative ${className}` : "relative h-full w-full"}
    >
      {mounted ? (
        <SceneCanvasLazy frameloop={resolvedFrameloop} {...rest}>
          {children}
        </SceneCanvasLazy>
      ) : null}
    </div>
  );
}
