import type { NextRequest } from "next/server";

import { guardTenantApi, reviewTenantDeposit } from "@/lib/tenant-console";

/**
 * PATCH /api/tenant/deposits/[id] —— 商户确认 / 驳回一笔待人工审核的充值
 *
 * Body: { "action": "approve" | "reject" }
 *
 * 为什么需要这个接口：静态码 / 银行转账的钱直接进商户自己的银行账户，
 * 系统拿不到「支付商已收款」的机器凭证，因此**永不自动上分**。
 * 回调只会把订单挂进待审队列，真正加钱只能走这里的人工确认。
 *
 * - approve = 确认到账：`pending → success`，加玩家余额 + 写充值流水，
 *   与自动上分复用同一份 settleDepositOrder（同一事务、同一口径）。
 * - reject  = 驳回：只把单据置为 failed，不动余额、不写流水。
 * - tenantId 只来自会话（guardTenantApi），别家商户的单号一律 404。
 * - 重复点击 / 两个人同时点：数据库层 CAS（status + manualReviewStatus）只让一个生效，
 *   后到的返回 409「已被处理」，绝不会加两次钱。
 */

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const action = input.action;

    if (action !== "approve" && action !== "reject") {
      return jsonError("操作只能是 approve（确认到账）或 reject（驳回）", 400);
    }

    const { id } = await context.params;
    const result = await reviewTenantDeposit({
      tenantId: gate.scope.tenantId,
      orderId: id,
      action,
    });

    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "not_awaiting_review" ||
              result.code === "already_credited" ||
              result.code === "duplicate_reference"
            ? 409
            : 400;

      return jsonError(result.message, status);
    }

    return Response.json(
      {
        success: true,
        deposit: {
          status: result.status,
          playerName: result.playerName,
          amount: result.amount,
          currency: result.currency,
          balance: result.balance ?? null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("审核商户充值失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
