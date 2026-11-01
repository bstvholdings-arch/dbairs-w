import type { NextRequest } from "next/server";

import { guardTenantApi, searchTenantPlayers } from "@/lib/tenant-console";

/**
 * GET /api/tenant/players?q=&status=&page=&pageSize=
 *
 * 玩家列表 / 搜索。q 支持账号、邮箱、玩家 ID；
 * tenantId 永远取自会话，前端传什么都不会影响数据归属。
 */
export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const { searchParams } = request.nextUrl;
    const page = await searchTenantPlayers({
      tenantId: gate.scope.tenantId,
      q: searchParams.get("q"),
      status: searchParams.get("status"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    });

    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("读取商户玩家列表失败:", error);
    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 },
    );
  }
}
