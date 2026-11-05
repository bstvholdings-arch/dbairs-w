import { connection, type NextRequest } from "next/server";

import { normalizeGatewayBankDetails } from "@/lib/payment-gateway-bank";
import { normalizeSupportedBanks } from "@/lib/payment-gateway-banks";
import {
  isFiatGatewayChannel,
} from "@/lib/payment-gateway-constants";
import { isInlineGatewayQrCodeImage } from "@/lib/payment-gateway-qr";
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
 * 收银台 / 商户后台读取**当前商户**可用的充值网关（去中心化支付架构）。
 * GET /api/deposit/gateways
 *
 * 架构约定：包网平台不再提供统一收款网关，所以这里**只读当前登录玩家
 * 所属 tenantId 的商户自有通道**，绝不再回落到平台公用网关（ownerId=null）。
 *
 * - USDT 网关：DYNAMIC_QR，必须已配置钱包地址；
 *   ⚠️ 平台只做法币：加密货币通道**永远不会**出现在这个列表里（见 isFiatGatewayChannel），
 *   历史上的 USDT 通道即使还在库里也不会下发；
 * - 静态收款图：STATIC_QR，必须已配置二维码图片；
 * - 跳转支付：REDIRECT_URL，必须已配置有效接口地址；
 * - 银行转账：BANK_TRANSFER，必须已配置银行账号信息。
 *
 * 响应里的 merchantConfigured 用来区分两种空列表：
 * - false：该商户一条通道都没配 → 前端提示「该商户暂未开通充值通道，请联系客服。」；
 * - true ：配置过通道但都停用 / 配置不完整 → 提示「当前没有可用的支付通道」。
 *
 * 列表不返回二维码原图 / 银行账号明细，避免 base64 图片或敏感信息把响应撑大；
 * 真正图片与银行信息在创建订单后由 create 接口返回。
 *
 * 唯一的例外是 STATIC_QR 的**远程图片地址**（staticQrImageUrl）：
 * 商户上传的收款码要让玩家在「输入金额之前」就看到大图（扫码即付），
 * 所以 http(s) / 站内路径的图片地址直接下发；data:image base64 仍然不下发
 * （单张可达 1.8MB，会把网关列表接口拖成慢请求），这种情况玩家在下单后看到图。
 *
 * REDIRECT_URL 通道额外下发 supportedBanks（银行编码列表）：
 * 前端据此渲染银行卡片，玩家必须选一家才能下单。
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
        // 商户自行对接：只认本商户自己的通道，平台通道一律不参与。
        ownerId: tenantId,
        isPlatformGateway: false,
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        providerType: true,
        gatewayType: true,
        currency: true,
        isActive: true,
        walletAddress: true,
        qrCodeImageUrl: true,
        endpoint: true,
        apiKey: true,
        bankDetails: true,
        supportedBanks: true,
      },
    });

    const available = gateways.flatMap((gateway) => {
      if (!gateway.isActive) {
        return [];
      }

      /**
       * 法币专精：加密货币（USDT / TRC20 / ERC20）通道一律不下发，
       * 玩家端连选项都看不到（判定唯一来源：isFiatGatewayChannel）。
       * 历史 USDT 通道即使还留在库里（isActive=true）也不会出现在这里。
       */
      if (!isFiatGatewayChannel(gateway)) {
        return [];
      }

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
          /**
           * STATIC_QR：允许在「下单前」就把收款码大图怼到玩家脸上。
           * 只放行远程 / 站内路径；data:image 留给下单后的 create 响应。
           */
          staticQrImageUrl:
            gateway.gatewayType === "STATIC_QR" &&
            qrCodeImageUrl &&
            !isInlineGatewayQrCodeImage(qrCodeImageUrl)
              ? qrCodeImageUrl
              : "",
          /**
           * REDIRECT_URL：玩家可选的银行（编码）。空数组 = 不做银行选择，
           * 前端直接跳支付商收银台，由支付商页面选银行。
           */
          supportedBanks:
            gateway.gatewayType === "REDIRECT_URL"
              ? normalizeSupportedBanks(gateway.supportedBanks)
              : [],
        },
      ];
    });

    return Response.json(
      {
        gateways: available,
        // 该商户是否配置过任何**法币**通道（含已停用 / 配置不完整的）：前端据此区分
        // 「商户未开通充值」与「通道暂时不可用」两种空态。
        // 只配了加密货币通道的商户同样算「未开通法币充值」（平台只做法币）。
        merchantConfigured: gateways.some(isFiatGatewayChannel),
        amountLimits: depositAmountLimitLabels(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取充值网关列表失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
