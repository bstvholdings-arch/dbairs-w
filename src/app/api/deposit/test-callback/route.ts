import { NextRequest } from "next/server";

import { POST as handleDepositCallback } from "@/app/api/deposit/callback/route";
import {
  createCallbackSignature,
  depositTestCallbackAllowed,
} from "@/lib/payment-gateway";
import { prisma } from "@/lib/prisma";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { getSessionUserFromRequest } from "@/lib/session";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * “我已完成支付”联调按钮。
 * POST /api/deposit/test-callback  Body: { orderId }
 *
 * 安全边界：
 * 1. 仅非生产环境开放，或显式设置 DEPOSIT_ALLOW_TEST_CALLBACK=true；
 * 2. 必须携带玩家 Cookie（player_token）或租户管理员 / 超管登录 Cookie；
 * 3. 玩家只能模拟自己的订单；租户管理员只能模拟自己租户的订单；
 * 4. 复用正式回调处理器，保证状态机与防重复入账逻辑完全一致。
 */
export async function POST(request: NextRequest) {
  try {
    if (!depositTestCallbackAllowed()) {
      return jsonError("生产环境已禁用测试回调", 403);
    }

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
        gateway: { select: { apiKey: true } },
      },
    });

    if (!order) {
      return jsonError("充值订单不存在", 404);
    }

    if (player && order.playerId !== player.id) {
      return jsonError("无权操作其他玩家的充值订单", 403);
    }

    if (
      session?.role === "tenant_admin" &&
      session.tenantId !== order.tenantId
    ) {
      return jsonError("无权操作其他租户的充值订单", 403);
    }

    if (order.status !== "pending") {
      return jsonError(`订单当前状态为 ${order.status}，无需重复回调`, 409);
    }

    const rawBody = JSON.stringify({
      orderId: order.id,
      status: "success",
      txHash: `test-${Date.now()}-${order.id}`,
    });
    const signature = createCallbackSignature(rawBody, order.gateway.apiKey);

    const callbackRequest = new NextRequest(
      new URL("/api/deposit/callback", request.url),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pay-signature": signature,
        },
        body: rawBody,
      },
    );

    return handleDepositCallback(callbackRequest);
  } catch (error) {
    console.error("模拟充值回调失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}