import type { NextRequest } from "next/server";

import {
  callbackSignatureRequired,
  verifyCallbackSignature,
} from "@/lib/payment-gateway";
import { prisma } from "@/lib/prisma";
import {
  markWithdrawalFailed,
  settleWithdrawalSuccess,
} from "@/lib/withdrawal-settlement";
import {
  WITHDRAWAL_STATUS_FAILED,
  WITHDRAWAL_STATUS_PENDING,
  WITHDRAWAL_STATUS_PROCESSING,
  WITHDRAWAL_STATUS_SUCCESS,
} from "@/lib/withdrawal-status";

type CallbackStatus = "success" | "failed";

/** 回调可以结算的状态：人工待审（pending）与自动出款在途（processing） */
const CALLBACK_SETTLE_STATUSES = [
  WITHDRAWAL_STATUS_PENDING,
  WITHDRAWAL_STATUS_PROCESSING,
] as const;

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

/**
 * 代付商回调。
 * POST /api/withdrawal/callback
 *
 * Body: { withdrawalId, status: "success" | "failed", txHash? }
 *
 * 纯电子记账（结算实现见 src/lib/withdrawal-settlement.ts，与商户人工审批、
 * 自动出款引擎共用同一份代码，三条路径记账口径完全一致）：
 * - success：条件更新 `pending|processing -> success`，扣减 Player.balance，
 *   写一条 Transaction(type=withdraw)；三步同一事务，不会只扣钱不记账。
 *   `processing` 也必须能结算 —— 自动出款把单子置成 processing 后才去代付，
 *   异步回调回来时状态已经不是 pending 了。
 * - failed：只改提现单状态，不动余额、不写流水。
 * - 不扣减/不增加任何平台内部资金账户。
 *
 * 防重复扣款：settleWithdrawalSuccess 里的 `updateMany({ where: { status: { in } } })`
 * 是数据库层 compare-and-swap，只有抢到状态迁移的请求才会扣余额。
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
  const withdrawalId =
    typeof input.withdrawalId === "string" ? input.withdrawalId.trim() : "";
  const rawStatus =
    typeof input.status === "string"
      ? input.status.trim().toLowerCase()
      : "";

  if (!withdrawalId) {
    return jsonError("缺少提现单号 withdrawalId", 400);
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
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      select: {
        id: true,
        tenantId: true,
        playerId: true,
        amount: true,
        currency: true,
        status: true,
        gateway: { select: { name: true, apiKey: true } },
      },
    });

    if (!withdrawal) {
      return jsonError("提现单不存在", 404);
    }

    if (callbackSignatureRequired()) {
      const signature =
        request.headers.get("x-pay-signature") ??
        request.headers.get("x-gateway-signature");

      if (
        !withdrawal.gateway ||
        !verifyCallbackSignature(
          rawBody,
          signature,
          withdrawal.gateway.apiKey,
        )
      ) {
        return jsonError("回调签名校验失败", 401);
      }
    }

    if (!withdrawal.playerId) {
      return jsonError("提现单未绑定玩家，无法扣减余额", 409);
    }

    if (status === "failed") {
      const failed = await markWithdrawalFailed({
        withdrawalId: withdrawal.id,
        fromStatuses: CALLBACK_SETTLE_STATUSES,
        txHash,
      });

      if (failed.changed) {
        return Response.json({
          success: true,
          replayed: false,
          withdrawalId: withdrawal.id,
          status: "failed",
        });
      }

      if (failed.currentStatus === WITHDRAWAL_STATUS_FAILED) {
        return Response.json({
          success: true,
          replayed: true,
          withdrawalId: withdrawal.id,
          status: "failed",
        });
      }

      if (failed.currentStatus === WITHDRAWAL_STATUS_SUCCESS) {
        return jsonError("提现单已成功出款，不能回退为失败", 409);
      }

      return jsonError("提现单状态异常，无法处理失败回调", 409);
    }

    const result = await settleWithdrawalSuccess({
      withdrawalId: withdrawal.id,
      fromStatuses: CALLBACK_SETTLE_STATUSES,
      txHash,
    });

    if (result.settled) {
      if (result.replay) {
        return Response.json({
          success: true,
          replayed: true,
          withdrawalId: withdrawal.id,
          status: "success",
        });
      }

      return Response.json({
        success: true,
        replayed: false,
        withdrawalId: withdrawal.id,
        status: "success",
        transactionId: result.transactionId,
        balance: result.balance,
        gateway: withdrawal.gateway?.name ?? null,
      });
    }

    if (result.reason === "insufficient_balance") {
      return jsonError("玩家余额不足，提现单保持待处理", 409);
    }

    if (result.reason === "duplicate_reference") {
      return jsonError("该交易哈希已被其他提现单使用，已拒绝重复扣款", 409);
    }

    if (result.reason === "not_found") {
      return jsonError("提现单不存在", 404);
    }

    if (result.currentStatus === WITHDRAWAL_STATUS_FAILED) {
      return jsonError("提现单已标记失败，不能重新扣款", 409);
    }

    return jsonError("提现单状态异常，无法处理成功回调", 409);
  } catch (error) {
    console.error("处理代付回调失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

