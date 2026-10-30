import { NextResponse, type NextRequest } from "next/server";

import {
  PLAYER_AUTH_COOKIE_OPTIONS,
  PLAYER_TOKEN_COOKIE,
  signPlayerToken,
  verifyPlayerPassword,
} from "@/lib/player-auth";
import { prisma } from "@/lib/prisma";
import { resolvePlayerTenant } from "@/lib/player-tenant";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 玩家登录。
 * POST /api/player/login
 * Body: { username, password, site? }
 *
 * 账号只在「当前站点（租户）」内查找：不同站的同名玩家互不影响。
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("invalid_request", "请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const username =
      typeof input.username === "string" ? input.username.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";

    if (!username || !password) {
      return jsonError("invalid_credentials", "请输入用户名和密码", 400);
    }

    const tenant = await resolvePlayerTenant(request, input);

    if (!tenant) {
      return jsonError("tenant_unavailable", "站点不存在", 404);
    }

    if (tenant.status !== "active") {
      return jsonError("tenant_unavailable", "站点已停用，暂无法登录", 403);
    }

    const player = await prisma.player.findUnique({
      where: { tenantId_username: { tenantId: tenant.id, username } },
      select: {
        id: true,
        username: true,
        email: true,
        passwordHash: true,
        balance: true,
        status: true,
        referralCode: true,
      },
    });

    if (!player) {
      return jsonError("invalid_credentials", "用户名或密码不正确", 401);
    }

    if (player.status !== "active") {
      return jsonError("player_disabled", "账号已被停用，请联系客服", 403);
    }

    const passwordMatches = await verifyPlayerPassword(
      password,
      player.passwordHash,
    );

    if (!passwordMatches) {
      return jsonError("invalid_credentials", "用户名或密码不正确", 401);
    }

    await prisma.player.update({
      where: { id: player.id },
      data: { lastLoginAt: new Date() },
    });

    const response = NextResponse.json(
      {
        success: true,
        player: {
          id: player.id,
          username: player.username,
          email: player.email,
          balance: player.balance.toString(),
          referralCode: player.referralCode,
          tenant: {
            id: tenant.id,
            name: tenant.name,
            themeColor: tenant.themeColor,
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      PLAYER_TOKEN_COOKIE,
      signPlayerToken({
        userId: player.id,
        role: "player",
        tenantId: tenant.id,
      }),
      PLAYER_AUTH_COOKIE_OPTIONS,
    );

    return response;
  } catch (error) {
    console.error("玩家登录失败:", error);
    return jsonError("login_failed", "服务器内部错误，请稍后重试", 500);
  }
}
