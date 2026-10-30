import type { NextRequest } from "next/server";

import { verifyToken } from "./auth";
import { getPlayerSessionFromRequest } from "./player-session";
import { getSessionUserFromRequest } from "./session";

export type PaymentPlayerIdentity = {
  playerId: string;
  tenantId: string | null;
  fromToken: boolean;
  fromAdmin: boolean;
};

export type PaymentPlayerEnvKey =
  | "DEPOSIT_ALLOW_PLAYER_ID"
  | "WITHDRAWAL_ALLOW_PLAYER_ID";

/**
 * 解析充值 / 提现发起人身份。
 *
 * 1. 玩家正式登录态：httpOnly Cookie（player_token）；玩家中心 / 大厅的所有
 *    充值、提现请求都走这里，服务端从库里复核租户与状态。
 * 2. 外部游戏商回调场景仍支持 Authorization: Bearer <player JWT>。
 * 3. 租户后台客服可用管理员 Cookie + body.playerId 代玩家创建订单；
 *    服务端会强制校验该玩家必须属于当前租户。
 * 4. 本地开发仍允许直接传 playerId 便于联调；生产环境默认关闭该兜底，
 *    必须显式设置对应 envKey=true 才会开启。
 */
export async function resolvePaymentPlayerIdentity(
  request: NextRequest,
  input: Record<string, unknown>,
  envKey: PaymentPlayerEnvKey,
): Promise<PaymentPlayerIdentity | null> {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.startsWith("Bearer ")) {
    const session = verifyToken(authorization.slice("Bearer ".length).trim());

    if (session?.role === "player") {
      return {
        playerId: session.userId,
        tenantId: session.tenantId,
        fromToken: true,
        fromAdmin: false,
      };
    }
  }

  // 优先使用玩家 Cookie：即使同一浏览器同时登录了超管 / 租户后台，
  // 大厅里的充值也必须算在当前玩家头上。
  const playerSession = await getPlayerSessionFromRequest(request);

  if (playerSession) {
    return {
      playerId: playerSession.id,
      tenantId: playerSession.tenantId,
      fromToken: true,
      fromAdmin: false,
    };
  }

  const playerId =
    typeof input.playerId === "string" ? input.playerId.trim() : "";

  if (playerId) {
    const admin = await getSessionUserFromRequest(request);

    if (admin?.role === "tenant_admin" && admin.tenantId) {
      return {
        playerId,
        tenantId: admin.tenantId,
        fromToken: false,
        fromAdmin: true,
      };
    }
  }

  const allowBodyPlayerId =
    process.env.NODE_ENV !== "production" || process.env[envKey] === "true";

  if (!allowBodyPlayerId || !playerId) {
    return null;
  }

  return {
    playerId,
    tenantId: null,
    fromToken: false,
    fromAdmin: false,
  };
}
