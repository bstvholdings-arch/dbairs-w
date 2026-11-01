import { NextResponse, type NextRequest } from "next/server";

import {
  PLAYER_AUTH_COOKIE_OPTIONS,
  PLAYER_TOKEN_COOKIE,
  signPlayerToken,
  verifyPlayerPassword,
} from "@/lib/player-auth";
import { prisma } from "@/lib/prisma";
import { resolvePlayerTenant } from "@/lib/player-tenant";
import {
  buildPlayerLoginCandidates,
  readPlayerLoginIdentifier,
} from "@/lib/player-validation";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 玩家登录。
 * POST /api/player/login
 * Body: { identifier | username, password, site? }
 *
 * 账号可以是 **用户名 / 手机号 / 邮箱** 中的任意一个：
 * 后端用 OR 一次性匹配（手机号额外支持只填本地号码的后缀匹配），
 * 再用 bcrypt 校验密码——多个候选同时命中时以「密码对得上的那个」为准，
 * 绝不按查到的第一条直接放行。
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
    const rawIdentifier =
      typeof input.identifier === "string"
        ? input.identifier
        : typeof input.username === "string"
          ? input.username
          : "";
    const identifier = readPlayerLoginIdentifier(rawIdentifier);
    const password = typeof input.password === "string" ? input.password : "";

    if (!identifier) {
      return jsonError("identifier_invalid", "请输入用户名、手机号或邮箱", 400);
    }

    if (!password) {
      return jsonError("invalid_credentials", "请输入密码", 400);
    }

    const tenant = await resolvePlayerTenant(request, input);

    if (!tenant) {
      return jsonError("tenant_unavailable", "站点不存在", 404);
    }

    if (tenant.status !== "active") {
      return jsonError("tenant_unavailable", "站点已停用，暂无法登录", 403);
    }

    const { email, phones, phoneSuffix } =
      buildPlayerLoginCandidates(identifier);

    const candidates = await prisma.player.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { username: identifier },
          ...(email ? [{ email }] : []),
          ...(phones.length > 0 ? [{ phone: { in: phones } }] : []),
          ...(phoneSuffix ? [{ phone: { endsWith: phoneSuffix } }] : []),
        ],
      },
      select: {
        id: true,
        username: true,
        phone: true,
        email: true,
        passwordHash: true,
        balance: true,
        status: true,
        referralCode: true,
      },
      take: 8,
    });

    if (candidates.length === 0) {
      return jsonError(
        "invalid_credentials",
        "用户名、手机号或邮箱与密码不匹配",
        401,
      );
    }

    let player: (typeof candidates)[number] | null = null;

    for (const candidate of candidates) {
      if (await verifyPlayerPassword(password, candidate.passwordHash)) {
        player = candidate;
        break;
      }
    }

    if (!player) {
      return jsonError(
        "invalid_credentials",
        "用户名、手机号或邮箱与密码不匹配",
        401,
      );
    }

    if (player.status !== "active") {
      return jsonError("player_disabled", "账号已被停用，请联系客服", 403);
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
          phone: player.phone,
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
