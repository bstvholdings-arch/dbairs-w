import type { NextRequest } from "next/server";

import { verifyToken } from "./auth";
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
 * 1. 玩家端正式接入时使用 Authorization: Bearer <player JWT>，
 *    JWT 的 role 必须为 player，userId 即 Player.id。
 * 2. 当前项目的租户后台还没有玩家登录态，因此租户管理员可以用自己的
 *    登录 Cookie + body.playerId 代玩家创建订单；服务端会强制校验
 *    该玩家必须属于当前租户。
 * 3. 本地开发仍允许直接传 playerId 便于联调；生产环境默认关闭该兜底，
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
