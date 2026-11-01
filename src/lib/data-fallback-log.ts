/**
 * 兜底日志（服务端渲染期专用）。
 *
 * 背景：Next 16 的 dev 指示器把浏览器控制台里的 `console.error` 一律算成
 * "Issues"，而服务端组件里的 `console.error` 在开发模式下会被 React 回放
 * 到浏览器（终端里能看到 `[browser]` 前缀的那条就是）。于是「数据库临时不可用
 * → 回退到内置数据」这种已经被优雅处理的情况，也会在左下角亮红点，很吓人。
 *
 * 约定：
 * - 开发环境：降级成 `console.debug`（DevTools 默认过滤掉，也不计入 Issues），
 *   只保留终端里的排查线索，并且同一次进程内同一个场景只打一条，避免刷屏；
 * - 生产环境：仍然是 `console.error`，写进服务端日志（不会回放到浏览器）。
 */
const reportedScopes = new Set<string>();

export function logDataFallback(scope: string, error: unknown): void {
  if (process.env.NODE_ENV === "production") {
    console.error(`[data-fallback] ${scope}`, error);
    return;
  }

  if (reportedScopes.has(scope)) {
    return;
  }

  reportedScopes.add(scope);

  console.debug(
    `[data-fallback] ${scope} —— 已回退到内置数据，页面不受影响。排查数据库请运行 npm run db:check。`,
    error,
  );
}
