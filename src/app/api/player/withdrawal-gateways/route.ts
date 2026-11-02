import { connection, type NextRequest } from "next/server";

import { withdrawalAmountLimitLabels } from "@/lib/payment-gateway";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";

/**
 * 玩家提现弹窗的通道列表。
 * GET /api/player/withdrawal-gateways
 *
 * 过滤条件与 POST /api/withdrawal/create 完全一致（isActive + APPROVED + 平台公用或本租户），
 * 保证「弹窗里能选的通道」与「提单时服务端认可的通道」是同一份集合，
 * 不会出现前端能选、提交就 404 的情况。
 *
 * feeRate 取网关的 payoutSellRate（代付售价），前端据此展示「预估手续费」；
 * 真实出款金额与手续费由财务在代付回调时结算，这里只做展示。
 */
export async function GET(request: NextRequest) {
  await connection();

  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return Response.json(
      { error: "未登录或登录已过期", code: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const rows = await prisma.paymentGateway.findMany({
      where: {
        isActive: true,
        reviewStatus: "APPROVED",
        OR: [{ ownerId: null }, { ownerId: session.tenantId }],
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        providerType: true,
        currency: true,
        payoutSellRate: true,
      },
    });

    return Response.json(
      {
        success: true,
        gateways: rows.map((gateway) => ({
          id: gateway.id,
          name: gateway.name,
          providerType: gateway.providerType,
          currency: gateway.currency,
          // Decimal(8,6) 直接转字符串：前端只用它展示百分比与估算手续费，不参与金额计算。
          feeRate: gateway.payoutSellRate.toFixed(6),
        })),
        amountLimits: withdrawalAmountLimitLabels(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取玩家提现通道失败:", error);
    return Response.json(
      { error: "读取提现通道失败，请稍后重试", code: "gateway_read_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
