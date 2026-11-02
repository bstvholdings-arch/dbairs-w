import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import {
  failDepositOrder,
  settleDepositOrder,
} from "@/lib/deposit-settlement";
import {
  gatewayCallbackSignatureRequired,
  verifyCallbackSignature,
} from "@/lib/payment-gateway";
import { prisma } from "@/lib/prisma";

type GatewayCallbackContext = {
  params: Promise<{ gatewayCode: string }>;
};

type CallbackStatus = "success" | "failed";

/** 回调 body 上限：正常回调几百字节，64KB 足够并挡掉明显的垃圾请求。 */
const MAX_BODY_BYTES = 64 * 1024;

const gatewaySelect = {
  id: true,
  name: true,
  providerType: true,
  apiKey: true,
  isActive: true,
} satisfies Prisma.PaymentGatewaySelect;

type CallbackGateway = Prisma.PaymentGatewayGetPayload<{
  select: typeof gatewaySelect;
}>;

const SUCCESS_STATUSES = new Set([
  "success",
  "succeeded",
  "paid",
  "pay_success",
  "completed",
  "confirmed",
  "settled",
  "ok",
  "done",
]);

const FAILED_STATUSES = new Set([
  "failed",
  "fail",
  "failure",
  "canceled",
  "cancelled",
  "expired",
  "error",
  "rejected",
  "closed",
]);

const ORDER_NO_KEYS = [
  "orderNo",
  "order_no",
  "merchantOrderNo",
  "merchant_order_no",
  "out_trade_no",
  "outTradeNo",
  "merchantOrderId",
  "orderId",
  "order_id",
] as const;

const STATUS_KEYS = ["status", "tradeStatus", "trade_status", "state", "result"] as const;

const TX_HASH_KEYS = [
  "txHash",
  "tx_hash",
  "transactionId",
  "transaction_id",
  "tradeNo",
  "trade_no",
  "txId",
  "txid",
  "hash",
] as const;

const AMOUNT_KEYS = [
  "amount",
  "payAmount",
  "pay_amount",
  "total",
  "totalAmount",
  "total_amount",
  "money",
] as const;

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, {
    status,
  });
}

/**
 * 支付商字段名各家用得五花八门（camelCase / snake_case / 数字），
 * 这里按优先级取第一个非空值，统一转成字符串。
 */
function readField(
  input: Record<string, unknown>,
  keys: readonly string[],
  maxLength: number,
) {
  for (const key of keys) {
    const value = input[key];

    if (typeof value === "string") {
      const text = value.trim();

      if (text) {
        return text.slice(0, maxLength);
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value).slice(0, maxLength);
    }
  }

  return "";
}

function resolveCallbackStatus(raw: string): CallbackStatus | null {
  const value = raw.trim().toLowerCase();

  if (SUCCESS_STATUSES.has(value)) {
    return "success";
  }

  if (FAILED_STATUSES.has(value)) {
    return "failed";
  }

  return null;
}

/** 回调金额：允许带千分位逗号 / 币种前缀，统一收敛成最多 6 位小数的 Decimal。 */
function parseCallbackAmount(input: Record<string, unknown>) {
  const raw = readField(input, AMOUNT_KEYS, 40);

  if (!raw) {
    return null;
  }

  const text = raw
    .replace(/[,\s]/g, "")
    .replace(/(?:USDT|USD|MYR|EUR|AUD|RM|\$)/gi, "");

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) {
    return null;
  }

  try {
    const amount = new Prisma.Decimal(text);

    // 注意：decimal.js 的 isPositive() 对 0 返回 true，必须用 greaterThan(0)。
    return amount.greaterThan(0) ? amount : null;
  } catch {
    return null;
  }
}

function codeMatchesGateway(code: string, gateway: CallbackGateway) {
  const value = code.trim().toLowerCase();

  return (
    code.trim() === gateway.id ||
    value === gateway.providerType.trim().toLowerCase() ||
    value === gateway.name.trim().toLowerCase()
  );
}

/**
 * 解析路径里的 gatewayCode。
 *
 * 兼容三种写法，方便不同支付商按自己的习惯配置回调地址：
 * 1. 网关主键 id（最精确，推荐）；
 * 2. providerType，例如 /api/deposit/callback/usdt_trc20；
 * 3. 网关名称，例如 /api/deposit/callback/Bank%20Transfer。
 *
 * 若同一 providerType / 名称命中多个网关且密钥不同，必须让支付商在 body 里带
 * gatewayId，否则无法确定用哪个密钥验签 —— 这种情况直接拒绝，绝不猜。
 */
async function resolveCallbackGateway(code: string, requestedGatewayId: string) {
  if (requestedGatewayId) {
    const gateway = await prisma.paymentGateway.findUnique({
      where: { id: requestedGatewayId },
      select: gatewaySelect,
    });

    if (!gateway) {
      return { kind: "not-found" as const };
    }

    if (!codeMatchesGateway(code, gateway)) {
      return { kind: "mismatch" as const };
    }

    return { kind: "ok" as const, gateway };
  }

  const byId = await prisma.paymentGateway.findUnique({
    where: { id: code.trim() },
    select: gatewaySelect,
  });

  if (byId) {
    return { kind: "ok" as const, gateway: byId };
  }

  const candidates = await prisma.paymentGateway.findMany({
    where: {
      OR: [
        { providerType: code.trim().toLowerCase() },
        { name: { equals: code.trim(), mode: "insensitive" } },
      ],
    },
    select: gatewaySelect,
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    take: 5,
  });

  if (candidates.length === 0) {
    return { kind: "not-found" as const };
  }

  if (new Set(candidates.map((item) => item.apiKey)).size > 1) {
    return { kind: "ambiguous" as const };
  }

  return { kind: "ok" as const, gateway: candidates[0] };
}

/**
 * 支付商支付结果回调（真实支付网关主入口）。
 * POST /api/deposit/callback/[gatewayCode]
 *
 * Body 约定（字段名兼容 camelCase / snake_case，见文件顶部 KEYS 常量）：
 * { orderNo, status: "success" | "failed", amount, txHash }
 *
 * 三条安全防线：
 * 1. 验签：Header x-signature（兼容 x-pay-signature / x-gateway-signature）
 *    = hex(HMAC-SHA256(rawBody, gateway.apiKey))，密钥即支付商后台的 API_SECRET。
 *    默认所有环境强制校验，签名不对直接 401，且不写任何数据。
 * 2. 防重放：按 orderNo 回查订单，已是 success 直接返回 replayed:true，绝不重复加钱；
 *    订单不是 pending（失败的终态）一律 409。
 * 3. 金额核对：回调 amount 必须与数据库订单金额完全一致（Decimal 比较），
 *    不一致时打 [ALARM] 结构化日志（供日志告警规则抓取）并拒绝入账。
 *
 * 上分事务见 src/lib/deposit-settlement.ts。
 */
export async function POST(
  request: NextRequest,
  context: GatewayCallbackContext,
) {
  const { gatewayCode } = await context.params;

  // ① 必须基于「原始字符串」验签：先 JSON.parse 再序列化会丢失字段顺序与空白，
  //    真实支付商的签名就会永远对不上。
  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return jsonError("读取回调请求失败", 400);
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonError("回调请求体过大", 413);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return jsonError("回调请求体不是有效 JSON", 400);
  }

  const input = (parsed ?? {}) as Record<string, unknown>;

  try {
    // ② 定位网关：验签密钥、订单归属都依赖它，找不到就 404。
    const requestedGatewayId = readField(input, ["gatewayId", "gateway_id"], 64);
    const resolved = await resolveCallbackGateway(
      gatewayCode,
      requestedGatewayId,
    );

    if (resolved.kind === "not-found") {
      return jsonError("支付网关不存在", 404, "gateway_not_found");
    }

    if (resolved.kind === "mismatch") {
      return jsonError("回调网关与请求的 gatewayId 不一致", 403, "gateway_mismatch");
    }

    if (resolved.kind === "ambiguous") {
      return jsonError(
        "该网关标识对应多个支付网关，请在回调 body 中提供 gatewayId",
        409,
        "ambiguous_gateway",
      );
    }

    const gateway = resolved.gateway;

    // 停用的网关仍要允许回调：历史订单必须能正常结算，只记一条告警日志。
    if (!gateway.isActive) {
      console.warn("[WARN][deposit-callback] 回调来自已停用网关", {
        gateway: gateway.name,
        gatewayCode,
      });
    }

    if (!gateway.apiKey) {
      console.error("[ALARM][deposit-callback] 网关缺少 API_SECRET", {
        gateway: gateway.name,
        gatewayCode,
      });

      return jsonError(
        "支付网关未配置回调密钥，拒绝入账",
        409,
        "gateway_secret_missing",
      );
    }

    // ③ 安全防线一：验签
    if (gatewayCallbackSignatureRequired()) {
      const signature =
        request.headers.get("x-signature") ??
        request.headers.get("x-pay-signature") ??
        request.headers.get("x-gateway-signature") ??
        readField(input, ["signature", "sign"], 512);

      if (!signature) {
        return jsonError("缺少回调签名 x-signature", 401, "signature_missing");
      }

      if (!verifyCallbackSignature(rawBody, signature, gateway.apiKey)) {
        console.error("[ALARM][deposit-callback] 回调签名校验失败", {
          gateway: gateway.name,
          gatewayCode,
          hasSignature: true,
          ip:
            request.headers.get("x-forwarded-for") ??
            request.headers.get("x-real-ip") ??
            "unknown",
        });

        return jsonError("回调签名校验失败", 401, "signature_invalid");
      }
    }

    // ④ 解析业务字段
    const orderNo = readField(input, ORDER_NO_KEYS, 80);

    if (!orderNo) {
      return jsonError("缺少订单号 orderNo", 400, "missing_order_no");
    }

    const status = resolveCallbackStatus(readField(input, STATUS_KEYS, 32));

    if (!status) {
      return jsonError("不支持的回调状态 status", 400, "invalid_status");
    }

    const txHash = readField(input, TX_HASH_KEYS, 200);

    // ⑤ 按商户订单号回查；历史订单没有 orderNo，回退用主键 id。
    const order = await prisma.depositOrder.findFirst({
      where: { OR: [{ orderNo }, { id: orderNo }] },
      select: {
        id: true,
        orderNo: true,
        gatewayId: true,
        amount: true,
        currency: true,
        status: true,
      },
    });

    if (!order) {
      return jsonError("充值订单不存在", 404, "order_not_found");
    }

    // 订单必须属于本网关：否则 A 网关的签名可以结算 B 网关的订单。
    if (order.gatewayId !== gateway.id) {
      console.error("[ALARM][deposit-callback] 回调网关与订单网关不一致", {
        orderNo,
        orderGatewayId: order.gatewayId,
        callbackGatewayId: gateway.id,
      });

      return jsonError("订单不属于该支付网关", 403, "order_gateway_mismatch");
    }

    if (status === "failed") {
      const result = await failDepositOrder({
        orderId: order.id,
        txHash: txHash || null,
      });

      switch (result.kind) {
        case "failed":
          return Response.json({
            success: true,
            replayed: false,
            orderNo: order.orderNo ?? order.id,
            status: "failed",
          });
        case "already-failed":
          return Response.json({
            success: true,
            replayed: true,
            orderNo: order.orderNo ?? order.id,
            status: "failed",
          });
        case "already-success":
          return jsonError(
            "订单已成功入账，不能回退为失败",
            409,
            "already_success",
          );
        case "not-found":
          return jsonError("充值订单不存在", 404, "order_not_found");
        default:
          return jsonError(
            "订单状态异常，无法处理失败回调",
            409,
            "order_not_pending",
          );
      }
    }

    // ⑥ 安全防线二：防重放。已入账的订单只回一个 200，绝不再加钱。
    if (order.status === "success") {
      return Response.json({
        success: true,
        replayed: true,
        orderNo: order.orderNo ?? order.id,
        status: "success",
      });
    }

    if (order.status === "failed") {
      return jsonError(
        "订单已标记失败，不能重新入账",
        409,
        "already_failed",
      );
    }

    if (order.status !== "pending") {
      return jsonError(
        `订单当前状态为 ${order.status}，无法入账`,
        409,
        "order_not_pending",
      );
    }

    // ⑦ 安全防线三：金额核对。金额一律以数据库订单为准，回调金额只用来比对。
    const callbackAmount = parseCallbackAmount(input);

    if (!callbackAmount) {
      return jsonError(
        "回调缺少有效金额 amount",
        400,
        "missing_amount",
      );
    }

    if (!callbackAmount.equals(order.amount)) {
      console.error("[ALARM][deposit-callback] 回调金额与订单金额不一致", {
        orderNo: order.orderNo ?? order.id,
        orderAmount: order.amount.toFixed(6),
        callbackAmount: callbackAmount.toFixed(6),
        currency: order.currency,
        gateway: gateway.name,
      });

      return jsonError(
        "回调金额与订单金额不一致，已拒绝入账",
        400,
        "amount_mismatch",
      );
    }

    if (!txHash) {
      return jsonError(
        "成功回调必须提供交易号 txHash",
        400,
        "missing_tx_hash",
      );
    }

    // ⑧ 原子上分：状态 pending→success + 余额 + 流水（见 deposit-settlement.ts）
    const result = await settleDepositOrder({
      orderId: order.id,
      txHash,
    });

    switch (result.kind) {
      case "credited":
        return Response.json({
          success: true,
          replayed: false,
          orderNo: order.orderNo ?? order.id,
          status: "success",
          transactionId: result.transactionId,
          balance: result.balance,
          referralRewarded: result.referralRewarded,
        });
      case "already-success":
        return Response.json({
          success: true,
          replayed: true,
          orderNo: order.orderNo ?? order.id,
          status: "success",
          transactionId: result.transactionId,
        });
      case "already-failed":
        return jsonError(
          "订单已标记失败，不能重新入账",
          409,
          "already_failed",
        );
      case "not-found":
        return jsonError("充值订单不存在", 404, "order_not_found");
      default:
        return jsonError(
          "订单状态异常，无法处理成功回调",
          409,
          "order_not_pending",
        );
    }
  } catch (error) {
    // DepositOrder @@unique([gatewayId, txHash])：同一笔第三方交易号想入账到
    // 第二个订单（典型的重放 / 撞库），数据库直接拒绝。
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      console.error("[ALARM][deposit-callback] 交易号重复使用", {
        gatewayCode,
        error: error.message,
      });

      return jsonError(
        "该交易号已被其他充值订单使用，疑似重复回调，已拒绝入账",
        409,
        "duplicate_tx_hash",
      );
    }

    console.error("处理支付网关回调失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
