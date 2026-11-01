import type { NextRequest } from "next/server";

import { guardTenantApi, loadTenantKycPage } from "@/lib/tenant-console";

/**
 * GET /api/tenant/kyc?status=&q=&page=&pageSize=
 *
 * 商户实名认证审核列表。tenantId 只来自会话，status/q/page 只影响筛选条件，
 * 因此改参数也无法读到别家商户的申请。
 */
export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const { searchParams } = request.nextUrl;
    const data = await loadTenantKycPage({
      tenantId: gate.scope.tenantId,
      status: searchParams.get("status"),
      q: searchParams.get("q"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    });

    return Response.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("读取商户 KYC 列表失败:", error);

    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 },
    );
  }
}
