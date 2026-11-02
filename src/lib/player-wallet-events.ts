/**
 * 玩家钱包变更的跨组件广播（余额实时刷新用）。
 *
 * 玩家充值 / 提现成功后会 `router.refresh()`，但大厅顶栏的 BALANCE 是
 * `LobbyClient` 自己 state 里的数据，Server Component 刷新不会自动改它。
 * 这里用浏览器原生事件做一层轻量总线：
 * - 充值 / 提现成功的组件调用 notifyPlayerWalletChanged()；
 * - 任何展示余额的组件（大厅顶栏）订阅后自己重新拉 /api/player/me。
 * 不用 Context / SWR，是为了兼容「大厅」和「玩家中心」两个独立路由树。
 */

export const PLAYER_WALLET_CHANGED_EVENT = "dbairs:player-wallet-changed";

/** 广播一次「玩家钱包已变更」（只能在浏览器里调用） */
export function notifyPlayerWalletChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(PLAYER_WALLET_CHANGED_EVENT));
}

/** 订阅钱包变更，返回取消订阅函数（SSR 下返回空函数） */
export function subscribePlayerWalletChanged(listener: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(PLAYER_WALLET_CHANGED_EVENT, listener);

  return () => {
    window.removeEventListener(PLAYER_WALLET_CHANGED_EVENT, listener);
  };
}
