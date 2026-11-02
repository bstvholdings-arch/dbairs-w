import { connection, type NextRequest } from "next/server";

import { guardTenantApi } from "@/lib/tenant-console";
import { loadTenantPaymentGateways } from "@/lib/tenant-payment-gateways";

/**
 * 商户查看自己的支付网关配置。
 * GET /api/tenant/gateways/available
 *
 * 鉴权统一走 guardTenantApi（未登录 401 / 非商户账号 403），
 * tenantId 只从会话取，别家商户的通道永远查不到。
 *
 * 去中心化支付架构下平台不再下发统一收款网关，返回体只有：
 * - ownGateways：当前商户自行对接的通道（含已停用的，便于重新启用 / 编辑）。
 */
export async function GET(request: NextRequest) {
  await connection();

  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const data = await loadTenantPaymentGateways(gate.scope.tenantId);

    return Response.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("获取租户支付网关失败:", error);
    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
