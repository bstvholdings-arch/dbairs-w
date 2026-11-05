import type { NextRequest } from "next/server";

import { formatGatewayFeeRatePercent } from "@/lib/deposit-fee";
import { maskApiKey } from "@/lib/integrations";
import { normalizeGatewayBankDetails } from "@/lib/payment-gateway-bank";
import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";
import {
  parseTenantGatewayInput,
  tenantGatewayWriteData,
} from "@/lib/tenant-gateway-input";

type GatewayRouteContext = {
  params: Promise<{ id: string }>;
};

const gatewayEditSelect = {
  id: true,
  name: true,
  providerType: true,
  gatewayType: true,
  currency: true,
  walletAddress: true,
  qrCodeImageUrl: true,
  bankDetails: true,
  endpoint: true,
  apiKey: true,
  supportedBanks: true,
  feeRate: true,
  isActive: true,
  isPlatformGateway: true,
  reviewStatus: true,
  ownerId: true,
  owner: { select: { name: true } },
} as const;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * 修改支付通道的对接配置（Payment Gateways 页签的【编辑】）。
 *
 * PATCH /api/admin/integrations/gateways/[id]
 * body: { name?, currency?, endpoint?, walletAddress?, apiKey?, isActive? }
 *
 * 权限：仅 super_admin（与集成中心其余接口一致）。
 *
 * 定位（重要）：去中心化支付架构下，收款通道由商户在自己的后台
 * （/tenant/payments）自助对接支付商，平台既不新建通道、也不接管通道。
 * 这个接口是**运维排障用的兜底修正**：
 *   - 只能改已存在的通道，不能创建；ownerId / isPlatformGateway 永远不变；
 *   - 校验规则与商户侧完全一致（共用 parseTenantGatewayInput），
 *     保证「超管能存的配置」= 「玩家真的能付款的配置」；
 *   - apiKey 缺省或空串 = 保持原密钥（前端只拿得到掩码，无法回填明文）。
 */
export async function PATCH(request: NextRequest, context: GatewayRouteContext) {
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

  try {
    const existing = await prisma.paymentGateway.findUnique({
      where: { id },
      select: gatewayEditSelect,
    });

    if (!existing) {
      return jsonError("支付通道不存在", 404);
    }

    if (hasOwn(input, "isActive") && typeof input.isActive !== "boolean") {
      return jsonError("isActive 必须是布尔值", 400);
    }

    // 未提交的字段沿用库里的旧值：超管只想改 Endpoint 时，
    // 不必重新填一遍收款钱包 / 二维码 / 银行信息也能通过完整性校验。
    const merged = {
      name: hasOwn(input, "name") ? input.name : existing.name,
      providerType: existing.providerType,
      gatewayType: existing.gatewayType,
      currency: hasOwn(input, "currency") ? input.currency : existing.currency,
      walletAddress: hasOwn(input, "walletAddress")
        ? input.walletAddress
        : (existing.walletAddress ?? ""),
      qrCodeImageUrl: existing.qrCodeImageUrl ?? "",
      bankDetails: normalizeGatewayBankDetails(existing.bankDetails),
      // 商户在 /tenant/payments 维护的银行列表必须原样带回去：
      // tenantGatewayWriteData 是「整对象覆盖」，漏传就等于把玩家的银行卡片清空。
      supportedBanks: existing.supportedBanks,
      endpoint: hasOwn(input, "endpoint") ? input.endpoint : existing.endpoint,
      // 空串 / 缺省 = 不修改密钥，但仍用旧密钥参与校验。
      apiKey: typeof input.apiKey === "string" ? input.apiKey : "",
      // 通道费率同理（tenantGatewayWriteData 整对象覆盖）：
      // 超管只想改 Endpoint 时，必须把商户配好的费率原样带回去，
      // 否则一次排障就等于把对方的对账费率清零。
      feeRate: hasOwn(input, "feeRate")
        ? input.feeRate
        : existing.feeRate.toFixed(4),
    };

    const parsed = parseTenantGatewayInput(merged, existing.apiKey);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const value = parsed.value;
    const duplicate = await prisma.paymentGateway.findFirst({
      where: {
        name: { equals: value.name, mode: "insensitive" },
        ownerId: existing.ownerId,
        id: { not: existing.id },
      },
      select: { id: true },
    });

    if (duplicate) {
      return jsonError("该商户下已存在同名支付通道", 409);
    }

    const gateway = await prisma.paymentGateway.update({
      where: { id: existing.id },
      data: {
        ...tenantGatewayWriteData(value),
        // 归属与类型不可通过本接口变更：平台只修配置，不接管通道。
        isActive:
          typeof input.isActive === "boolean" ? input.isActive : existing.isActive,
      },
      select: gatewayEditSelect,
    });

    return Response.json(
      {
        success: true,
        message: "支付通道配置已更新",
        gateway: {
          id: gateway.id,
          name: gateway.name,
          providerType: gateway.providerType,
          gatewayType: gateway.gatewayType,
          currency: gateway.currency,
          endpoint: gateway.endpoint,
          walletAddress: gateway.walletAddress ?? "",
          maskedKey: maskApiKey(gateway.apiKey),
          hasKey: Boolean(gateway.apiKey),
          isActive: gateway.isActive,
          isPlatformGateway: gateway.isPlatformGateway,
          ownerName: gateway.owner?.name ?? "",
          reviewStatus: gateway.reviewStatus,
          feeRate: formatGatewayFeeRatePercent(gateway.feeRate),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("更新支付通道配置失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
