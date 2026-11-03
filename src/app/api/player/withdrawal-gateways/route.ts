import { connection, type NextRequest } from "next/server";

import { withdrawalAmountLimitLabels } from "@/lib/payment-gateway";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";
import {
  isFiatPayoutChannel,
  normalizePayoutCurrency,
} from "@/lib/withdrawal-channels";

/**
 * 玩家提现弹窗的通道列表（纯法币 MYR → MYR，不做任何汇率换算）。
 * GET /api/player/withdrawal-gateways
 *
 * 过滤条件：
 * 1. isActive + APPROVED + （平台公用 或 本租户）；
 * 2. **纯法币**：providerType 不能是加密代付（usdt_* 等），且通道币种必须等于
 *    本站记账币种（Tenant.currency，通常 MYR）。跨币种出款等于要汇率换算，
 *    本流程不做，所以 USDT / TRC20 通道不会出现在这里（提单接口会再拦一次）。
 *
 * feeRate 取网关的 payoutSellRate（代付费率，0.01 = 1%），前端据此展示
 * 「预估手续费」；费率由后台按通道维护，前端不写死任何数字。
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

  const payoutCurrency = normalizePayoutCurrency(session.tenant.currency);

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

    // 通道只有个位数，在内存里过滤：币种别名（RM → MYR）只需要一份实现
    const gateways = rows
      .filter((gateway) => isFiatPayoutChannel(gateway, payoutCurrency))
      .map((gateway) => ({
        id: gateway.id,
        name: gateway.name,
        providerType: gateway.providerType,
        // 统一按本站记账币种下发：脏数据里的 "RM" 也归一化成 MYR
        currency: payoutCurrency,
        // Decimal(8,6) 直接转字符串：前端只用它展示百分比与估算手续费，不参与金额计算。
        feeRate: gateway.payoutSellRate.toFixed(6),
      }));

    return Response.json(
      {
        success: true,
        /** 本站记账货币 = 出款币种：前端所有金额（含手续费 / 到账）都用它渲染 */
        payoutCurrency,
        gateways,
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
