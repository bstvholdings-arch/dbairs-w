import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import {
  callbackSignatureRequired,
  verifyCallbackSignature,
} from "@/lib/payment-gateway";
import { prisma } from "@/lib/prisma";

type CallbackStatus = "success" | "failed";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readTxHash(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return "";
  }

  const txHash = value.trim();

  if (!txHash || txHash.length > 200) {
    return "";
  }

  return txHash;
}

function readReferralRewardRate() {
  try {
    const rate = new Prisma.Decimal(process.env.REFERRAL_REWARD_RATE ?? "0.05");

    if (rate.lessThanOrEqualTo(0) || rate.greaterThan(0.5)) {
      return null;
    }

    return rate;
  } catch {
    return null;
  }
}

/**
 * 支付商回调。
 * POST /api/deposit/callback
 *
 * Body: { orderId, status: "success" | "failed", txHash? }
 *
 * 安全边界：
 * 1. 生产环境默认要求 x-pay-signature = HMAC-SHA256(rawBody, gateway.apiKey)。
 * 2. 回调金额一律忽略，只使用数据库 DepositOrder.amount，防止支付商/攻击者篡改金额。
 * 3. 防重放的核心是 `updateMany({ where: { id, status: "pending" } })` 条件更新：
 *    数据库保证只有一个并发请求能把 pending 改成 success，只有抢到状态迁移的请求才加余额。
 * 4. 纯电子记账：只增加 Player.balance 并写一条 Transaction(type=deposit)，
 *    不创建、不扣减任何平台内部资金账户，也不做资金划转。
 */
export async function POST(request: NextRequest) {
  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return jsonError("读取回调请求失败", 400);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return jsonError("回调请求体不是有效 JSON", 400);
  }

  const input = (parsed ?? {}) as Record<string, unknown>;
  const orderId =
    typeof input.orderId === "string" ? input.orderId.trim() : "";
  const rawStatus =
    typeof input.status === "string"
      ? input.status.trim().toLowerCase()
      : "";

  if (!orderId) {
    return jsonError("缺少订单号 orderId", 400);
  }

  if (rawStatus !== "success" && rawStatus !== "failed") {
    return jsonError("status 只支持 success 或 failed", 400);
  }

  const status = rawStatus as CallbackStatus;
  const txHash = readTxHash(input.txHash);

  if (txHash === "") {
    return jsonError("txHash 格式不正确", 400);
  }

  if (status === "success" && !txHash) {
    return jsonError("成功回调必须提供 txHash", 400);
  }

  try {
    const order = await prisma.depositOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        playerId: true,
        amount: true,
        currency: true,
        status: true,
        gateway: { select: { name: true, apiKey: true } },
        player: {
          select: {
            referredById: true,
            referredBy: { select: { id: true, tenantId: true, status: true } },
          },
        },
      },
    });

    if (!order) {
      return jsonError("充值订单不存在", 404);
    }

    if (callbackSignatureRequired()) {
      const signature =
        request.headers.get("x-pay-signature") ??
        request.headers.get("x-gateway-signature");

      if (
        !verifyCallbackSignature(rawBody, signature, order.gateway.apiKey)
      ) {
        return jsonError("回调签名校验失败", 401);
      }
    }

    if (status === "failed") {
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.depositOrder.updateMany({
          where: { id: order.id, status: "pending" },
          data: { status: "failed", txHash },
        });

        if (claimed.count === 0) {
          const current = await tx.depositOrder.findUnique({
            where: { id: order.id },
            select: { status: true },
          });

          return {
            claimed: false,
            currentStatus: current?.status ?? "unknown",
          };
        }

        return { claimed: true, currentStatus: "failed" };
      });

      if (result.claimed) {
        return Response.json({
          success: true,
          replayed: false,
          orderId: order.id,
          status: "failed",
        });
      }

      if (result.currentStatus === "failed") {
        // 失败回调重放：状态已是 failed，不产生任何资金变动。
        return Response.json({
          success: true,
          replayed: true,
          orderId: order.id,
          status: "failed",
        });
      }

      if (result.currentStatus === "success") {
        return jsonError("订单已成功入账，不能回退为失败", 409);
      }

      return jsonError("订单状态异常，无法处理失败回调", 409);
    }

    /**
     * 成功回调的关键事务。
     *
     * 防重复入账：
     * - updateMany 带 `status: "pending"` 条件，相当于数据库层的 compare-and-swap。
     * - 第一个请求把 pending 改成 success 后 count === 1，继续加余额；
     * - 重放请求或并发请求会等待行锁，随后 count === 0，只能读取当前状态并直接返回，
     *   绝不会执行第二次 balance increment。
     *
     * 原子性：
     * - 状态迁移、余额增加、流水写入位于同一个 $transaction；
     * - 任一步失败都会整体回滚，不会出现“订单成功但余额未加”或“余额已加但无流水”。
     */
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.depositOrder.updateMany({
        where: { id: order.id, status: "pending" },
        data: { status: "success", txHash },
      });

      if (claimed.count === 0) {
        const current = await tx.depositOrder.findUnique({
          where: { id: order.id },
          select: { status: true },
        });

        return {
          credited: false,
          currentStatus: current?.status ?? "unknown",
          transactionId: null as string | null,
          balance: null as string | null,
        };
      }

      // 只加余额，不做“先读余额再写回”的更新，避免并发充值互相覆盖。
      const player = await tx.player.update({
        where: { id: order.playerId },
        data: { balance: { increment: order.amount } },
        select: { balance: true },
      });

      /**
       * 推广返佣：仅对「被邀请人的首笔成功充值」发放，防止刷返佣。
       * - 必须在写入本笔 deposit 流水之前统计历史成功充值；
       * - depositOrderId 唯一 + 事务回滚，保证回调重试不会重复返佣；
       * - 邀请人余额与返佣流水、奖励记录在同一个事务里落库。
       */
      const inviter = order.player.referredBy;
      const rewardRate = readReferralRewardRate();

      if (inviter && inviter.status === "active" && rewardRate) {
        const previousDeposits = await tx.transaction.count({
          where: {
            playerId: order.playerId,
            type: "deposit",
            status: "success",
          },
        });

        if (previousDeposits === 0) {
          const rewardAmount = order.amount
            .mul(rewardRate)
            .toDecimalPlaces(6, Prisma.Decimal.ROUND_DOWN);

          if (rewardAmount.greaterThan(0)) {
            await tx.player.update({
              where: { id: inviter.id },
              data: { balance: { increment: rewardAmount } },
            });

            await tx.transaction.create({
              data: {
                tenantId: order.tenantId,
                playerId: inviter.id,
                type: "referral",
                amount: rewardAmount,
                currency: order.currency,
                status: "success",
                txHash: `referral-${order.id}`,
              },
            });

            await tx.referralReward.create({
              data: {
                tenantId: order.tenantId,
                inviterId: inviter.id,
                referredPlayerId: order.playerId,
                depositOrderId: order.id,
                depositAmount: order.amount,
                rewardRate,
                rewardAmount,
                currency: order.currency,
              },
            });
          }
        }
      }

      const transaction = await tx.transaction.create({
        data: {
          tenantId: order.tenantId,
          playerId: order.playerId,
          type: "deposit",
          amount: order.amount,
          currency: order.currency,
          status: "success",
          txHash,
        },
        select: { id: true },
      });

      return {
        credited: true,
        currentStatus: "success",
        transactionId: transaction.id,
        balance: player.balance.toFixed(6),
      };
    });

    if (result.credited) {
      return Response.json({
        success: true,
        replayed: false,
        orderId: order.id,
        status: "success",
        transactionId: result.transactionId,
        balance: result.balance,
        gateway: order.gateway.name,
      });
    }

    if (result.currentStatus === "success") {
      // 重放攻击 / 支付商重试：订单已 success，直接幂等返回，不重复加余额。
      return Response.json({
        success: true,
        replayed: true,
        orderId: order.id,
        status: "success",
      });
    }

    if (result.currentStatus === "failed") {
      return jsonError("订单已标记失败，不能重新入账", 409);
    }

    return jsonError("订单状态异常，无法处理成功回调", 409);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        "该交易哈希已被其他充值订单使用，疑似重复回调，已拒绝入账",
        409,
      );
    }

    console.error("处理充值回调失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

