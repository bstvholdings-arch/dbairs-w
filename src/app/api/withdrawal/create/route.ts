import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { parseWithdrawalAmount } from "@/lib/payment-gateway";
import { resolvePaymentPlayerIdentity } from "@/lib/payment-player";
import { KYC_REQUIRED_CODE, KYC_REQUIRED_MESSAGE } from "@/lib/kyc";
import { prisma } from "@/lib/prisma";

function jsonError(message: string, status: number, code?: string) {
  return Response.json(
    code ? { error: message, code } : { error: message },
    { status },
  );
}

/**
 * 玩家发起提现申请。
 * POST /api/withdrawal/create
 *
 * Body: { gatewayId, accountId, amount, walletAddress?, playerId? }
 *
 * 收款账号二选一：
 * - accountId（推荐）：玩家在「安全设置 - 提现账号」绑定的账号，服务端自己取真实收款信息；
 *   列表接口只把银行账号掩码返回给前端，所以真实账号不能由前端回传（防篡改 / 防泄露）；
 * - walletAddress：兼容旧调用方，直接传链上地址或人工整理的收款描述。
 *
 * 纯电子记账：
 * - 这里只创建 pending 提现单，不扣 Player.balance，也不写流水；
 * - 代付商成功回调 /api/withdrawal/callback 后才扣余额并写 Transaction；
 * - 不创建、不扣减任何平台内部资金账户；
 * - 因为 pending 不冻结资金，这里用「余额 - 处理中的提现单」做可用余额校验，
 *   避免同一笔余额被连开多张 pending 单重复提走（超额提单）。
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

    const accountId =
      typeof input.accountId === "string" ? input.accountId.trim() : "";

    const requestedWalletAddress =
      typeof input.walletAddress === "string"
        ? input.walletAddress.trim()
        : "";

    if (!accountId && !requestedWalletAddress) {
      return jsonError("请选择提现账号", 400);
    }

    if (requestedWalletAddress.length > 200) {
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

    // 收款账号：优先用玩家绑定的账号，服务端自己拼出真实收款信息。
    const account = accountId
      ? await prisma.playerWithdrawalAccount.findFirst({
          where: {
            id: accountId,
            playerId: player.id,
            tenantId: player.tenantId,
          },
          select: {
            id: true,
            currency: true,
            network: true,
            accountType: true,
            walletAddress: true,
            bankName: true,
            accountNumber: true,
            accountName: true,
          },
        })
      : null;

    if (accountId && !account) {
      return jsonError("未找到该提现账号", 404, "account_not_found");
    }

    let walletAddress = requestedWalletAddress;

    if (account) {
      const destination =
        account.accountType === "bank"
          ? [account.bankName, account.accountNumber, account.accountName]
              .map((part) => part?.trim() ?? "")
              .filter((part) => part.length > 0)
              .join(" · ")
          : (account.walletAddress ?? "").trim();

      if (!destination) {
        return jsonError(
          "该提现账号缺少收款信息，请重新绑定",
          400,
          "account_incomplete",
        );
      }

      walletAddress = destination.slice(0, 200);
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

    // 账号币种必须与通道币种一致，否则会出现「USDT 通道把钱打到 MYR 银行卡」的错付。
    if (account && account.currency !== gateway.currency) {
      return jsonError(
        `该提现账号币种（${account.currency}）与通道币种（${gateway.currency}）不一致`,
        400,
        "account_currency_mismatch",
      );
    }

    // 可用余额 = 余额 - 处理中的提现单。pending 阶段不扣钱，所以必须在这里挡住超额提单。
    const pendingAggregate = await prisma.withdrawal.aggregate({
      where: {
        playerId: player.id,
        tenantId: player.tenantId,
        status: "pending",
      },
      _sum: { amount: true },
    });
    const pendingAmount = pendingAggregate._sum.amount ?? new Prisma.Decimal(0);
    const availableBalance = player.balance.minus(pendingAmount);

    if (availableBalance.lt(amount)) {
      return jsonError(
        pendingAmount.greaterThan(0)
          ? `可用余额不足（已有 ${pendingAmount.toFixed(2)} ${gateway.currency} 提现申请处理中）`
          : "玩家余额不足",
        409,
        "insufficient_available_balance",
      );
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
        // pending 阶段还没有扣余额，扣款发生在代付成功回调里。
        balanceDeducted: false,
        // 提交后还能提多少（已扣除处理中的申请），前端用来刷新「可用余额」。
        availableBalance: availableBalance.minus(amount).toFixed(6),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("创建提现申请失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
