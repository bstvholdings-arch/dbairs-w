import { connection, type NextRequest } from "next/server";

import { loadTenantPaymentGateways } from "@/lib/tenant-payment-gateways";
import { getSessionUserFromRequest } from "@/lib/session";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 商户查看自己的支付网关配置。
 * GET /api/tenant/gateways/available
 *
 * 去中心化支付架构下平台不再下发统一收款网关，返回体只有：
 * - ownGateways：当前商户自行对接的通道（含已停用的，便于重新启用 / 编辑）。
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
