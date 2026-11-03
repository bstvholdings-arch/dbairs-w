import type { NextRequest } from "next/server";

import {
  guardTenantApi,
  loadTenantSiteSettings,
  saveTenantSiteSettings,
} from "@/lib/tenant-console";

/**
 * GET   /api/tenant/settings —— 当前商户的站点设置（皮肤 + 大厅模块开关）
 * PATCH /api/tenant/settings —— 保存皮肤 / 模块开关 / 备用域名池
 *
 * 只能改自己的租户：where 固定使用会话里的 tenantId，
 * 请求体里的 tenantId / id 一律忽略（不存在「改别人站」的入口）。
 *
 * 写白名单里**没有** logoUrl（品牌 Logo）与 themeBackground（主题背景色）：
 * 这两项都是平台配置项，只能由超管在【租户管理 → 新建 / 编辑租户】里写。
 * 商户构造请求带上它们也会被忽略（见 lib/tenant-console.ts 的
 * saveTenantSiteSettings），否则等于给商户开了一个「换掉自己 Logo」的后门。
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
    // 注意：这里**故意不转发** input.logoUrl 与 input.themeBackground。
    // 品牌 Logo / 主题背景色都是平台配置项，唯一写入口是超管的
    // PUT /api/tenants/[id]；商户请求里带上也当没看见。
    const result = await saveTenantSiteSettings({
      tenantId: gate.scope.tenantId,
      themeColor: input.themeColor,
      layout: input.layout,
      // 多域名防封：备用域名池（数组或逗号 / 换行分隔的文本，[] = 清空）
      backupDomains: input.backupDomains,
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
