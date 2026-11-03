/**
 * 玩家钱包变更的跨组件广播（余额实时刷新用）。
 *
 * 玩家充值 / 提现成功后会 `router.refresh()`，但大厅顶栏的 BALANCE 是
 * `LobbyClient` 自己 state 里的数据，Server Component 刷新不会自动改它。
 * 这里用浏览器原生事件做一层轻量总线：
 * - 充值 / 提现成功的组件调用 notifyPlayerWalletChanged(余额)；
 * - 任何展示余额的组件（大厅顶栏）订阅后**先用广播里的余额立刻重绘**，
 *   再自己重新拉 /api/player/me 以服务端账本为准。
 * 不用 Context / SWR，是为了兼容「大厅」和「玩家中心」两个独立路由树。
 *
 * 为什么广播里要带余额：只发「变了」这一个信号时，订阅方必须先等一次
 * `/api/player/me` 往返，网络慢 / 请求失败时顶栏就一直是旧数字
 * （这正是「弹窗提示已到账、Header 余额没动」的观感来源）。
 * 带上服务端刚算好的余额，顶栏可以同步刷新，接口回来再纠正。
 */

export const PLAYER_WALLET_CHANGED_EVENT = "dbairs:player-wallet-changed";

export type PlayerWalletChangedDetail = {
  /**
   * 服务端返回的权威余额 `Player.balance`（Decimal 字符串，如 "530.500000"）。
   * 订阅方拿到后可以用 availableBalanceToString(balance, pending) 自己算可用余额。
   * null / 缺省 = 只知道「钱包变了」但不知道新值，订阅方自行重新拉取。
   */
  balance?: string | null;
  /**
   * 服务端返回的权威**可用余额**（已经扣掉处理中提现）。
   * 用于提现这类「余额没变、可用余额变了」的场景 —— 它不能当成 balance 用，
   * 否则订阅方会再减一次在途提现，数字直接被扣两遍。
   */
  availableBalance?: string | null;
};

/**
 * 广播一次「玩家钱包已变更」（只能在浏览器里调用）。
 * 充值 / 提现 / 领奖接口回传了新余额时必须原样带进来。
 */
export function notifyPlayerWalletChanged(
  detail: PlayerWalletChangedDetail = {},
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PlayerWalletChangedDetail>(PLAYER_WALLET_CHANGED_EVENT, {
      detail: {
        balance: detail.balance ?? null,
        availableBalance: detail.availableBalance ?? null,
      },
    }),
  );
}

/** 订阅钱包变更，返回取消订阅函数（SSR 下返回空函数） */
export function subscribePlayerWalletChanged(
  listener: (detail: PlayerWalletChangedDetail) => void,
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  function handleEvent(event: Event) {
    const detail = (event as CustomEvent<PlayerWalletChangedDetail>).detail;

    listener(detail ?? {});
  }

  window.addEventListener(PLAYER_WALLET_CHANGED_EVENT, handleEvent);

  return () => {
    window.removeEventListener(PLAYER_WALLET_CHANGED_EVENT, handleEvent);
  };
}
