import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import {
  failDepositOrder,
  settleDepositOrder,
} from "@/lib/deposit-settlement";
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

/**
 * 支付商回调（旧版入口，按本系统订单主键回调）。
 * POST /api/deposit/callback
 *
 * Body: { orderId, status: "success" | "failed", txHash? }
 *
 * 安全边界：
 * 1. 生产环境默认要求 x-pay-signature = HMAC-SHA256(rawBody, gateway.apiKey)。
 * 2. 回调金额一律忽略，只使用数据库 DepositOrder.amount，防止支付商 / 攻击者篡改金额。
 * 3. 防重放 / 防双花 / 原子性全部委托给 src/lib/deposit-settlement.ts，
 *    与新接口 /api/deposit/callback/[gatewayCode] 共用同一份上分实现。
 *
 * 新接入的支付商请优先使用 /api/deposit/callback/[gatewayCode]：
 * 它按商户订单号（orderNo）回查、强制 x-signature 验签，并核对回调金额。
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
    typeof input.status === "string" ? input.status.trim().toLowerCase() : "";

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
        orderNo: true,
        gateway: { select: { name: true, apiKey: true } },
      },
    });

    if (!order) {
      return jsonError("充值订单不存在", 404);
    }

    if (callbackSignatureRequired()) {
      const signature =
        request.headers.get("x-pay-signature") ??
        request.headers.get("x-signature") ??
        request.headers.get("x-gateway-signature");

      if (!verifyCallbackSignature(rawBody, signature, order.gateway.apiKey)) {
        return jsonError("回调签名校验失败", 401);
      }
    }

    if (status === "failed") {
      const result = await failDepositOrder({ orderId: order.id, txHash });

      switch (result.kind) {
        case "failed":
          return Response.json({
            success: true,
            replayed: false,
            orderId: order.id,
            status: "failed",
          });
        case "already-failed":
          // 失败回调重放：状态已是 failed，不产生任何资金变动。
          return Response.json({
            success: true,
            replayed: true,
            orderId: order.id,
            status: "failed",
          });
        case "already-success":
          return jsonError("订单已成功入账，不能回退为失败", 409);
        case "not-found":
          return jsonError("充值订单不存在", 404);
        default:
          return jsonError("订单状态异常，无法处理失败回调", 409);
      }
    }

    const result = await settleDepositOrder({
      orderId: order.id,
      txHash: txHash as string,
    });

    switch (result.kind) {
      case "credited":
        return Response.json({
          success: true,
          replayed: false,
          orderId: order.id,
          orderNo: order.orderNo ?? order.id,
          status: "success",
          transactionId: result.transactionId,
          balance: result.balance,
          referralRewarded: result.referralRewarded,
          gateway: order.gateway.name,
        });
      case "already-success":
        // 重放攻击 / 支付商重试：订单已 success，直接幂等返回，不重复加余额。
        return Response.json({
          success: true,
          replayed: true,
          orderId: order.id,
          orderNo: order.orderNo ?? order.id,
          status: "success",
          transactionId: result.transactionId,
        });
      case "already-failed":
        return jsonError("订单已标记失败，不能重新入账", 409);
      case "not-found":
        return jsonError("充值订单不存在", 404);
      default:
        return jsonError("订单状态异常，无法处理成功回调", 409);
    }
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
