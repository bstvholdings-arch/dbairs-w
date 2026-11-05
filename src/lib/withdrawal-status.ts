/**
 * 提现单状态与「在途金额」的唯一口径（纯常量，不 import prisma / next，客户端也能用）。
 *
 * 为什么必须集中一份：提现单在 pending / processing 阶段**都不扣**
 * Player.balance（真正扣款发生在出款成功的那个事务里），所以
 * 「可用余额 = 余额 − 在途提现合计」里的「在途」必须同时包含这两个状态。
 * 漏掉 processing 的话，玩家可以在一笔自动出款还没回来的时候再提一次同一笔钱
 * （历史上只有 pending，加了自动出款之后这就是一个新的重复提现口子）。
 *
 * 服务端聚合、玩家中心、AI 工具、平台大盘都从这里取，禁止各写一份字符串数组。
 */

/** 人工待审核（等待商户 Approve / Reject） */
export const WITHDRAWAL_STATUS_PENDING = "pending";
/** 自动出款中（已提交给商户的代付 API，还没拿到最终结果） */
export const WITHDRAWAL_STATUS_PROCESSING = "processing";
/** 已出款（余额已扣、流水已记） */
export const WITHDRAWAL_STATUS_SUCCESS = "success";
/** 已驳回 / 出款失败（不动余额） */
export const WITHDRAWAL_STATUS_FAILED = "failed";

/**
 * 在途状态：钱还没真正扣走，但已经占住额度。
 * 可用余额校验、玩家中心展示、熔断额度都必须按这个集合算。
 */
export const IN_FLIGHT_WITHDRAWAL_STATUSES = [
  WITHDRAWAL_STATUS_PENDING,
  WITHDRAWAL_STATUS_PROCESSING,
] as const;

export type InFlightWithdrawalStatus =
  (typeof IN_FLIGHT_WITHDRAWAL_STATUSES)[number];

/** 是否在途（pending / processing）；未知状态一律按不在途处理 */
export function isInFlightWithdrawalStatus(status: string): boolean {
  return (IN_FLIGHT_WITHDRAWAL_STATUSES as readonly string[]).includes(status);
}

/** Prisma where 用的 in 数组；`as const` 的只读元组不能直接传给 in */
export function inFlightWithdrawalStatusList(): string[] {
  return [...IN_FLIGHT_WITHDRAWAL_STATUSES];
}
