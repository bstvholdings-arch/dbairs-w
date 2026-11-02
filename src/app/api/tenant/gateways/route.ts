import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

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

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 商户新增自有支付网关（去中心化支付架构）。
 * POST /api/tenant/gateways
 *
 * - 鉴权统一走 guardTenantApi：未登录 401、非商户账号 403，
 *   tenantId 只从会话取（超管代登录时取被代登录的商户），前端传什么都改不了归属；
 * - 平台不再提供统一收款网关，也不再人工审核：新建即 reviewStatus=APPROVED、
 *   isActive=true，保存后立刻出现在本商户玩家的充值弹窗里；
 * - 商户自有网关不设置平台成本 / 售价，费率固定为 0；平台只在
 *   /admin/integrations 只读监控商户的对接状态。
 */
export async function POST(request: NextRequest) {
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

    const parsed = parseTenantGatewayInput(body);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const value = parsed.value;
    const duplicate = await prisma.paymentGateway.findFirst({
      where: {
        name: { equals: value.name, mode: "insensitive" },
        ownerId: tenantId,
      },
      select: { id: true },
    });

    if (duplicate) {
      return jsonError("当前商户下已存在同名支付网关", 409);
    }

    const gateway = await prisma.paymentGateway.create({
      data: {
        ...tenantGatewayWriteData(value),
        isPlatformGateway: false,
        // 商户自行对接支付商，平台不再审核：创建即生效。
        reviewStatus: "APPROVED",
        reviewNote: null,
        reviewedAt: new Date(),
        isActive: true,
        ownerId: tenantId,
      },
      select: tenantGatewaySelect,
    });

    return Response.json(
      {
        success: true,
        message: "支付网关已保存并生效",
        gateway: serializeTenantOwnGateway(gateway),
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError("所属商户不存在", 400);
    }

    console.error("提交租户支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
