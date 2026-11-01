import type { NextRequest } from "next/server";

import { generateTenantApiKey } from "@/lib/integration-keys";
import { maskApiKey } from "@/lib/integrations";
import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

type ResetKeyRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 重置商户专属 API Key。
 * POST /api/admin/tenants/[id]/reset-key
 *
 * 安全约定：新密钥明文只在这一次响应里出现，页面必须提示「仅显示一次」；
 * 数据库里存明文（与 PaymentGateway.apiKey 一致），以便「发送至邮箱」重新取用；
 * 列表 / 详情接口一律只回掩码（见 src/lib/integrations-data.ts）。
 */
export async function POST(
  request: NextRequest,
  context: ResetKeyRouteContext,
) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return jsonError("未登录或登录已过期，请重新登录", 401);
  }

  const { id } = await context.params;

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!tenant) {
      return jsonError("租户不存在", 404);
    }

    const apiKey = generateTenantApiKey();

    const updated = await prisma.tenant.update({
      where: { id },
      data: { apiKey, apiKeyUpdatedAt: new Date() },
      select: { apiKeyUpdatedAt: true },
    });

    return Response.json(
      {
        success: true,
        tenantId: tenant.id,
        tenantName: tenant.name,
        // 明文仅此一次：页面关闭提示框后无法再次查看，只能重新重置。
        apiKey,
        maskedKey: maskApiKey(apiKey),
        apiKeyUpdatedAt: updated.apiKeyUpdatedAt?.toISOString() ?? null,
        message: "新密钥仅显示一次，请立即复制并通过安全渠道发给商户",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("重置商户 API Key 失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
