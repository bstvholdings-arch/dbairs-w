import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { PLAYER_TOKEN_COOKIE, verifyPlayerToken } from "./player-auth";
import { prisma } from "./prisma";

export type PlayerSessionInfo = {
  id: string;
  tenantId: string;
  username: string;
  email: string | null;
  phone: string | null;
  balance: string;
  status: string;
  walletAddress: string | null;
  referralCode: string;
  createdAt: string;
  lastLoginAt: string | null;
  tenant: {
    id: string;
    name: string;
    status: string;
    themeColor: string;
  };
};

/**
 * 解析玩家 JWT 后再查库：
 * - token 里的 tenantId 必须与数据库一致（不能靠改 token 跨租户）；
 * - 玩家状态非 active 或租户被停用时，会话立即失效；
 * - Decimal 统一转成字符串，方便 Server -> Client 传递，避免精度丢失。
 */
async function resolvePlayerSession(
  token: string | undefined,
): Promise<PlayerSessionInfo | null> {
  if (!token) {
    return null;
  }

  const payload = verifyPlayerToken(token);

  if (!payload) {
    return null;
  }

  const player = await prisma.player.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      tenantId: true,
      username: true,
      email: true,
      phone: true,
      balance: true,
      status: true,
      walletAddress: true,
      referralCode: true,
      createdAt: true,
      lastLoginAt: true,
      tenant: {
        select: { id: true, name: true, status: true, themeColor: true },
      },
    },
  });

  if (
    !player ||
    player.tenantId !== payload.tenantId ||
    player.status !== "active" ||
    player.tenant.status !== "active"
  ) {
    return null;
  }

  return {
    id: player.id,
    tenantId: player.tenantId,
    username: player.username,
    email: player.email,
    phone: player.phone,
    balance: player.balance.toString(),
    status: player.status,
    walletAddress: player.walletAddress,
    referralCode: player.referralCode,
    createdAt: player.createdAt.toISOString(),
    lastLoginAt: player.lastLoginAt?.toISOString() ?? null,
    tenant: {
      id: player.tenant.id,
      name: player.tenant.name,
      status: player.tenant.status,
      themeColor: player.tenant.themeColor,
    },
  };
}

/** Server Component 使用。 */
export function getPlayerSessionFromCookies(): Promise<PlayerSessionInfo | null> {
  return cookies().then((store) =>
    resolvePlayerSession(store.get(PLAYER_TOKEN_COOKIE)?.value),
  );
}

/** Route Handler 使用。 */
export function getPlayerSessionFromRequest(
  request: NextRequest,
): Promise<PlayerSessionInfo | null> {
  return resolvePlayerSession(request.cookies.get(PLAYER_TOKEN_COOKIE)?.value);
}
