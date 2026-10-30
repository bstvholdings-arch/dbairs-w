import { connection, type NextRequest } from "next/server";

import { loadTenantPaymentGateways } from "@/lib/tenant-payment-gateways";
import { getSessionUserFromRequest } from "@/lib/session";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 租户查看可用网关与售价。
 * GET /api/tenant/gateways/available
 *
 * 返回：
 * - platformGateways：平台提供、已通过且配置完整的网关，仅含售价；
 * - ownGateways：当前租户提交的自有网关及审核状态。
 */
export async function GET(request: NextRequest) {
  await connection();

  try {
    const session = await getSessionUserFromRequest(request);

    if (!session) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    if (session.role !== "tenant_admin" || !session.tenantId) {
      return jsonError("仅租户管理员可查看支付网关", 403);
    }

    const data = await loadTenantPaymentGateways(session.tenantId);

    return Response.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("获取租户支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
