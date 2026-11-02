/**
 * 玩家钱包余额的纯计算层（不 import prisma，客户端组件可以直接用）。
 *
 * 关键业务口径：提现单在 pending 阶段**不扣** Player.balance，
 * 扣款发生在代付成功回调（/api/withdrawal/callback）。
 * 所以「可用余额」必须自己算：balance - Σ(pending Withdrawal.amount)，
 * 否则玩家能在同一笔余额上连开多张 pending 提现单。
 * 服务端口径见 src/app/api/withdrawal/create/route.ts，两边必须一致。
 */

/** 金额精度：数据库 Decimal(18, 6) */
const AMOUNT_SCALE = 1e6;

function toAmount(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(number) ? number : 0;
}

export function roundAmount(value: number): number {
  return Math.round(value * AMOUNT_SCALE) / AMOUNT_SCALE;
}

/** 可用余额 = 余额 − 处理中的提现单合计，结果保留 6 位小数（不小于 0） */
export function computeAvailableBalance(
  balance: unknown,
  pendingWithdrawalAmount: unknown,
): number {
  const available = roundAmount(toAmount(balance) - toAmount(pendingWithdrawalAmount));

  return available > 0 ? available : 0;
}

/** 与 computeAvailableBalance 同口径，但返回可直接塞进 JSON / props 的字符串 */
export function availableBalanceToString(
  balance: unknown,
  pendingWithdrawalAmount: unknown,
): string {
  return computeAvailableBalance(balance, pendingWithdrawalAmount).toFixed(6);
}
