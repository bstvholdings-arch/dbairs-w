import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import {
  PLAYER_AUTH_COOKIE_OPTIONS,
  PLAYER_TOKEN_COOKIE,
  createPlayerReferralCode,
  hashPlayerPassword,
  signPlayerToken,
} from "@/lib/player-auth";
import { prisma } from "@/lib/prisma";
import { resolvePlayerTenant } from "@/lib/player-tenant";
import {
  readPlayerEmail,
  readPlayerPassword,
  readPlayerPhone,
  readPlayerReferralCode,
  readPlayerUsername,
} from "@/lib/player-validation";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = createPlayerReferralCode();
    const existing = await prisma.player.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  return "";
}

/**
 * 玩家注册。
 * POST /api/player/register
 * Body: {
 *   username, password, phone, email,
 *   confirmPassword?, referralCode?, site?
 * }
 *
 * - `username` / `password` / `phone` / `email` 全部必填，任一不合法直接 400；
 * - `phone` 可带国际区号（+60 / +65 / +62 / +63 / +84 / +86 ...），
 *   统一归一化成 E.164 入库，如 +60123456789；
 * - 用户名 / 手机号 / 邮箱在**同一租户内**唯一：先查库给出精确提示，
 *   数据库唯一索引兜底并发注册；
 * - 注册成功后直接写入 7 天有效的 httpOnly `player_token` Cookie；
 * - 推荐码必须属于同一租户，禁止跨站绑定。
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
    const username = readPlayerUsername(input.username);
    const password = readPlayerPassword(input.password);
    const phone = readPlayerPhone(input.phone);
    const email = readPlayerEmail(input.email);
    const rawReferral =
      typeof input.referralCode === "string" ? input.referralCode.trim() : "";
    const referralCode = readPlayerReferralCode(input.referralCode);

    if (!username) {
      return jsonError(
        "username_invalid",
        "用户名需为 3–32 位字母、数字或 . _ -",
        400,
      );
    }

    if (!password) {
      return jsonError("password_invalid", "密码长度需为 8–72 个字节", 400);
    }

    if (!phone) {
      return jsonError(
        "phone_invalid",
        "手机号格式不正确，请选择国家区号并填写本地号码（如 +60123456789）",
        400,
      );
    }

    if (email === null) {
      return jsonError("email_invalid", "邮箱格式不正确", 400);
    }

    if (!email) {
      return jsonError("email_required", "请填写电子邮箱", 400);
    }

    if (
      typeof input.confirmPassword === "string" &&
      input.confirmPassword !== password
    ) {
      return jsonError("password_mismatch", "两次输入的密码不一致", 400);
    }

    if (rawReferral && !referralCode) {
      return jsonError("referral_invalid", "推荐码格式不正确", 400);
    }

    const tenant = await resolvePlayerTenant(request, input);

    if (!tenant) {
      return jsonError("tenant_unavailable", "站点不存在或已停用", 404);
    }

    if (tenant.status !== "active") {
      return jsonError("tenant_unavailable", "站点已停用，暂无法注册", 403);
    }

    // 一次查出所有潜在冲突，再逐字段判断，避免「手机号撞了却提示邮箱」。
    const duplicates = await prisma.player.findMany({
      where: {
        tenantId: tenant.id,
        OR: [{ username }, { phone }, { email }],
      },
      select: { username: true, phone: true, email: true },
      take: 5,
    });

    if (duplicates.some((item) => item.username === username)) {
      return jsonError("username_taken", "该用户名已被占用", 409);
    }

    if (duplicates.some((item) => item.phone === phone)) {
      return jsonError("phone_taken", "该手机号已被注册", 409);
    }

    if (duplicates.some((item) => item.email === email)) {
      return jsonError("email_taken", "该邮箱已被占用", 409);
    }

    let inviterId: string | null = null;

    if (referralCode) {
      const inviter = await prisma.player.findUnique({
        where: { referralCode },
        select: { id: true, tenantId: true, status: true },
      });

      if (
        !inviter ||
        inviter.tenantId !== tenant.id ||
        inviter.status !== "active"
      ) {
        return jsonError("referral_invalid", "推荐码无效", 400);
      }

      inviterId = inviter.id;
    }

    const newReferralCode = await generateUniqueReferralCode();

    if (!newReferralCode) {
      return jsonError("registration_failed", "注册失败，请稍后重试", 500);
    }

    const passwordHash = await hashPlayerPassword(password);
    const player = await prisma.player.create({
      data: {
        tenantId: tenant.id,
        username,
        passwordHash,
        phone,
        email,
        referralCode: newReferralCode,
        referredById: inviterId,
        lastLoginAt: new Date(),
      },
      select: {
        id: true,
        username: true,
        phone: true,
        email: true,
        balance: true,
        referralCode: true,
        createdAt: true,
      },
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
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(",")
        : String(error.meta?.target ?? "");

      if (target.includes("phone")) {
        return jsonError("phone_taken", "该手机号已被注册", 409);
      }

      if (target.includes("email")) {
        return jsonError("email_taken", "该邮箱已被占用", 409);
      }

      return jsonError("username_taken", "该用户名已被占用", 409);
    }

    console.error("玩家注册失败:", error);
    return jsonError("registration_failed", "服务器内部错误，请稍后重试", 500);
  }
}
