import type { NextRequest } from "next/server";

import {
  maskIntegrationSecret,
  readApiSecret,
  readIntegrationUrl,
  readMerchantId,
} from "@/lib/integrations";
import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

type ProviderRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * 修改游戏商对接凭据（Game Providers 页签的【编辑】）。
 * PATCH /api/admin/integrations/providers/[id]
 *
 * body: { apiEndpoint?, merchantId?, apiSecret? }
 *
 * 权限：仅 super_admin。这里不复用 /api/providers/[id] —— 那条路由属于
 * `providers` 权限点（tech 角色也能调），而签名密钥 / 商户号属于最高敏感配置。
 *
 * apiSecret 的语义：字段缺省或空串 = 保持原密钥不变（前端永远拿不到明文，
 * 自然也没法回填）；只有确实传了新密钥才会覆盖。
 */
export async function PATCH(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return jsonError("未登录或登录已过期，请重新登录", 401);
  }

  const { id } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("请求体格式错误", 400);
  }

  const input = (body ?? {}) as Record<string, unknown>;

  const existing = await prisma.gameProvider.findUnique({
    where: { id },
    select: { id: true, apiSecret: true },
  });

  if (!existing) {
    return jsonError("游戏商不存在", 404);
  }

  const data: {
    apiEndpoint?: string | null;
    merchantId?: string | null;
    apiSecret?: string;
  } = {};

  if (hasOwn(input, "apiEndpoint")) {
    const apiEndpoint = readIntegrationUrl(input.apiEndpoint);

    if (apiEndpoint === null) {
      return jsonError("API Endpoint 必须是 http:// 或 https:// 开头的完整地址", 400);
    }

    // 空串 = 清空配置，不存空字符串，避免页签里出现「已配置但实际是空」的错觉。
    data.apiEndpoint = apiEndpoint || null;
  }

  if (hasOwn(input, "merchantId")) {
    const merchantId = readMerchantId(input.merchantId);

    if (merchantId === null) {
      return jsonError(
        "Merchant ID 只能是 1 ~ 64 位字母、数字、点、下划线或短横线",
        400,
      );
    }

    data.merchantId = merchantId || null;
  }

  if (hasOwn(input, "apiSecret")) {
    const apiSecret = readApiSecret(input.apiSecret);

    if (apiSecret === null) {
      return jsonError(
        "Secret 不能包含空白字符，且长度不能超过 200 个字符",
        400,
      );
    }

    // 空串表示「不修改」：前端只回传掩码后的占位符时不会误清空真实密钥。
    if (apiSecret) {
      data.apiSecret = apiSecret;
    }
  }

  if (Object.keys(data).length === 0) {
    return jsonError("没有可更新的字段", 400);
  }

  try {
    const provider = await prisma.gameProvider.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        status: true,
        isActive: true,
        apiEndpoint: true,
        merchantId: true,
        apiSecret: true,
      },
    });

    return Response.json({
      success: true,
      provider: {
        id: provider.id,
        name: provider.name,
        apiEndpoint: provider.apiEndpoint ?? "",
        merchantId: provider.merchantId ?? "",
        maskedSecret: maskIntegrationSecret(provider.apiSecret),
        hasSecret: Boolean(provider.apiSecret),
        status: provider.status,
        isActive: provider.isActive,
      },
    });
  } catch (error) {
    console.error("更新游戏商对接凭据失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
