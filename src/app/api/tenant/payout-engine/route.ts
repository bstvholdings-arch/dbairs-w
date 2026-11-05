import type { NextRequest } from "next/server";

import {
  isUsablePayoutEndpoint,
  loadTenantPayoutEngine,
  parseAutoPayoutConfigInput,
  saveTenantAutoPayoutConfig,
  saveTenantPayoutEndpoints,
} from "@/lib/auto-payout";
import { guardTenantApi } from "@/lib/tenant-console";

/**
 * 商户后台【自动出款引擎】配置接口。
 *
 * GET   /api/tenant/payout-engine
 *   → { config, dailyAutoPaidAmount, dailyRemaining, breakerTripped, gateways[] … }
 *
 * PATCH /api/tenant/payout-engine
 *   Body: {
 *     isEnabled?: boolean,
 *     maxAutoAmount?: number,
 *     dailyAutoLimit?: number,
 *     payoutEndpoints?: [{ gatewayId, endpoint }]   // endpoint 传空串 = 清除
 *   }
 *
 * 权限口径（不可回退）：
 * - tenantId 只来自 guardTenantApi 的会话，前端传什么都不算数；
 * - 代付地址只能写「商户自己的通道」（ownerId = 本站、isPlatformGateway=false）：
 *   平台通道禁止配置代付，资金不经过平台（AGENTS.md 第 1 条）；
 * - 关掉自动出款 / 限额非法时不报错，而是直接拒绝保存，避免「以为开了其实没生效」。
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
    const snapshot = await loadTenantPayoutEngine(gate.scope.tenantId);

    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("读取自动出款引擎配置失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function PATCH(request: NextRequest) {
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

    const input = (body ?? {}) as Record<string, unknown>;
    const current = await loadTenantPayoutEngine(tenantId);
    const parsed = parseAutoPayoutConfigInput({
      ...input,
      current: current.config,
    });

    if (!parsed.ok) {
      return jsonError(parsed.message, 400);
    }

    // 代付地址：数组可选；每一条都必须是合法 http(s) 地址（空串表示清除）。
    const rawEndpoints = input.payoutEndpoints;
    const entries: { gatewayId: string; endpoint: string }[] = [];

    if (rawEndpoints !== undefined) {
      if (!Array.isArray(rawEndpoints)) {
        return jsonError("payoutEndpoints 必须是数组", 400);
      }

      for (const item of rawEndpoints) {
        if (!item || typeof item !== "object") {
          return jsonError("payoutEndpoints 的每一项必须是对象", 400);
        }

        const record = item as Record<string, unknown>;
        const gatewayId =
          typeof record.gatewayId === "string" ? record.gatewayId.trim() : "";
        const endpoint =
          typeof record.endpoint === "string" ? record.endpoint.trim() : "";

        if (!gatewayId) {
          return jsonError("payoutEndpoints 缺少 gatewayId", 400);
        }

        if (endpoint && !isUsablePayoutEndpoint(endpoint)) {
          return jsonError(
            "代付 API 地址必须是有效的 http(s) 链接（例如 https://api.example.com/payout）",
            400,
          );
        }

        entries.push({ gatewayId, endpoint });
      }
    }

    if (entries.length > 0) {
      const saved = await saveTenantPayoutEndpoints({ tenantId, entries });

      if (saved === "not_found") {
        return jsonError("代付通道不存在或不属于当前商户", 404);
      }
    }

    await saveTenantAutoPayoutConfig({ tenantId, config: parsed.config });

    const snapshot = await loadTenantPayoutEngine(tenantId);

    return Response.json(
      { success: true, ...snapshot },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("保存自动出款引擎配置失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
