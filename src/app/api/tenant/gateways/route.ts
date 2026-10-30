import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { normalizeGatewayBankDetails } from "@/lib/payment-gateway-bank";
import {
  isGatewayProviderType,
  isUsdtProviderType,
  normalizeGatewayApiKey,
  normalizeGatewayCurrency,
  normalizeGatewayEndpoint,
  normalizeGatewayName,
  normalizeWalletAddress,
  validateGatewayConfiguration,
} from "@/lib/payment-gateway";
import {
  defaultGatewayCurrencyForProvider,
  defaultGatewayTypeForProvider,
  isGatewayType,
} from "@/lib/payment-gateway-constants";
import { normalizeGatewayQrCodeImageUrl } from "@/lib/payment-gateway-qr";
import {
  serializeTenantOwnGateway,
  tenantGatewaySelect,
} from "@/lib/tenant-payment-gateways";
import { prisma } from "@/lib/prisma";
import { getSessionUserFromRequest } from "@/lib/session";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 租户提交自有支付网关。
 * POST /api/tenant/gateways
 *
 * - 归属强制绑定当前租户，租户不能伪造 ownerId；
 * - 新网关固定 isPlatformGateway=false、reviewStatus=PENDING、isActive=false；
 * - 超管审核通过后才会进入玩家收银台；
 * - 租户自有网关不设置平台成本 / 售价，费率固定为 0。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUserFromRequest(request);

    if (!session) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    if (session.role !== "tenant_admin" || !session.tenantId) {
      return jsonError("仅租户管理员可提交自有支付网关", 403);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const name = normalizeGatewayName(input.name);

    if (!name) {
      return jsonError("网关名称不能为空", 400);
    }

    if (name.length > 80) {
      return jsonError("网关名称不能超过 80 个字符", 400);
    }

    if (!isGatewayProviderType(input.providerType)) {
      return jsonError("请选择有效的网关类型", 400);
    }

    const providerType = input.providerType;
    const isUsdt = isUsdtProviderType(providerType);
    const gatewayType =
      input.gatewayType === undefined ||
      input.gatewayType === null ||
      input.gatewayType === ""
        ? defaultGatewayTypeForProvider(providerType)
        : input.gatewayType;

    if (!isGatewayType(gatewayType)) {
      return jsonError("请选择有效的支付形态", 400);
    }

    const currency =
      normalizeGatewayCurrency(input.currency) ||
      defaultGatewayCurrencyForProvider(providerType);
    const walletAddress = isUsdt
      ? normalizeWalletAddress(input.walletAddress)
      : "";
    const qrCodeImageUrl =
      gatewayType === "STATIC_QR"
        ? normalizeGatewayQrCodeImageUrl(input.qrCodeImageUrl)
        : "";
    const rawEndpoint =
      typeof input.endpoint === "string" ? input.endpoint.trim() : "";
    const isEndpointGateway =
      gatewayType === "REDIRECT_URL" || gatewayType === "DYNAMIC_QR";
    const endpoint = isEndpointGateway
      ? normalizeGatewayEndpoint(input.endpoint)
      : "";

    if (rawEndpoint && !endpoint && isEndpointGateway) {
      return jsonError("接口地址必须是有效的 http/https URL", 400);
    }

    const apiKey = normalizeGatewayApiKey(input.apiKey);
    const bankDetails =
      gatewayType === "BANK_TRANSFER"
        ? normalizeGatewayBankDetails(input.bankDetails)
        : normalizeGatewayBankDetails(null);
    const configurationError = validateGatewayConfiguration({
      providerType,
      gatewayType,
      currency,
      walletAddress,
      qrCodeImageUrl,
      endpoint,
      apiKey,
      bankDetails,
    });

    if (configurationError) {
      return jsonError(configurationError, 400);
    }

    const duplicate = await prisma.paymentGateway.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ownerId: session.tenantId,
      },
      select: { id: true },
    });

    if (duplicate) {
      return jsonError("当前租户下已存在同名支付网关", 409);
    }

    const gateway = await prisma.paymentGateway.create({
      data: {
        name,
        providerType,
        gatewayType,
        currency,
        walletAddress: isUsdt ? walletAddress || null : null,
        qrCodeImageUrl:
          gatewayType === "STATIC_QR" ? qrCodeImageUrl || null : null,
        bankDetails:
          gatewayType === "BANK_TRANSFER" ? bankDetails : Prisma.DbNull,
        endpoint,
        apiKey,
        isPlatformGateway: false,
        reviewStatus: "PENDING",
        reviewNote: null,
        isActive: false,
        ownerId: session.tenantId,
      },
      select: tenantGatewaySelect,
    });

    return Response.json(
      {
        success: true,
        message: "支付网关已提交，等待平台审核",
        gateway: serializeTenantOwnGateway(gateway),
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError("所属租户不存在", 400);
    }

    console.error("提交租户支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
