"use client";

import { useEffect, useState } from "react";

/**
 * 把高频变化的输入值延迟一小段时间再交给昂贵的渲染使用。
 *
 * 搜索框用它来防抖：输入框本身始终受控于原始值（打字绝不卡顿），
 * 只有过滤 / 渲染拿到的是延迟后的值。
 *
 * delay <= 0 时直接返回原始值（小数据量无需防抖，保证 onChange 即时过滤）。
 */
export function useDebouncedValue<T>(value: T, delay = 120): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    // delay <= 0 时返回值直接取原始值（见下方 return），这里不再同步 setState，
    // 避免在 effect 里同步改状态触发级联渲染。
    if (delay <= 0) {
      return;
    }

    const timer = window.setTimeout(() => setDebounced(value), delay);

    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return delay <= 0 ? value : debounced;
}
