import type { NextRequest } from "next/server";

import { recordManualDepositCallback } from "@/lib/deposit-settlement";
import { gatewayRequiresManualReview } from "@/lib/payment-gateway-constants";
import { prisma } from "@/lib/prisma";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { getSessionUserFromRequest } from "@/lib/session";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 玩家点击「我已付款」。
 * POST /api/deposit/claim-paid  Body: { orderId }
 *
 * 为什么必须有这个接口：静态码 / 银行转账**没有支付商回调**（钱直接进商户的
 * 银行账户），如果只靠回调，订单永远进不了人工审核队列 —— 商户在后台看不到，
 * 玩家就会来投诉「我付了钱你们不给加」。这里只做「打标记」，不动任何金额：
 *
 * 1. 只能标记自己的订单（玩家 Cookie）；商户管理员可标记自己租户的订单；
 * 2. 只对 `gatewayRequiresManualReview()` 的通道生效 —— 自动上分通道
 *    如果允许玩家自己「点一下就到账」，那等于给玩家一个免费加钱按钮；
 * 3. 复用 recordManualDepositCallback：`status` 仍是 pending，只把订单挂进
 *    /tenant/deposits 的待审队列（重复点 / 重复回调都只入队一次）；
 * 4. 真正的上分只能由商户核对银行流水后点【确认到账】，这条路永远不给钱。
 */
export async function POST(request: NextRequest) {
  try {
    const player = await getPlayerSessionFromRequest(request);
    const session = player ? null : await getSessionUserFromRequest(request);

    if (!player && !session) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const orderId =
      typeof input.orderId === "string" ? input.orderId.trim() : "";

    if (!orderId) {
      return jsonError("缺少订单号 orderId", 400);
    }

    const order = await prisma.depositOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        playerId: true,
        status: true,
        manualReviewStatus: true,
        gateway: { select: { gatewayType: true } },
      },
    });

    if (!order) {
      return jsonError("充值订单不存在", 404);
    }

    if (player && order.playerId !== player.id) {
      return jsonError("无权操作其他玩家的充值订单", 403);
    }

    if (session && session.role === "tenant_admin" && session.tenantId !== order.tenantId) {
      return jsonError("无权操作其他租户的充值订单", 403);
    }

    // 自动上分通道不允许玩家自己把订单标成「已付款」：那等于绕开支付商。
    if (!gatewayRequiresManualReview(order.gateway.gatewayType)) {
      return jsonError(
        "该通道由支付商自动确认到账，无需手动标记",
        400,
      );
    }

    if (order.status === "success") {
      return Response.json({
        success: true,
        manualReview: false,
        replayed: true,
        status: "success",
      });
    }

    if (order.status === "failed") {
      return jsonError("订单已关闭，请重新下单", 409);
    }

    const recorded = await recordManualDepositCallback({
      orderId: order.id,
      amount: null,
      txHash: null,
    });

    switch (recorded.kind) {
      case "awaiting-review":
      case "already-awaiting":
        return Response.json({
          success: true,
          // 已进入商户待审队列，但钱还没上分（等人工核对银行流水）。
          manualReview: true,
          replayed: recorded.kind === "already-awaiting",
          status: "pending",
        });
      case "already-success":
        return Response.json({
          success: true,
          manualReview: false,
          replayed: true,
          status: "success",
        });
      case "already-failed":
        return jsonError("订单已关闭，请重新下单", 409);
      default:
        return jsonError("充值订单不存在", 404);
    }
  } catch (error) {
    console.error("玩家标记已付款失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
