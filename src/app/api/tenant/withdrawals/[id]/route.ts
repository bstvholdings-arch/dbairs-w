import type { NextRequest } from "next/server";

import { guardTenantApi, reviewTenantWithdrawal } from "@/lib/tenant-console";

/**
 * PATCH /api/tenant/withdrawals/[id] —— 商户审批提现
 *
 * Body: { "action": "approve" | "reject", "txHash"?: string }
 *
 * - approve = 已出款：与代付商回调同口径（pending → success，扣玩家余额 + 写出金流水），
 *   两步在同一个事务里，绝不允许「扣了钱没记账」。
 * - reject  = 驳回：只把单据置为 failed，不动余额、不写流水。
 * - tenantId 只来自会话（guardTenantApi）；别家商户的单号在这里等价于「不存在」，
 *   统一 404，不泄露任何信息。
 * - 重复点击 / 回调与人工审批同时到达时，靠数据库层 CAS 只让一个请求生效，
 *   后到的返回 409「已处理完成」。
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
      return jsonError("操作只能是 approve（通过出款）或 reject（驳回）", 400);
    }

    const reference = input.txHash;

    if (
      reference !== undefined &&
      reference !== null &&
      typeof reference !== "string"
    ) {
      return jsonError("txHash 必须是字符串", 400);
    }

    if (typeof reference === "string" && reference.trim().length > 200) {
      return jsonError("txHash 不能超过 200 个字符", 400);
    }

    const { id } = await context.params;
    const result = await reviewTenantWithdrawal({
      tenantId: gate.scope.tenantId,
      withdrawalId: id,
      action,
      reference: typeof reference === "string" ? reference : undefined,
    });

    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "not_pending" ||
              result.code === "insufficient_balance" ||
              result.code === "duplicate_reference"
            ? 409
            : 400;

      return jsonError(result.message, status);
    }

    return Response.json(
      {
        success: true,
        withdrawal: {
          status: result.status,
          playerName: result.playerName,
          amount: result.amount,
          currency: result.currency,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("审批商户提现失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
