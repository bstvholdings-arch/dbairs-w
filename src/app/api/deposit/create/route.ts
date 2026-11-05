import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import {
  buildDepositPaymentInstructions,
  generateDepositOrderNo,
  resolveGatewayKind,
} from "@/lib/deposit-order";
import { normalizeGatewayBankDetails } from "@/lib/payment-gateway-bank";
import {
  gatewayBankLabel,
  resolveDepositBankSelection,
} from "@/lib/payment-gateway-banks";
import {
  gatewayRequiresManualReview,
  isFiatGatewayChannel,
} from "@/lib/payment-gateway-constants";
import {
  buildUsdtQrPayload,
  depositAmountLimitLabels,
  depositTestCallbackAllowed,
  isUsdtProviderType,
  normalizeGatewayEndpoint,
  parseDepositAmount,
  parseDepositCurrency,
  validateGatewayConfiguration,
} from "@/lib/payment-gateway";
import { normalizeGatewayQrCodeImageUrl } from "@/lib/payment-gateway-qr";
import { resolvePaymentPlayerIdentity } from "@/lib/payment-player";
import { prisma } from "@/lib/prisma";

const depositOrderSelect = {
  id: true,
  orderNo: true,
  playerId: true,
  tenantId: true,
  amount: true,
  currency: true,
  status: true,
  gatewayId: true,
  createdAt: true,
} satisfies Prisma.DepositOrderSelect;

type CreatedDepositOrder = Prisma.DepositOrderGetPayload<{
  select: typeof depositOrderSelect;
}>;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 玩家发起充值。
 * POST /api/deposit/create
 *
 * Body: { gatewayId, amount, playerId?, bank? }
 * - amount 推荐使用字符串，避免 JSON number 丢失 6 位小数精度。
 * - amount 区间默认 10 ~ 50,000，可用 DEPOSIT_MIN_AMOUNT / DEPOSIT_MAX_AMOUNT 覆盖；
 *   校验在 src/lib/payment-gateway.ts 的 parseDepositAmount 里统一完成。
 * - currency 一律以网关配置为准（gateway.currency），不再信任客户端传入值。
 * - 订单金额只以服务端解析后的 Decimal 入库，后续回调也只信任订单金额。
 * - bank 只对 REDIRECT_URL 有意义：必须落在网关配置的 supportedBanks 内，
 *   服务端会把它拼到支付商跳转地址上（bank=<code>），非法值直接 400。
 * - 返回 orderNo（DEP_<毫秒时间戳>_<6 位随机>）与 paymentInstructions（CRYPTO 钱包地址 / FIAT 银行信息）。
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const identity = await resolvePaymentPlayerIdentity(
      request,
      input,
      "DEPOSIT_ALLOW_PLAYER_ID",
    );

    if (!identity) {
      return jsonError("缺少有效的玩家身份", 401);
    }

    const gatewayId =
      typeof input.gatewayId === "string" ? input.gatewayId.trim() : "";

    if (!gatewayId) {
      return jsonError("请选择支付网关", 400);
    }

    let amount: Prisma.Decimal;

    try {
      amount = parseDepositAmount(input.amount);
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "充值金额格式不正确",
        400,
      );
    }

    const player = await prisma.player.findUnique({
      where: { id: identity.playerId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        tenant: { select: { status: true } },
      },
    });

    if (!player) {
      return jsonError("玩家不存在", 404);
    }

    // 玩家 JWT 或租户管理员 Cookie 都必须与数据库中的玩家租户一致，防止跨租户伪造。
    if (
      (identity.fromToken || identity.fromAdmin) &&
      identity.tenantId !== player.tenantId
    ) {
      return jsonError("玩家身份与租户不匹配", 403);
    }

    if (player.status !== "active") {
      return jsonError("玩家账号已被停用，无法充值", 403);
    }

    if (player.tenant.status === "suspended") {
      return jsonError("当前租户已暂停，无法充值", 403);
    }

    const gateway = await prisma.paymentGateway.findUnique({
      where: { id: gatewayId },
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
        isActive: true,
        isPlatformGateway: true,
        ownerId: true,
        supportedBanks: true,
      },
    });

    if (!gateway) {
      return jsonError("支付网关不存在", 404);
    }

    if (!gateway.isActive) {
      return jsonError("该支付网关已停用，请选择其他通道", 409);
    }

    /**
     * 去中心化支付架构：平台不再提供统一收款网关。
     * 只允许使用「玩家所属商户自己配置」的通道，
     * 平台公用通道（ownerId=null）与别家商户的通道一律拒绝。
     */
    if (gateway.isPlatformGateway || gateway.ownerId !== player.tenantId) {
      return jsonError("该支付网关不属于当前商户，请选择本商户配置的通道", 403);
    }

    /**
     * 法币专精（硬闸门）：加密货币通道一律拒绝下单。
     *
     * 前端列表已经过滤掉 USDT 通道，但玩家伪造 gatewayId 直接打接口时，
     * 这里必须再拦一次 —— 否则会出现「钱包是 MYR、订单币种是 USDT」的脏单，
     * 后面既没法对账也没法出款。判定唯一来源：isFiatGatewayChannel。
     */
    if (!isFiatGatewayChannel(gateway)) {
      return jsonError(
        "该通道为加密货币通道，本平台仅支持法币充值，请选择其他通道",
        409,
      );
    }

    const isUsdtGateway = isUsdtProviderType(gateway.providerType);
    const gatewayType = gateway.gatewayType;
    const currency = parseDepositCurrency(gateway.currency);

    if (!currency) {
      return jsonError("支付网关配置异常：订单币种无效", 409);
    }

    const walletAddress = isUsdtGateway
      ? (gateway.walletAddress ?? "").trim()
      : "";
    const qrCodeImageUrl =
      gatewayType === "STATIC_QR"
        ? normalizeGatewayQrCodeImageUrl(gateway.qrCodeImageUrl)
        : "";
    const isEndpointGateway =
      gatewayType === "REDIRECT_URL" || gatewayType === "DYNAMIC_QR";
    const endpoint = isEndpointGateway
      ? normalizeGatewayEndpoint(gateway.endpoint)
      : "";
    const bankDetails =
      gatewayType === "BANK_TRANSFER"
        ? normalizeGatewayBankDetails(gateway.bankDetails)
        : normalizeGatewayBankDetails(null);
    const configurationError = validateGatewayConfiguration({
      providerType: gateway.providerType,
      gatewayType,
      currency,
      walletAddress,
      qrCodeImageUrl,
      endpoint,
      apiKey: gateway.apiKey,
      bankDetails,
    });

    if (configurationError) {
      return jsonError(`支付网关配置异常：${configurationError}`, 409);
    }

    /**
     * 银行选择（只对 REDIRECT_URL 生效）。
     *
     * 玩家提交的 bank 一律不可信：必须落在商户配置的银行列表里。
     * 列表为空 = 该通道不做银行选择，即使前端塞了 bank 也丢弃，
     * 避免把脏参数拼进支付商的跳转地址。
     */
    const bankSelection = resolveDepositBankSelection({
      gatewayType,
      supportedBanks: gateway.supportedBanks,
      requestedBank: input.bank,
    });

    if (!bankSelection.ok) {
      return jsonError(bankSelection.error, 400);
    }

    let gatewayEndpoint: URL | null = null;

    if (endpoint) {
      try {
        gatewayEndpoint = new URL(endpoint);
      } catch {
        gatewayEndpoint = null;
      }
    }

    if (
      (gatewayType === "REDIRECT_URL" ||
        (gatewayType === "DYNAMIC_QR" && !isUsdtGateway)) &&
      !gatewayEndpoint
    ) {
      return jsonError("支付网关配置异常：支付接口地址无效", 409);
    }

    /**
     * 订单落库。
     *
     * 订单号由服务端生成（绝不接受前端传入）：DP 后台对账、支付商回传、
     * 玩家转账备注都依赖它。撞上唯一索引（P2002）时换一个号重试，
     * 而不是把数据库错误抛给玩家。
     */
    let order: CreatedDepositOrder | null = null;

    for (let attempt = 0; attempt < 3 && !order; attempt += 1) {
      try {
        order = await prisma.depositOrder.create({
          data: {
            orderNo: generateDepositOrderNo(),
            tenantId: player.tenantId,
            playerId: player.id,
            amount,
            currency,
            gatewayId: gateway.id,
            status: "pending",
          },
          select: depositOrderSelect,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }

        throw error;
      }
    }

    if (!order) {
      return jsonError("充值订单创建失败，请稍后重试", 500);
    }

    const amountText = order.amount.toFixed(6);
    const paymentUrl = isEndpointGateway ? gatewayEndpoint : null;

    if (paymentUrl) {
      paymentUrl.searchParams.set("orderId", order.id);
      // 支付商回调时必须原样带回商户订单号，否则只能按主键回查。
      paymentUrl.searchParams.set("orderNo", order.orderNo ?? order.id);
      paymentUrl.searchParams.set("amount", amountText);
      paymentUrl.searchParams.set("currency", order.currency);
      paymentUrl.searchParams.set("gateway", gateway.id);

      // 玩家选的银行原样传给支付商：多数网银收银台靠这个参数直达对应银行页，
      // 省掉玩家在支付商页面上再选一次（选错了就付到别家去）。
      if (bankSelection.bank) {
        paymentUrl.searchParams.set("bank", bankSelection.bank);
      }
    }

    // 动态二维码：USDT 编码钱包地址；其他支付商编码带订单参数的支付链接。
    const usdtQr =
      gatewayType === "DYNAMIC_QR" && isUsdtGateway && walletAddress
        ? buildUsdtQrPayload(walletAddress, amountText, order.currency)
        : null;
    const qrCodeData =
      gatewayType === "DYNAMIC_QR"
        ? (usdtQr?.qrCodeData ?? paymentUrl?.toString() ?? "")
        : "";
    const qrCodeDataWithAmount =
      gatewayType === "DYNAMIC_QR"
        ? (usdtQr?.qrCodeDataWithAmount ?? qrCodeData)
        : "";

    // 统一收款指令：CRYPTO 给钱包地址 + 二维码，FIAT 给银行账号 / 收款图 / 收银台链接。
    const gatewayKind = resolveGatewayKind(gateway);
    const paymentInstructions = buildDepositPaymentInstructions({
      gatewayKind,
      providerType: gateway.providerType,
      gatewayType,
      amount: amountText,
      currency: order.currency,
      walletAddress,
      bankDetails,
      qrCodeImageUrl,
      paymentUrl: paymentUrl?.toString() ?? null,
    });

    return Response.json(
      {
        success: true,
        orderNo: order.orderNo ?? order.id,
        order: {
          id: order.id,
          orderNo: order.orderNo ?? order.id,
          playerId: order.playerId,
          tenantId: order.tenantId,
          amount: amountText,
          currency: order.currency,
          status: order.status,
          gatewayId: order.gatewayId,
          gatewayName: gateway.name,
          providerType: gateway.providerType,
          gatewayType,
          createdAt: order.createdAt.toISOString(),
        },
        // 前端根据 gatewayType 决定跳转、动态二维码、静态图或银行转账信息。
        gatewayType,
        gatewayKind,
        // 静态码 / 银行转账：钱进商户自己的账户，永不自动上分，
        // 玩家端必须显示「待商户人工确认到账」而不是「1-3 分钟自动到账」。
        requiresManualReview: gatewayRequiresManualReview(gatewayType),
        currency: order.currency,
        amount: amountText,
        // 玩家选中的银行（REDIRECT_URL 才有值）：前端据此提示「正在跳转到 XX 支付」。
        selectedBank: bankSelection.bank || null,
        selectedBankLabel: bankSelection.bank
          ? gatewayBankLabel(bankSelection.bank)
          : null,
        amountLimits: depositAmountLimitLabels(),
        paymentInstructions,
        walletAddress:
          gatewayType === "DYNAMIC_QR" && isUsdtGateway
            ? walletAddress
            : null,
        qrCodeImageUrl:
          gatewayType === "STATIC_QR" ? qrCodeImageUrl || null : null,
        qrCodeData,
        qrCodeDataWithAmount,
        bankDetails:
          gatewayType === "BANK_TRANSFER" ? bankDetails : null,
        // 仅非生产环境为 true；前端据此决定是否显示“我已完成支付（测试）”。
        canSimulateCallback: depositTestCallbackAllowed(),
        paymentUrl: paymentUrl?.toString() ?? null,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("创建充值订单失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
