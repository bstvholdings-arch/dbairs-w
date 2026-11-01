import type { NextRequest } from "next/server";

import {
  guardTenantApi,
  isTenantPlayerStatus,
  loadTenantPlayerDetail,
  setTenantPlayerStatus,
} from "@/lib/tenant-console";

/**
 * GET /api/tenant/players/[id] —— 玩家详情（含最近流水与 AI 客服记录）。
 * PATCH /api/tenant/players/[id] —— 封号 / 解封：{ "status": "banned" | "active" }
 *
 * 两个方法都用 { id, tenantId } 双条件查询：
 * 别的商户的玩家 id 在这里等价于「不存在」，统一 404，不泄露任何信息。
 */

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const { id } = await context.params;
    const player = await loadTenantPlayerDetail({
      tenantId: gate.scope.tenantId,
      playerId: id,
    });

    if (!player) {
      return jsonError("玩家不存在", 404);
    }

    return Response.json(
      { player },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取商户玩家详情失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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

    if (!isTenantPlayerStatus(input.status)) {
      return jsonError("状态只能是 active（正常）或 banned（封禁）", 400);
    }

    const { id } = await context.params;
    const player = await setTenantPlayerStatus({
      tenantId: gate.scope.tenantId,
      playerId: id,
      status: input.status,
    });

    if (!player) {
      return jsonError("玩家不存在", 404);
    }

    return Response.json(
      { success: true, player },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("更新商户玩家状态失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
