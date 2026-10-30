import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";
import { listTenantProviderPoints } from "@/lib/tenant-provider-points";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 查询某个租户下所有游戏商的专属点数配置。
 * GET /api/tenants/[id]/providers
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id: tenantId } = await context.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });

    if (!tenant) {
      return jsonError("租户不存在", 404);
    }

    const providers = await listTenantProviderPoints(tenantId);

    return Response.json(
      {
        tenantId: tenant.id,
        tenantName: tenant.name,
        providers,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取租户游戏商点数失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
