import { connection, type NextRequest } from "next/server";

import { normalizeGatewayBankDetails } from "@/lib/payment-gateway-bank";
import {
  depositAmountLimitLabels,
  isUsdtProviderType,
  validateGatewayCheckoutAvailability,
} from "@/lib/payment-gateway";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";
import { getSessionUserFromRequest } from "@/lib/session";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 租户后台 / 收银台读取当前租户可用的充值网关。
 * GET /api/deposit/gateways
 *
 * - USDT 网关：DYNAMIC_QR，必须已配置钱包地址；
 * - 静态收款图：STATIC_QR，必须已配置二维码图片；
 * - 跳转支付：REDIRECT_URL，必须已配置有效接口地址；
 * - 银行转账：BANK_TRANSFER，必须已配置银行账号信息。
 *
 * 平台公用网关（ownerId=null）与当前租户专属网关都会返回。
 * 列表不返回二维码原图 / 银行账号明细，避免 base64 图片或敏感信息把响应撑大；
 * 真正图片与银行信息在创建订单后由 create 接口返回。
 */
export async function GET(request: NextRequest) {
  await connection();

  try {
    // 玩家大厅与租户后台共用此接口：
    // - 玩家 Cookie 优先（同一浏览器同时登录后台时，以大厅玩家为准）；
    // - 否则要求租户管理员 Cookie。
    const player = await getPlayerSessionFromRequest(request);
    const session = player ? null : await getSessionUserFromRequest(request);

    const tenantId =
      player?.tenantId ??
      (session?.role === "tenant_admin" ? session.tenantId : null);

    if (!tenantId) {
      return jsonError("仅登录玩家或租户管理员可读取充值网关", 403);
    }

    const gateways = await prisma.paymentGateway.findMany({
      where: {
        isActive: true,
        reviewStatus: "APPROVED",
        OR: [{ ownerId: null }, { ownerId: tenantId }],
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        providerType: true,
        gatewayType: true,
        currency: true,
        walletAddress: true,
        qrCodeImageUrl: true,
        endpoint: true,
        apiKey: true,
        bankDetails: true,
      },
    });

    const available = gateways.flatMap((gateway) => {
      const walletAddress = gateway.walletAddress?.trim() ?? "";
      const qrCodeImageUrl = gateway.qrCodeImageUrl?.trim() ?? "";
      const endpoint = gateway.endpoint?.trim() ?? "";
      const bankDetails = normalizeGatewayBankDetails(gateway.bankDetails);
      const availabilityError = validateGatewayCheckoutAvailability({
        providerType: gateway.providerType,
        gatewayType: gateway.gatewayType,
        currency: gateway.currency,
        walletAddress,
        qrCodeImageUrl,
        endpoint,
        apiKey: gateway.apiKey,
        bankDetails,
      });

      if (availabilityError) {
        return [];
      }

      const isUsdt = isUsdtProviderType(gateway.providerType);

      return [
        {
          id: gateway.id,
          name: gateway.name,
          providerType: gateway.providerType,
          gatewayType: gateway.gatewayType,
          currency: gateway.currency,
          walletAddress:
            gateway.gatewayType === "DYNAMIC_QR" && isUsdt
              ? walletAddress
              : "",
          hasQrCodeImage: gateway.gatewayType === "STATIC_QR",
          hasBankDetails: gateway.gatewayType === "BANK_TRANSFER",
        },
      ];
    });

    return Response.json(
      { gateways: available, amountLimits: depositAmountLimitLabels() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取充值网关列表失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
