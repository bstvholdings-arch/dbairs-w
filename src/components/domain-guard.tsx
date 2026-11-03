"use client";

import { useEffect } from "react";

/**
 * 多域名防封：前台自动切换线路。
 *
 * 挂在 root layout（所有页面最顶层），本身不渲染任何东西：
 *   1. 页面加载后向 `/api/domain-guard` 要「这台站点的备用线路候选」——
 *      候选顺序由服务端的 buildFailoverTargets 算好，客户端不做判断；
 *   2. 之后每 30 秒打一次 `/api/ping`（3 秒超时、不查库的极简接口）；
 *   3. **连续 2 次**失败才跳转：第一次失败先 5 秒后快速重探一次，
 *      避免一次网络抖动就把玩家甩到别的域名上；
 *   4. 跳转保留当前路径 / 查询参数 / 锚点，玩家不会掉回首页；
 *   5. 2 分钟内只允许跳一次（sessionStorage 冷却），防止两条线路互相踢球。
 *
 * 不做的事（同样重要）：
 * - `navigator.onLine === false`（玩家自己断网）不跳：换域名也打不开；
 * - 标签页在后台（`visibilityState === "hidden"`）不跳：
 *   后台标签的定时器会被浏览器节流，探测结果不可信；
 * - 没有备用线路（平台后台、站点不存在、库查不到）直接静默退出。
 *
 * 已知边界：域名在 DNS / SNI 层就被封时，页面本身根本打不开，
 * 这段脚本没有机会执行 —— 那种情况只能靠「多个域名链接同时发给客户」兜住，
 * 详见 AGENTS.md 第 8 条。
 */

const CONFIG_PATH = "/api/domain-guard";
const PING_PATH = "/api/ping";

/** 正常心跳间隔 */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** 已经失败一次后的快速重探间隔（连续失败判定用） */
const RETRY_INTERVAL_MS = 5_000;
/** 单次心跳超时时间：超过就算这一次失败 */
const PING_TIMEOUT_MS = 3_000;
/** 连续失败几次才切换线路 */
const FAILURE_THRESHOLD = 2;
/** 两次跳转之间的最小间隔，防止线路互踢 */
const REDIRECT_COOLDOWN_MS = 120_000;
/** 首探延迟：让页面先把静态资源加载完，别和首屏抢带宽 */
const FIRST_PROBE_DELAY_MS = 1_000;

const HOP_STORAGE_KEY = "dba:domain-guard:last-hop";

type DomainGuardConfig = {
  enabled?: boolean;
  host?: string;
  candidates?: unknown;
};

function readLastHopAt(): number {
  try {
    const raw = window.sessionStorage.getItem(HOP_STORAGE_KEY);
    const value = raw ? Number(raw) : 0;

    return Number.isFinite(value) ? value : 0;
  } catch {
    // 隐私模式 / 存储被禁用：当作「没跳过」，宁可多试一次也不报错
    return 0;
  }
}

function writeLastHopAt() {
  try {
    window.sessionStorage.setItem(HOP_STORAGE_KEY, String(Date.now()));
  } catch {
    // 存不进去就算了，冷却只是防抖，不是安全边界
  }
}

/** 只接受服务端给的域名串：去空白、去重、剔掉当前主机（防止自跳死循环） */
function readCandidates(raw: unknown, currentHost: string): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const candidates: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }

    const host = item.trim().toLowerCase();

    if (
      !host ||
      host === currentHost ||
      host === `www.${currentHost}` ||
      candidates.includes(host)
    ) {
      continue;
    }

    candidates.push(host);
  }

  return candidates;
}

/** 保留协议 / 路径 / 参数 / 锚点，只换主机名 */
function buildTargetUrl(host: string): string {
  const { protocol, pathname, search, hash } = window.location;

  return `${protocol}//${host}${pathname}${search}${hash}`;
}

export function DomainGuard() {
  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let timer: number | undefined;
    let candidates: string[] = [];

    function clearTimer() {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    }

    function schedule(delay: number) {
      clearTimer();

      if (stopped) {
        return;
      }

      timer = window.setTimeout(() => {
        void tick();
      }, delay);
    }

    function canProbe(): boolean {
      if (stopped) {
        return false;
      }

      // 玩家自己断网：换域名也不会通，别乱跳
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return false;
      }

      // 后台标签页的定时器会被节流，探测结果不可信
      return document.visibilityState !== "hidden";
    }

    async function pingOnce(): Promise<boolean> {
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        PING_TIMEOUT_MS,
      );

      try {
        const response = await fetch(`${PING_PATH}?t=${Date.now()}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });

        return response.ok;
      } catch {
        // 超时（abort）/ DNS 失败 / 连接被重置 —— 都算这一次失败
        return false;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    function hopTo(target: string): boolean {
      if (Date.now() - readLastHopAt() < REDIRECT_COOLDOWN_MS) {
        // 刚跳过又出问题：多半是两条线路都不稳，先别再来回甩
        return false;
      }

      writeLastHopAt();
      // replace：不要把打不开的域名留在浏览器历史里，玩家点返回不该又回到死站
      window.location.replace(buildTargetUrl(target));

      return true;
    }

    async function tick() {
      timer = undefined;

      if (!canProbe()) {
        schedule(HEARTBEAT_INTERVAL_MS);
        return;
      }

      const alive = await pingOnce();

      if (stopped) {
        return;
      }

      failures = alive ? 0 : failures + 1;

      if (failures >= FAILURE_THRESHOLD) {
        const [target] = candidates;

        if (target && hopTo(target)) {
          return;
        }
      }

      schedule(failures > 0 ? RETRY_INTERVAL_MS : HEARTBEAT_INTERVAL_MS);
    }

    async function bootstrap() {
      try {
        const response = await fetch(CONFIG_PATH, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!response.ok) {
          return;
        }

        const config = (await response.json()) as DomainGuardConfig | null;

        if (stopped || !config?.enabled) {
          return;
        }

        candidates = readCandidates(
          config.candidates,
          window.location.hostname.toLowerCase(),
        );

        if (candidates.length === 0) {
          return;
        }

        schedule(FIRST_PROBE_DELAY_MS);
      } catch {
        // 平台后台 / 站点不存在 / 网络抖动：没有备用线路就安静退出
      }
    }

    function handleWakeUp() {
      if (stopped || document.visibilityState === "hidden") {
        return;
      }

      // 切回前台后旧的失败计数已经过时：清零并立刻重探一次
      failures = 0;
      schedule(FIRST_PROBE_DELAY_MS);
    }

    document.addEventListener("visibilitychange", handleWakeUp);
    window.addEventListener("online", handleWakeUp);
    void bootstrap();

    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleWakeUp);
      window.removeEventListener("online", handleWakeUp);
    };
  }, []);

  return null;
}
