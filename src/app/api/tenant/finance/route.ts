import type { NextRequest } from "next/server";

import { guardTenantApi, loadTenantFinance } from "@/lib/tenant-console";

/**
 * GET /api/tenant/finance?kind=deposit|withdraw&page=&pageSize=
 *
 * 商户财务流水（只读）。入金 / 出金都按 tenantId 过滤，
 * 不提供任何写接口：审批出金属于平台财务权限，商户后台只能查看。
 */
export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const { searchParams } = request.nextUrl;
    const finance = await loadTenantFinance({
      tenantId: gate.scope.tenantId,
      kind: searchParams.get("kind"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    });

    return Response.json(finance, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("读取商户财务流水失败:", error);
    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 },
    );
  }
}
