import type { NextRequest } from "next/server";

import { validateGatewayConfiguration } from "@/lib/payment-gateway";
import { normalizeGatewayBankDetails } from "@/lib/payment-gateway-bank";
import { prisma } from "@/lib/prisma";
import { guardTenantApi } from "@/lib/tenant-console";
import {
  parseTenantGatewayInput,
  tenantGatewayWriteData,
} from "@/lib/tenant-gateway-input";
import {
  serializeTenantOwnGateway,
  tenantGatewaySelect,
} from "@/lib/tenant-payment-gateways";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 商户自有支付网关的二次配置（去中心化支付架构）。
 *
 * PUT    /api/tenant/gateways/[id]  —— 修改全部配置：API Endpoint、收款钱包地址、API Secret 等
 * PATCH  /api/tenant/gateways/[id]  —— 启停：{ "isActive": boolean }
 * DELETE /api/tenant/gateways/[id]  —— 删除（已有充值订单的网关只能停用）
 *
 * 安全约定：
 * - 鉴权统一走 guardTenantApi（未登录 401 / 非商户账号 403 / 支持超管代登录）；
 * - 三个方法都用 { id, ownerId } 双条件查询，别家商户的网关 id
 *   在这里等价于「不存在」，统一 404，不泄露任何信息；
 * - 平台公用网关（isPlatformGateway=true / ownerId=null）商户永远改不动。
 */
async function resolveOwnGateway(tenantId: string, id: string) {
  return prisma.paymentGateway.findFirst({
    where: { id, ownerId: tenantId, isPlatformGateway: false },
    select: tenantGatewaySelect,
  });
}

async function readBody(request: NextRequest) {
  try {
    return { ok: true as const, body: (await request.json()) as unknown };
  } catch {
    return { ok: false as const };
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const tenantId = gate.scope.tenantId;

  const { id } = await context.params;

  try {
    const existing = await resolveOwnGateway(tenantId, id);

    if (!existing) {
      return jsonError("支付网关不存在", 404);
    }

    const parsedBody = await readBody(request);

    if (!parsedBody.ok) {
      return jsonError("请求体格式错误", 400);
    }

    // 商户不回传密钥时沿用旧密钥：既保证「不修改」语义，
    // 也让跳转支付 / 动态二维码的完整性校验仍然通过。
    //
    // 通道费率同理：tenantGatewayWriteData 是「整对象覆盖」，漏传 feeRate
    // 就等于把商户配好的对账费率清零（老缓存前端 / 运维脚本只改 Endpoint 时最危险），
    // 所以缺省该字段时一律沿用库里的旧值。
    const body = (parsedBody.body ?? {}) as Record<string, unknown>;
    const gatewayInput =
      body && typeof body === "object" && "feeRate" in body
        ? body
        : { ...body, feeRate: existing.feeRate.toFixed(4) };
    const parsed = parseTenantGatewayInput(gatewayInput, existing.apiKey);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const value = parsed.value;
    const duplicate = await prisma.paymentGateway.findFirst({
      where: {
        name: { equals: value.name, mode: "insensitive" },
        ownerId: tenantId,
        id: { not: existing.id },
      },
      select: { id: true },
    });

    if (duplicate) {
      return jsonError("当前商户下已存在同名支付网关", 409);
    }

    const gateway = await prisma.paymentGateway.update({
      where: { id: existing.id },
      data: {
        ...tenantGatewayWriteData(value),
        // 商户自查配置，编辑后保持「已生效」，无需平台重新审核。
        reviewStatus: "APPROVED",
        reviewedAt: existing.reviewedAt ?? new Date(),
      },
      select: tenantGatewaySelect,
    });

    return Response.json(
      {
        success: true,
        message: "支付网关已更新",
        gateway: serializeTenantOwnGateway(gateway),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("更新租户支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const tenantId = gate.scope.tenantId;

  const { id } = await context.params;

  try {
    const existing = await resolveOwnGateway(tenantId, id);

    if (!existing) {
      return jsonError("支付网关不存在", 404);
    }

    const parsedBody = await readBody(request);

    if (!parsedBody.ok) {
      return jsonError("请求体格式错误", 400);
    }

    const input = (parsedBody.body ?? {}) as Record<string, unknown>;

    if (typeof input.isActive !== "boolean") {
      return jsonError("缺少有效的 isActive 参数", 400);
    }

    // 启用前再跑一次完整性校验：避免商户把配置不完整的通道开启后，
    // 玩家点充值却只看到「暂无可用通道」。
    if (input.isActive) {
      const configurationError = validateGatewayConfiguration({
        providerType: existing.providerType,
        gatewayType: existing.gatewayType,
        currency: existing.currency,
        walletAddress: existing.walletAddress?.trim() ?? "",
        qrCodeImageUrl: existing.qrCodeImageUrl?.trim() ?? "",
        endpoint: existing.endpoint?.trim() ?? "",
        apiKey: existing.apiKey,
        bankDetails: normalizeGatewayBankDetails(existing.bankDetails),
      });

      if (configurationError) {
        return jsonError(`配置不完整，无法启用：${configurationError}`, 400);
      }
    }

    const gateway = await prisma.paymentGateway.update({
      where: { id: existing.id },
      data: { isActive: input.isActive },
      select: tenantGatewaySelect,
    });

    return Response.json(
      {
        success: true,
        message: input.isActive ? "支付网关已启用" : "支付网关已停用",
        gateway: serializeTenantOwnGateway(gateway),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("切换租户支付网关状态失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const tenantId = gate.scope.tenantId;

  const { id } = await context.params;

  try {
    const existing = await resolveOwnGateway(tenantId, id);

    if (!existing) {
      return jsonError("支付网关不存在", 404);
    }

    // 已有充值订单的网关必须保留：对账、回调、上分都靠 gatewayId 回溯。
    const orderCount = await prisma.depositOrder.count({
      where: { gatewayId: existing.id },
    });

    if (orderCount > 0) {
      return jsonError("该网关已有充值订单，无法删除，请改为停用", 409);
    }

    await prisma.paymentGateway.delete({ where: { id: existing.id } });

    return Response.json(
      { success: true, message: "支付网关已删除" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("删除租户支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
