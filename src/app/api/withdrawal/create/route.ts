import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { parseWithdrawalAmount } from "@/lib/payment-gateway";
import { resolvePaymentPlayerIdentity } from "@/lib/payment-player";
import { KYC_REQUIRED_CODE, KYC_REQUIRED_MESSAGE } from "@/lib/kyc";
import { prisma } from "@/lib/prisma";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 玩家发起提现申请。
 * POST /api/withdrawal/create
 *
 * Body: { gatewayId, amount, walletAddress, playerId? }
 *
 * 纯电子记账：
 * - 这里只创建 pending 提现单，不扣 Player.balance，也不写流水；
 * - 代付商成功回调 /api/withdrawal/callback 后才扣余额并写 Transaction；
 * - 不创建、不扣减任何平台内部资金账户。
 *
 * 实名认证（KYC）前置校验：
 * - 必须存在 status=APPROVED 的 PlayerKyc 记录，否则直接 403 + code=kyc_required；
 * - 校验放在余额判断之前，未实名的账号连余额信息都拿不到。
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const identity = await resolvePaymentPlayerIdentity(
      request,
      input,
      "WITHDRAWAL_ALLOW_PLAYER_ID",
    );

    if (!identity) {
      return jsonError("缺少有效的玩家身份", 401);
    }

    const gatewayId =
      typeof input.gatewayId === "string" ? input.gatewayId.trim() : "";

    if (!gatewayId) {
      return jsonError("请选择代付网关", 400);
    }

    const walletAddress =
      typeof input.walletAddress === "string"
        ? input.walletAddress.trim()
        : "";

    if (!walletAddress) {
      return jsonError("请填写提现钱包地址", 400);
    }

    if (walletAddress.length > 200) {
      return jsonError("提现钱包地址不能超过 200 个字符", 400);
    }

    let amount: Prisma.Decimal;

    try {
      amount = parseWithdrawalAmount(input.amount);
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "提现金额格式不正确",
        400,
      );
    }

    const player = await prisma.player.findUnique({
      where: { id: identity.playerId },
      select: {
        id: true,
        tenantId: true,
        balance: true,
        status: true,
        tenant: { select: { withdrawalRequiredApprovals: true } },
      },
    });

    if (!player) {
      return jsonError("玩家不存在", 404);
    }

    if (identity.tenantId && player.tenantId !== identity.tenantId) {
      return jsonError("无权操作其他租户的玩家", 403);
    }

    if (player.status !== "active") {
      return jsonError("玩家账号当前不可提现", 409);
    }

    // 实名认证闸门：没有 APPROVED 记录直接 403，提示语由 code 在前端本地化。
    const kyc = await prisma.playerKyc.findFirst({
      where: {
        playerId: player.id,
        tenantId: player.tenantId,
        status: "APPROVED",
      },
      select: { id: true },
    });

    if (!kyc) {
      return Response.json(
        { error: KYC_REQUIRED_MESSAGE, code: KYC_REQUIRED_CODE },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (player.balance.lt(amount)) {
      return jsonError("玩家余额不足", 409);
    }

    const gateway = await prisma.paymentGateway.findFirst({
      where: {
        id: gatewayId,
        isActive: true,
        reviewStatus: "APPROVED",
        OR: [{ ownerId: null }, { ownerId: player.tenantId }],
      },
      select: {
        id: true,
        name: true,
        currency: true,
      },
    });

    if (!gateway) {
      return jsonError("代付网关不存在、未启用或不属于当前租户", 404);
    }

    const withdrawal = await prisma.withdrawal.create({
      data: {
        tenantId: player.tenantId,
        playerId: player.id,
        gatewayId: gateway.id,
        amount,
        currency: gateway.currency,
        walletAddress,
        status: "pending",
        approvals: 0,
        requiredApprovals: player.tenant.withdrawalRequiredApprovals,
      },
      select: {
        id: true,
        tenantId: true,
        playerId: true,
        gatewayId: true,
        amount: true,
        currency: true,
        status: true,
        walletAddress: true,
        requiredApprovals: true,
        createdAt: true,
      },
    });

    return Response.json(
      {
        success: true,
        withdrawal: {
          id: withdrawal.id,
          tenantId: withdrawal.tenantId,
          playerId: withdrawal.playerId,
          gatewayId: withdrawal.gatewayId,
          gatewayName: gateway.name,
          amount: withdrawal.amount.toFixed(6),
          currency: withdrawal.currency,
          status: withdrawal.status,
          walletAddress: withdrawal.walletAddress,
          requiredApprovals: withdrawal.requiredApprovals,
          createdAt: withdrawal.createdAt.toISOString(),
        },
        // 明确告知调用方：pending 阶段还没有扣余额。
        balanceDeducted: false,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("创建提现申请失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
