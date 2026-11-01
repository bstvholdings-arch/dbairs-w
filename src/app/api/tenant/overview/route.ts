import type { NextRequest } from "next/server";

import { guardTenantApi, loadTenantOverview } from "@/lib/tenant-console";

/**
 * GET /api/tenant/overview —— 商户数据概览（玩家 / 充值 / 提现 / GGR / 服务费）。
 * 数据范围完全由会话里的 tenantId 决定，接口不接受任何租户参数。
 */
export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const overview = await loadTenantOverview(gate.scope.tenantId);

    return Response.json(
      { overview },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取商户数据概览失败:", error);
    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 },
    );
  }
}
