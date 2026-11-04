import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { loadBonusTurnoverLock } from "@/lib/bonus-campaigns";
import { parseWithdrawalAmount } from "@/lib/payment-gateway";
import { resolvePaymentPlayerIdentity } from "@/lib/payment-player";
import { KYC_REQUIRED_CODE, KYC_REQUIRED_MESSAGE } from "@/lib/kyc";
import { prisma } from "@/lib/prisma";
import {
  isFiatPayoutChannel,
  normalizePayoutCurrency,
} from "@/lib/withdrawal-channels";

function jsonError(message: string, status: number, code?: string) {
  return Response.json(
    code ? { error: message, code } : { error: message },
    { status },
  );
}

/**
 * 玩家发起提现申请（纯法币 MYR → MYR，不做汇率换算）。
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
        tenant: {
          select: { withdrawalRequiredApprovals: true, currency: true },
        },
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

    // 红利流水闸门（防套利）：只要还有一条 PENDING 的红利领取记录（流水没打满），
    // 一律禁止提现。这个闸门挂在领取记录上，所以活动停用 / 删除都绕不过它；
    // pending 提现不冻结资金，因此必须在提单前拦住，等打完流水再来。
    const bonusLock = await loadBonusTurnoverLock({
      tenantId: player.tenantId,
      playerId: player.id,
      currency: normalizePayoutCurrency(player.tenant.currency),
    });

    if (bonusLock.pendingCount > 0) {
      return jsonError(
        `红利流水未打满：还需有效流水 ${bonusLock.outstanding} ${bonusLock.currency}，打满后即可提现`,
        403,
        "bonus_turnover_locked",
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
        providerType: true,
        currency: true,
      },
    });

    if (!gateway) {
      return jsonError("代付网关不存在、未启用或不属于当前租户", 404);
    }

    // 纯法币提现：只允许「本站记账币种 + 非加密」的通道。
    // 加密通道 / 跨币种通道等于要按汇率折算，本流程不做，一律拒绝。
    const payoutCurrency = normalizePayoutCurrency(player.tenant.currency);

    if (!isFiatPayoutChannel(gateway, payoutCurrency)) {
      return jsonError(
        `该通道不支持 ${payoutCurrency} 法币提现，请重新选择提现通道`,
        400,
        "channel_not_fiat",
      );
    }

    // 账号币种必须与出款币种一致，否则会出现「MYR 通道把钱打到 USDT 钱包」的错付。
    if (
      account &&
      normalizePayoutCurrency(account.currency) !== payoutCurrency
    ) {
      return jsonError(
        `该提现账号币种（${account.currency}）与出款币种（${payoutCurrency}）不一致`,
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
          ? `可用余额不足（已有 ${pendingAmount.toFixed(2)} ${payoutCurrency} 提现申请处理中）`
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
        // 落库统一用本站记账币种（MYR）：脏数据里的网关币种 "RM" 不能进流水，
        // 否则回调扣款与对账会出现同一笔钱两种币种代码。
        currency: payoutCurrency,
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
