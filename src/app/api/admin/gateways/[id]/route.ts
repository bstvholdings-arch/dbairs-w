import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  gatewayRateValuesFromRecord,
  gatewaySelect,
  isGatewayProviderType,
  isUsdtProviderType,
  normalizeGatewayApiKey,
  normalizeGatewayCurrency,
  normalizeGatewayEndpoint,
  normalizeGatewayName,
  normalizeGatewayReviewNote,
  normalizeWalletAddress,
  parseGatewayRates,
  readOptionalOwnerId,
  serializeGateway,
  validateGatewayConfiguration,
  validateGatewayRateHierarchy,
} from "@/lib/payment-gateway";
import {
  isGatewayReviewStatus,
  isGatewayType,
} from "@/lib/payment-gateway-constants";
import { normalizeGatewayBankDetails } from "@/lib/payment-gateway-bank";
import { normalizeGatewayQrCodeImageUrl } from "@/lib/payment-gateway-qr";
import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

type GatewayRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/** GET /api/admin/gateways/[id] */
export async function GET(
  request: NextRequest,
  context: GatewayRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id } = await context.params;
    const gateway = await prisma.paymentGateway.findUnique({
      where: { id },
      select: gatewaySelect,
    });

    if (!gateway) {
      return jsonError("支付网关不存在", 404);
    }

    return Response.json(
      { gateway: serializeGateway(gateway) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/**
 * 修改网关配置。
 * PATCH / PUT /api/admin/gateways/[id]
 *
 * apiKey 留空或不传表示沿用旧密钥。
 * 已有充值订单的网关不允许改归属，避免历史订单的商户归属被改写。
 */
async function updateGateway(
  request: NextRequest,
  context: GatewayRouteContext,
) {
  try {
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
    const existing = await prisma.paymentGateway.findUnique({
      where: { id },
      select: {
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
        payinCostRate: true,
        payinSellRate: true,
        payoutCostRate: true,
        payoutSellRate: true,
        settlementCostRate: true,
        settlementSellRate: true,
        isPlatformGateway: true,
        reviewStatus: true,
        reviewNote: true,
        ownerId: true,
        _count: { select: { depositOrders: true } },
      },
    });

    if (!existing) {
      return jsonError("支付网关不存在", 404);
    }

    const data: Prisma.PaymentGatewayUpdateInput = {};

    const finalIsPlatformGateway = hasOwn(input, "isPlatformGateway")
      ? input.isPlatformGateway
      : existing.isPlatformGateway;

    if (typeof finalIsPlatformGateway !== "boolean") {
      return jsonError("网关来源格式不正确", 400);
    }

    if (
      finalIsPlatformGateway !== existing.isPlatformGateway &&
      existing._count.depositOrders > 0
    ) {
      return jsonError(
        "该网关已有充值订单，不能修改网关来源；请新建网关后停用旧网关",
        409,
      );
    }

    const { rates, error: rateError } = parseGatewayRates(
      input,
      gatewayRateValuesFromRecord(existing),
    );

    if (!rates) {
      return jsonError(rateError || "费率格式不正确", 400);
    }

    if (finalIsPlatformGateway) {
      const rateHierarchyError = validateGatewayRateHierarchy(rates);

      if (rateHierarchyError) {
        return jsonError(rateHierarchyError, 400);
      }
    }

    const reviewAction = hasOwn(input, "reviewStatus");
    let finalReviewStatus = existing.reviewStatus;

    if (reviewAction) {
      if (!isGatewayReviewStatus(input.reviewStatus)) {
        return jsonError("请选择有效的审核状态", 400);
      }

      if (finalIsPlatformGateway) {
        return jsonError("平台网关无需审核，直接启用或停用即可", 400);
      }

      finalReviewStatus = input.reviewStatus;
    } else if (finalIsPlatformGateway) {
      finalReviewStatus = "APPROVED";
    }

    if (hasOwn(input, "name")) {
      const name = normalizeGatewayName(input.name);

      if (!name) {
        return jsonError("网关名称不能为空", 400);
      }

      if (name.length > 80) {
        return jsonError("网关名称不能超过 80 个字符", 400);
      }

      data.name = name;
    }

    let finalProviderType = existing.providerType;

    if (hasOwn(input, "providerType")) {
      if (!isGatewayProviderType(input.providerType)) {
        return jsonError("请选择有效的网关类型", 400);
      }

      finalProviderType = input.providerType;
      data.providerType = input.providerType;
    }

    let finalGatewayType = existing.gatewayType;

    if (hasOwn(input, "gatewayType")) {
      if (!isGatewayType(input.gatewayType)) {
        return jsonError("请选择有效的支付形态", 400);
      }

      finalGatewayType = input.gatewayType;
    }

    const finalIsUsdt = isUsdtProviderType(finalProviderType);
    const finalCurrency = hasOwn(input, "currency")
      ? normalizeGatewayCurrency(input.currency)
      : existing.currency;
    const finalWalletAddress = finalIsUsdt
      ? hasOwn(input, "walletAddress")
        ? normalizeWalletAddress(input.walletAddress)
        : (existing.walletAddress ?? "")
      : "";
    const finalQrCodeImageUrl =
      finalGatewayType === "STATIC_QR"
        ? hasOwn(input, "qrCodeImageUrl")
          ? normalizeGatewayQrCodeImageUrl(input.qrCodeImageUrl)
          : (existing.qrCodeImageUrl ?? "")
        : "";
    const rawEndpoint =
      hasOwn(input, "endpoint") && typeof input.endpoint === "string"
        ? input.endpoint.trim()
        : "";
    const isEndpointGateway =
      finalGatewayType === "REDIRECT_URL" ||
      finalGatewayType === "DYNAMIC_QR";
    const finalEndpoint = isEndpointGateway
      ? hasOwn(input, "endpoint")
        ? normalizeGatewayEndpoint(input.endpoint)
        : normalizeGatewayEndpoint(existing.endpoint)
      : "";

    if (rawEndpoint && !finalEndpoint && isEndpointGateway) {
      return jsonError("接口地址必须是有效的 http/https URL", 400);
    }

    const providedApiKey = hasOwn(input, "apiKey")
      ? normalizeGatewayApiKey(input.apiKey)
      : "";
    const finalApiKey = providedApiKey || existing.apiKey;
    const finalBankDetails =
      finalGatewayType === "BANK_TRANSFER"
        ? hasOwn(input, "bankDetails")
          ? normalizeGatewayBankDetails(input.bankDetails)
          : normalizeGatewayBankDetails(existing.bankDetails)
        : normalizeGatewayBankDetails(null);
    const touchesGatewayConfig = [
      "providerType",
      "gatewayType",
      "currency",
      "walletAddress",
      "qrCodeImageUrl",
      "bankDetails",
      "endpoint",
      "apiKey",
    ].some((key) => hasOwn(input, key));

    const approvingGateway =
      reviewAction && finalReviewStatus === "APPROVED";

    if (touchesGatewayConfig || approvingGateway) {
      const configurationError = validateGatewayConfiguration({
        providerType: finalProviderType,
        gatewayType: finalGatewayType,
        currency: finalCurrency,
        walletAddress: finalWalletAddress,
        qrCodeImageUrl: finalQrCodeImageUrl,
        endpoint: finalEndpoint,
        apiKey: finalApiKey,
        bankDetails: finalBankDetails,
      });

      if (configurationError) {
        return jsonError(
          approvingGateway
            ? `网关配置不完整，无法通过审核：${configurationError}`
            : configurationError,
          400,
        );
      }
    }

    data.gatewayType = finalGatewayType;
    data.currency = finalCurrency;
    data.walletAddress = finalIsUsdt ? finalWalletAddress || null : null;
    data.qrCodeImageUrl =
      finalGatewayType === "STATIC_QR" ? finalQrCodeImageUrl || null : null;
    data.bankDetails =
      finalGatewayType === "BANK_TRANSFER"
        ? finalBankDetails
        : Prisma.DbNull;
    data.endpoint = isEndpointGateway ? finalEndpoint : "";
    data.isPlatformGateway = finalIsPlatformGateway;
    data.reviewStatus = finalReviewStatus;
    data.reviewNote = reviewAction
      ? normalizeGatewayReviewNote(input.reviewNote) || null
      : finalIsPlatformGateway
        ? null
        : existing.reviewNote;

    if (reviewAction || finalIsPlatformGateway) {
      data.reviewedAt = new Date();
    }

    Object.assign(data, rates);

    if (providedApiKey) {
      data.apiKey = providedApiKey;
    }

    if (hasOwn(input, "isActive")) {
      if (typeof input.isActive !== "boolean") {
        return jsonError("启用状态格式不正确", 400);
      }

      data.isActive = input.isActive;
    }

    // 审核结果直接决定玩家是否能看到该网关：通过即启用，驳回即停用。
    if (reviewAction) {
      data.isActive = finalReviewStatus === "APPROVED";
    }

    let finalOwnerId = existing.ownerId;

    if (hasOwn(input, "ownerId")) {
      finalOwnerId = readOptionalOwnerId(input.ownerId);

      if (finalOwnerId) {
        const owner = await prisma.tenant.findUnique({
          where: { id: finalOwnerId },
          select: { id: true },
        });

        if (!owner) {
          return jsonError("选择的专属租户不存在", 400);
        }
      }

      if (
        finalOwnerId !== existing.ownerId &&
        existing._count.depositOrders > 0
      ) {
        return jsonError(
          "该网关已有充值订单，不能修改归属；请新建网关后停用旧网关",
          409,
        );
      }

      data.owner = finalOwnerId
        ? { connect: { id: finalOwnerId } }
        : { disconnect: true };
    }

    if (!finalIsPlatformGateway && !finalOwnerId) {
      return jsonError("租户自有的支付网关必须绑定所属租户", 400);
    }

    const finalName =
      typeof data.name === "string" ? data.name : existing.name;
    const duplicate = await prisma.paymentGateway.findFirst({
      where: {
        id: { not: id },
        name: { equals: finalName, mode: "insensitive" },
        ownerId: finalOwnerId,
      },
      select: { id: true },
    });

    if (duplicate) {
      return jsonError("同一归属下已存在同名支付网关", 409);
    }

    const gateway = await prisma.paymentGateway.update({
      where: { id },
      data,
      select: gatewaySelect,
    });

    return Response.json({ success: true, gateway: serializeGateway(gateway) });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("支付网关不存在", 404);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError("关联的租户不存在", 400);
    }

    console.error("更新支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function PATCH(
  request: NextRequest,
  context: GatewayRouteContext,
) {
  return updateGateway(request, context);
}

export async function PUT(
  request: NextRequest,
  context: GatewayRouteContext,
) {
  return updateGateway(request, context);
}


/**
 * 删除网关。
 * 已产生充值订单的网关必须保留，否则历史充值记录会失去通道依据；请改为停用。
 */
export async function DELETE(
  request: NextRequest,
  context: GatewayRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id } = await context.params;
    const gateway = await prisma.paymentGateway.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: { select: { depositOrders: true, withdrawals: true } },
      },
    });

    if (!gateway) {
      return jsonError("支付网关不存在", 404);
    }

    if (gateway._count.depositOrders > 0) {
      return jsonError(
        `无法删除：网关「${gateway.name}」已有 ${gateway._count.depositOrders} 条充值订单。请停用网关以保留历史充值记录。`,
        409,
      );
    }

    if (gateway._count.withdrawals > 0) {
      return jsonError(
        `无法删除：网关「${gateway.name}」已有 ${gateway._count.withdrawals} 条提现记录。请停用网关以保留历史代付记录。`,
        409,
      );
    }

    await prisma.paymentGateway.delete({ where: { id } });

    return Response.json({ success: true, deletedId: gateway.id });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError(
        "无法删除：该网关仍有关联的充值 / 提现记录，请改为停用",
        409,
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("支付网关不存在", 404);
    }

    console.error("删除支付网关失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

