"use client";

import { useEffect, useState } from "react";

import { LOBBY_ONLINE_MIN } from "@/lib/lobby-games";

/** 跳动节奏：每 2 ~ 3 秒一次 */
const TICK_MIN_MS = 2000;
const TICK_MAX_MS = 3000;
/** 单次波动：-3 ~ +6，既有流失也有新玩家进入 */
const DELTA_MIN = -3;
const DELTA_MAX = 6;

export type OnlineCountState = {
  count: number;
  /** 每次跳动 +1，用于重播数字跳动动画 */
  tick: number;
};

/**
 * 在线人数「实时跳动」。
 *
 * - 初始值直接取服务端算好的确定性人数，首帧与 SSR 完全一致，不会 hydration 不匹配；
 * - 之后用 setTimeout 递归排期（间隔 2 ~ 3 秒随机），每次 ±几 人；
 * - 保底：永远不低于 LOBBY_ONLINE_MIN（300），不会出现 0 人或负数。
 */
export function useOnlineCount(initial: number): OnlineCountState {
  const [state, setState] = useState<OnlineCountState>(() => ({
    count: Math.max(LOBBY_ONLINE_MIN, Math.round(initial)),
    tick: 0,
  }));

  useEffect(() => {
    let timer = 0;
    let cancelled = false;

    function scheduleNext() {
      const delay = TICK_MIN_MS + Math.random() * (TICK_MAX_MS - TICK_MIN_MS);

      timer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        const delta = Math.round(
          DELTA_MIN + Math.random() * (DELTA_MAX - DELTA_MIN),
        );

        setState((current) => ({
          count: Math.max(LOBBY_ONLINE_MIN, current.count + delta),
          tick: current.tick + 1,
        }));

        scheduleNext();
      }, delay);
    }

    scheduleNext();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return state;
}
