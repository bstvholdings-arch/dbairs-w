import type { NextRequest } from "next/server";

import {
  buildIntegrationUrl,
  integrationEndpointPath,
  readContactEmail,
} from "@/lib/integrations";
import { appBaseUrl, sendTenantApiKeyEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

type SendKeyRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 把商户专属密钥与回调地址发到对接邮箱。
 * POST /api/admin/tenants/[id]/send-key
 *
 * body: { email?: string }
 *   - 不传 / 传空串：发给 Tenant.contactEmail
 *   - 传了其它邮箱：仅本次投递到该地址，不会写回数据库
 *     （要改默认收件人请走 PATCH /api/admin/tenants/[id] 的 contactEmail）
 *
 * 发信失败不返回 5xx：与「开通邮件」保持一致，返回 200 + emailSent=false，
 * 由页面提示超管改用其它渠道转达，不会因为邮件服务抖动导致操作看起来「失败」。
 */
export async function POST(request: NextRequest, context: SendKeyRouteContext) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return jsonError("未登录或登录已过期，请重新登录", 401);
  }

  const { id } = await context.params;

  let body: unknown = {};

  try {
    body = await request.json();
  } catch {
    // 允许空 body（curl -X POST），按「发到对接邮箱」处理。
    body = {};
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const requestedEmail = readContactEmail(input.email);

  if (requestedEmail === null) {
    return jsonError("收件邮箱格式不正确", 400);
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        contactEmail: true,
        apiKey: true,
        apiCallbackUrl: true,
      },
    });

    if (!tenant) {
      return jsonError("租户不存在", 404);
    }

    const email = requestedEmail || tenant.contactEmail || "";

    if (!email) {
      return jsonError(
        "该商户还没有对接邮箱，请先点「编辑」填写后再发送",
        400,
      );
    }

    if (!tenant.apiKey) {
      return jsonError("该商户还没有 API Key，请先点「重置密钥」生成", 400);
    }

    const whitelist = await prisma.integrationIpWhitelist.findMany({
      orderBy: { createdAt: "asc" },
      select: { ip: true },
      take: 200,
    });

    const baseUrl = appBaseUrl();

    const result = await sendTenantApiKeyEmail({
      tenantName: tenant.name,
      email,
      apiKey: tenant.apiKey,
      depositUrl: buildIntegrationUrl(
        baseUrl,
        integrationEndpointPath("deposit"),
      ),
      withdrawalUrl: buildIntegrationUrl(
        baseUrl,
        integrationEndpointPath("withdrawal"),
      ),
      callbackUrl: tenant.apiCallbackUrl ?? undefined,
      ipWhitelist: whitelist.map((row) => row.ip),
    });

    return Response.json(
      {
        success: true,
        email,
        emailSent: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("发送商户 API 密钥邮件失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
