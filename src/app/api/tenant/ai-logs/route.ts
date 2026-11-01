import type { NextRequest } from "next/server";

import { guardTenantApi, loadTenantAiLogs } from "@/lib/tenant-console";

/**
 * GET /api/tenant/ai-logs?q=&playerId=&page=&pageSize=
 *
 * 商户 AI 客服监控（只读）：只看自己站内玩家与 AI 客服（agentType=support）的对话。
 * 平台侧的销冠 AI / 技术 / 财务助手日志 tenantId 为空，永远不会出现在这里。
 */
export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const { searchParams } = request.nextUrl;
    const logs = await loadTenantAiLogs({
      tenantId: gate.scope.tenantId,
      q: searchParams.get("q"),
      playerId: searchParams.get("playerId"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    });

    return Response.json(logs, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("读取商户 AI 客服记录失败:", error);
    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 },
    );
  }
}
