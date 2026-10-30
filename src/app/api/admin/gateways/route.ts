import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  gatewaySelect,
  isGatewayProviderType,
  isUsdtProviderType,
  normalizeGatewayApiKey,
  normalizeGatewayCurrency,
  normalizeGatewayEndpoint,
  normalizeGatewayName,
  normalizeWalletAddress,
  parseGatewayRates,
  readOptionalOwnerId,
  serializeGateway,
  validateGatewayConfiguration,
  validateGatewayRateHierarchy,
} from "@/lib/payment-gateway";
import {
  defaultGatewayCurrencyForProvider,
  defaultGatewayTypeForProvider,
  isGatewayType,
} from "@/lib/payment-gateway-constants";
import { normalizeGatewayBankDetails } from "@/lib/payment-gateway-bank";
import { normalizeGatewayQrCodeImageUrl } from "@/lib/payment-gateway-qr";
import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 超管查询全部支付网关。
 * GET /api/admin/gateways
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const gateways = await prisma.paymentGateway.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: gatewaySelect,
    });

    return Response.json(
      { gateways: gateways.map(serializeGateway) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取支付网关列表失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/**
 * 新增支付网关。
 * POST /api/admin/gateways
 *
 * ownerId 为空 = 平台公用；有值 = 只允许该租户使用。
 * apiKey 只在写入时接收，任何查询接口都不会返回明文。
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
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

    if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
      return jsonError("启用状态格式不正确", 400);
    }

    const isPlatformGateway =
      input.isPlatformGateway === undefined ? true : input.isPlatformGateway;

    if (typeof isPlatformGateway !== "boolean") {
      return jsonError("网关来源格式不正确", 400);
    }

    const { rates, error: rateError } = parseGatewayRates(input);

    if (!rates) {
      return jsonError(rateError || "费率格式不正确", 400);
    }

    if (isPlatformGateway) {
      const rateHierarchyError = validateGatewayRateHierarchy(rates);

      if (rateHierarchyError) {
        return jsonError(rateHierarchyError, 400);
      }
    }

    const ownerId = readOptionalOwnerId(input.ownerId);

    if (!isPlatformGateway && !ownerId) {
      return jsonError("租户自有的支付网关必须绑定所属租户", 400);
    }

    if (ownerId) {
      const owner = await prisma.tenant.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });

      if (!owner) {
        return jsonError("选择的专属租户不存在", 400);
      }
    }

    const duplicate = await prisma.paymentGateway.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ownerId,
      },
      select: { id: true },
    });

    if (duplicate) {
      return jsonError("同一归属下已存在同名支付网关", 409);
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
        ...rates,
        isPlatformGateway,
        reviewStatus: "APPROVED",
        reviewedAt: new Date(),
        isActive: typeof input.isActive === "boolean" ? input.isActive : true,
        ownerId,
      },
      select: gatewaySelect,
    });

    return Response.json(
      { success: true, gateway: serializeGateway(gateway) },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError("关联的租户不存在", 400);
    }

    console.error("创建支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
