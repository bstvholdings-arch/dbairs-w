import type { NextRequest } from "next/server";

import { normalizeCurrency } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { normalizeRebateConfig, parseRebateConfigInput } from "@/lib/rebate-config";
import { loadTenantRebateOverview } from "@/lib/rebate-settlement";
import { guardTenantApi } from "@/lib/tenant-console";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 商户后台【洗码管理】。
 *
 * GET   /api/tenant/rebates —— 当前配置（已归一化）+ 最近结算记录
 * PATCH /api/tenant/rebates —— 保存各品类费率与开关
 *
 * 安全约定：
 * - 鉴权走 guardTenantApi，tenantId 只取会话；
 * - 配置存 `Tenant.rebateConfig`（JSON 列），读侧 fail-closed、写侧严格校验
 *   （见 src/lib/rebate-config.ts），非法输入 400 而不是静默改值；
 * - 只改**未来**的结算：RebatePayout 里已有记录的费率是结算瞬间的快照。
 */
export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const tenantId = gate.scope.tenantId;

  try {
    const [tenant, overview] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { currency: true, rebateConfig: true },
      }),
      loadTenantRebateOverview(tenantId),
    ]);

    if (!tenant) {
      return jsonError("商户不存在", 404);
    }

    return Response.json(
      {
        config: normalizeRebateConfig(tenant.rebateConfig),
        currency: normalizeCurrency(tenant.currency),
        overview,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取洗码配置失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

async function saveConfig(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const tenantId = gate.scope.tenantId;

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const parsed = parseRebateConfigInput(body);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      return jsonError("商户不存在", 404);
    }

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { rebateConfig: parsed.value },
    });

    return Response.json(
      {
        success: true,
        message: "洗码配置已保存",
        config: parsed.value,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("保存洗码配置失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function PATCH(request: NextRequest) {
  return saveConfig(request);
}

export async function PUT(request: NextRequest) {
  return saveConfig(request);
}
