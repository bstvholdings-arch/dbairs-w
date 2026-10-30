import type { NextRequest } from "next/server";

import { getPlayerSessionFromRequest } from "./player-session";
import { prisma } from "./prisma";

export type PlayerTenant = {
  id: string;
  name: string;
  status: string;
  themeColor: string;
};

export function normalizeTenantKey(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

/**
 * 解析玩家登录 / 注册属于哪个站。
 *
 * 优先级：
 * 1. 已登录玩家 Cookie 的 tenantId（切换账号时不会被 body 篡改）；
 * 2. body.site / body.tenant（支持 id、domain、subdomain，也接受完整 URL）；
 * 3. 环境变量 DEFAULT_TENANT（本地开发默认第一个租户）。
 *
 * 找不到时返回 null，由调用方返回「站点不可用」而不是错误地落到别的租户。
 */
export async function resolvePlayerTenant(
  request: NextRequest,
  input: Record<string, unknown> = {},
): Promise<PlayerTenant | null> {
  const session = await getPlayerSessionFromRequest(request);

  if (session) {
    return session.tenant;
  }

  const key =
    normalizeTenantKey(input.site) ||
    normalizeTenantKey(input.tenant) ||
    normalizeTenantKey(process.env.DEFAULT_TENANT);

  if (key) {
    return prisma.tenant.findFirst({
      where: {
        OR: [{ id: key }, { domain: key }, { subdomain: key }],
      },
      select: { id: true, name: true, status: true, themeColor: true },
    });
  }

  return prisma.tenant.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true, themeColor: true },
  });
}
