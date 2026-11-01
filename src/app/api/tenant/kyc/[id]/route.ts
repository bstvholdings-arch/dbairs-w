import type { NextRequest } from "next/server";

import {
  guardTenantApi,
  loadTenantKycDetail,
  reviewTenantKyc,
} from "@/lib/tenant-console";

/**
 * GET   /api/tenant/kyc/[id] —— 认证详情（完整证件号 + 两张受控图片地址）
 * PATCH /api/tenant/kyc/[id] —— 审核 { "action": "approve" | "reject", "rejectReason"?: string }
 *
 * 两个方法都用 { id, tenantId } 双条件查询：
 * 别家商户的申请 id 在这里等价于「不存在」，统一 404，不泄露任何信息。
 */

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const { id } = await context.params;
    const kyc = await loadTenantKycDetail({
      tenantId: gate.scope.tenantId,
      kycId: id,
    });

    if (!kyc) {
      return jsonError("认证申请不存在", 404);
    }

    return Response.json(
      { kyc },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取商户 KYC 详情失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
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
      return jsonError("操作只能是 approve（通过）或 reject（驳回）", 400);
    }

    const { id } = await context.params;
    const result = await reviewTenantKyc({
      tenantId: gate.scope.tenantId,
      kycId: id,
      reviewerId: gate.scope.user.id,
      action,
      rejectReason: input.rejectReason,
    });

    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "not_pending"
            ? 409
            : 400;

      return jsonError(result.message, status);
    }

    return Response.json(
      { success: true, kyc: result.kyc },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("审核商户 KYC 失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
