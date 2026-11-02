import type { NextRequest } from "next/server";

import { getPlayerSessionFromRequest } from "./player-session";
import { prisma } from "./prisma";

export type PlayerTenant = {
  id: string;
  name: string;
  status: string;
  themeColor: string;
};

const PLAYER_TENANT_SELECT = {
  id: true,
  name: true,
  status: true,
  themeColor: true,
} as const;

/**
 * 把站点标识归一化成可比较的 key：
 * - 支持完整 URL、域名、子域名、id；
 * - 去掉协议、路径、端口；
 * - x-forwarded-host 可能是 `a.com, proxy`，只取第一个；
 * - 统一小写。
 */
export function normalizeTenantKey(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

/** 当前请求的主机名（去掉 www. 与端口），用于白标域名自动归属租户。 */
function readRequestHost(request: NextRequest): string {
  const rawHost =
    request.headers.get("host") ?? request.headers.get("x-forwarded-host");

  return normalizeTenantKey(rawHost).replace(/^www\./, "");
}

/** id / domain / subdomain 三选一精确命中（body.site、?tenant、DEFAULT_TENANT）。 */
function findTenantByKey(key: string): Promise<PlayerTenant | null> {
  return prisma.tenant.findFirst({
    where: {
      OR: [{ id: key }, { domain: key }, { subdomain: key }],
    },
    select: PLAYER_TENANT_SELECT,
  });
}

/**
 * 按访问域名找租户：
 * 1. 完整域名命中 `Tenant.domain`；
 * 2. 子域名命中：winvora.example.com → `Tenant.subdomain = winvora`。
 *
 * 与 `lib/storefront-data.ts` 的解析顺序保持一致，
 * 保证「页面显示哪个站的装修」与「注册写到哪个站」是同一个租户。
 */
async function findTenantByHost(host: string): Promise<PlayerTenant | null> {
  if (!host) {
    return null;
  }

  const byHost = await prisma.tenant.findFirst({
    where: {
      OR: [{ domain: host }, { subdomain: host }],
    },
    select: PLAYER_TENANT_SELECT,
  });

  if (byHost) {
    return byHost;
  }

  const [firstLabel] = host.split(".");

  if (!firstLabel) {
    return null;
  }

  return prisma.tenant.findFirst({
    where: { subdomain: firstLabel },
    select: PLAYER_TENANT_SELECT,
  });
}

/**
 * 解析玩家登录 / 注册属于哪个站。
 *
 * 优先级：
 * 1. 已登录玩家 Cookie 的 tenantId（切换账号时不会被 body 篡改）；
 * 2. body.site / body.tenant（支持 id、domain、subdomain，也接受完整 URL）；
 * 3. 当前访问域名 / 子域名（真正的多租户白标访问）；
 * 4. 环境变量 DEFAULT_TENANT（本地开发指定默认租户）。
 *
 * 显式指定了 site / tenant 却查不到时返回 null，避免错误地落到别的租户；
 * 以上全部落空同样返回 null —— 由调用方返回「站点不存在」。
 * **绝不**回落到「最早创建的那个租户」：那会把玩家注册进别家商户
 * （历史上「代登录 abc 却注册到 winvora」属于同一类错误）。
 */
export async function resolvePlayerTenant(
  request: NextRequest,
  input: Record<string, unknown> = {},
): Promise<PlayerTenant | null> {
  const session = await getPlayerSessionFromRequest(request);

  if (session) {
    return session.tenant;
  }

  const explicitKey =
    normalizeTenantKey(input.site) || normalizeTenantKey(input.tenant);

  if (explicitKey) {
    return findTenantByKey(explicitKey);
  }

  const hostTenant = await findTenantByHost(readRequestHost(request));

  if (hostTenant) {
    return hostTenant;
  }

  const defaultKey = normalizeTenantKey(process.env.DEFAULT_TENANT);

  if (defaultKey) {
    return findTenantByKey(defaultKey);
  }

  return null;
}
