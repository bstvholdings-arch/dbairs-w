import { headers } from "next/headers";

import { appBaseUrl } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import {
  INTEGRATION_ENDPOINTS,
  baseUrlFromRequestHeaders,
  buildIntegrationUrl,
  maskApiKey,
  maskIntegrationSecret,
  type IntegrationSnapshot,
} from "@/lib/integrations";

/**
 * 页面顶部展示的 Public base URL。
 *
 * 必须跟着「当前访问的域名」走：同一份代码部署到 staging / 正式域名后，
 * 这里要自动变化，绝不能把 http://localhost:3000 或旧域名当成对外回调地址
 * 发给游戏商 / 支付商。请求头拿不到时（脱离请求上下文，例如定时任务）才回退
 * 到 APP_BASE_URL / NEXT_PUBLIC_APP_URL。
 */
async function resolveBaseUrl() {
  const fallback = appBaseUrl();

  try {
    return baseUrlFromRequestHeaders(await headers(), fallback);
  } catch {
    // headers() 在请求上下文之外会抛错，此时环境变量是唯一可信来源。
    return fallback;
  }
}

/**
 * API 集成中心的数据快照。
 *
 * 页面（Server Component）与 GET /api/admin/integrations 共用这一个函数，
 * 保证「首屏渲染的内容」与「点刷新后拿到的内容」永远是同一个形状。
 *
 * 安全约定：Tenant.apiKey 与 GameProvider.apiSecret 只在这里被读取一次，
 * 并且立刻过 maskApiKey() / maskIntegrationSecret()，返回体里没有任何明文密钥
 * 字段——明文只可能出现在「重置密钥」的一次性响应里。
 */
export async function loadIntegrationSnapshot(): Promise<IntegrationSnapshot> {
  const [tenants, gateways, providers, ipRows] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        domain: true,
        subdomain: true,
        status: true,
        contactEmail: true,
        apiCallbackUrl: true,
        backendIp: true,
        walletAddress: true,
        apiKey: true,
        apiKeyUpdatedAt: true,
      },
    }),
    // Payment Gateways 页签同时展示平台公用通道与商户专属通道：
    // 用 owner.name 区分归属，前端搜索框也能按商户名过滤。
    prisma.paymentGateway.findMany({
      orderBy: [
        { isActive: "desc" },
        { isPlatformGateway: "desc" },
        { name: "asc" },
      ],
      select: {
        id: true,
        name: true,
        providerType: true,
        gatewayType: true,
        currency: true,
        endpoint: true,
        walletAddress: true,
        apiKey: true,
        isActive: true,
        isPlatformGateway: true,
        reviewStatus: true,
        owner: { select: { name: true } },
      },
    }),
    prisma.gameProvider.findMany({
      orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        isActive: true,
        apiEndpoint: true,
        merchantId: true,
        apiSecret: true,
      },
    }),
    prisma.integrationIpWhitelist.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, ip: true, note: true, createdAt: true },
    }),
  ]);

  const baseUrl = await resolveBaseUrl();

  return {
    baseUrl,
    endpoints: INTEGRATION_ENDPOINTS.map((endpoint) => ({
      id: endpoint.id,
      url: buildIntegrationUrl(baseUrl, endpoint.path),
      labelKey: endpoint.labelKey,
      descKey: endpoint.descKey,
      status: endpoint.status,
    })),
    ipWhitelist: ipRows.map((row) => ({
      id: row.id,
      ip: row.ip,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      apiEndpoint: provider.apiEndpoint ?? "",
      merchantId: provider.merchantId ?? "",
      maskedSecret: maskIntegrationSecret(provider.apiSecret),
      hasSecret: Boolean(provider.apiSecret),
      status: provider.status,
      isActive: provider.isActive,
    })),
    gateways: gateways.map((gateway) => ({
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
    })),
    tenants: tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      domain: tenant.domain,
      subdomain: tenant.subdomain,
      status: tenant.status,
      contactEmail: tenant.contactEmail ?? "",
      apiCallbackUrl: tenant.apiCallbackUrl ?? "",
      backendIp: tenant.backendIp ?? "",
      walletAddress: tenant.walletAddress ?? "",
      maskedKey: maskApiKey(tenant.apiKey),
      hasKey: Boolean(tenant.apiKey),
      apiKeyUpdatedAt: tenant.apiKeyUpdatedAt?.toISOString() ?? null,
    })),
  };
}
