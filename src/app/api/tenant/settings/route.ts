import type { NextRequest } from "next/server";

import {
  guardTenantApi,
  loadTenantSiteSettings,
  saveTenantSiteSettings,
} from "@/lib/tenant-console";

/**
 * GET   /api/tenant/settings —— 当前商户的站点设置（皮肤 + 大厅模块开关）
 * PATCH /api/tenant/settings —— 保存皮肤 / 模块开关 / 品牌 Logo
 *
 * 只能改自己的租户：where 固定使用会话里的 tenantId，
 * 请求体里的 tenantId / id 一律忽略（不存在「改别人站」的入口）。
 */

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const settings = await loadTenantSiteSettings(gate.scope.tenantId);

    if (!settings) {
      return jsonError("站点不存在或已被停用", 404);
    }

    return Response.json(
      { settings },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取商户站点设置失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const result = await saveTenantSiteSettings({
      tenantId: gate.scope.tenantId,
      themeColor: input.themeColor,
      layout: input.layout,
      // 玩家大厅顶栏的白标 Logo：空字符串 = 清空，前台退回商户名首字母占位
      logoUrl: input.logoUrl,
    });

    if (!result.ok) {
      return jsonError(result.error, 400);
    }

    return Response.json(
      { success: true, settings: result.settings },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("保存商户站点设置失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
