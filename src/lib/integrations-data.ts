import { appBaseUrl } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import {
  INTEGRATION_ENDPOINTS,
  buildIntegrationUrl,
  maskApiKey,
  type IntegrationSnapshot,
} from "@/lib/integrations";

/**
 * API 集成中心的数据快照。
 *
 * 页面（Server Component）与 GET /api/admin/integrations 共用这一个函数，
 * 保证「首屏渲染的内容」与「点刷新后拿到的内容」永远是同一个形状。
 *
 * 安全约定：Tenant.apiKey 只在这里被读取一次，并且立刻过 maskApiKey()，
 * 返回体里没有任何明文密钥字段——明文只可能出现在「重置密钥」的一次性响应里。
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
        apiKey: true,
        apiKeyUpdatedAt: true,
      },
    }),
    // 区域 C 只展示平台级网关：商户自建网关属于商户自己的配置，不该出现在平台密钥清单里。
    prisma.paymentGateway.findMany({
      where: { isPlatformGateway: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        providerType: true,
        currency: true,
        apiKey: true,
        isActive: true,
      },
    }),
    prisma.gameProvider.findMany({
      orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
      select: { id: true, name: true, status: true, isActive: true },
    }),
    prisma.integrationIpWhitelist.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, ip: true, note: true, createdAt: true },
    }),
  ]);

  const baseUrl = appBaseUrl();

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
    platformKeys: [
      ...gateways.map((gateway) => ({
        id: `gateway:${gateway.id}`,
        kind: "gateway" as const,
        name: gateway.name,
        detail: `${gateway.providerType} · ${gateway.currency}`,
        maskedKey: maskApiKey(gateway.apiKey),
        active: gateway.isActive,
      })),
      // 游戏商密钥托管在游戏商后台，平台侧没有可比对的密钥，
      // 因此 maskedKey 固定为空串，由前端显示「托管于上游」。
      ...providers.map((provider) => ({
        id: `provider:${provider.id}`,
        kind: "provider" as const,
        name: provider.name,
        detail: provider.status,
        maskedKey: "",
        active: provider.isActive,
      })),
    ],
    tenants: tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      domain: tenant.domain,
      subdomain: tenant.subdomain,
      status: tenant.status,
      contactEmail: tenant.contactEmail ?? "",
      apiCallbackUrl: tenant.apiCallbackUrl ?? "",
      maskedKey: maskApiKey(tenant.apiKey),
      hasKey: Boolean(tenant.apiKey),
      apiKeyUpdatedAt: tenant.apiKeyUpdatedAt?.toISOString() ?? null,
    })),
  };
}
