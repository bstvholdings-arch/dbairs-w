import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { readPasswordResetToken } from "@/lib/password-reset";
import { readPlayerPassword } from "@/lib/player-validation";
import { prisma } from "@/lib/prisma";

const BCRYPT_ROUNDS = 10;

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function invalidToken() {
  return jsonError(
    "reset_token_invalid",
    "重置链接无效或已过期，请重新申请",
    400,
  );
}

/**
 * 执行密码重置。
 *
 * Token 一次性使用：更新时再次带上 resetToken 与过期时间作为条件，
 * 即使两个请求同时到达，也只有一个能成功写入新密码。
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_request", "请求体格式错误", 400);
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const token = readPasswordResetToken(input.token);
  const newPassword = readPlayerPassword(input.newPassword);

  if (!token) {
    return invalidToken();
  }

  if (!newPassword) {
    return jsonError("password_invalid", "新密码长度需为 8–72 个字节", 400);
  }

  if (
    typeof input.confirmPassword === "string" &&
    input.confirmPassword !== newPassword
  ) {
    return jsonError("password_mismatch", "两次输入的新密码不一致", 400);
  }

  try {
    const [player, admin] = await Promise.all([
      prisma.player.findFirst({
        where: { resetToken: token },
        select: { id: true, resetTokenExpiry: true },
      }),
      prisma.adminUser.findFirst({
        where: { resetToken: token },
        select: { id: true, resetTokenExpiry: true },
      }),
    ]);

    const account = player ?? admin;

    if (!account) {
      return invalidToken();
    }

    const now = new Date();

    if (!account.resetTokenExpiry || account.resetTokenExpiry <= now) {
      // 顺手清掉过期 Token，避免它继续占用唯一索引。
      if (player) {
        await prisma.player.updateMany({
          where: { id: player.id, resetToken: token },
          data: { resetToken: null, resetTokenExpiry: null },
        });
      } else if (admin) {
        await prisma.adminUser.updateMany({
          where: { id: admin.id, resetToken: token },
          data: { resetToken: null, resetTokenExpiry: null },
        });
      }

      return invalidToken();
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    if (player) {
      const updated = await prisma.player.updateMany({
        where: {
          id: player.id,
          resetToken: token,
          resetTokenExpiry: { gt: now },
        },
        data: {
          passwordHash,
          resetToken: null,
          resetTokenExpiry: null,
        },
      });

      if (updated.count !== 1) {
        return invalidToken();
      }

      return NextResponse.json(
        { success: true, accountType: "player" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!admin) {
      return invalidToken();
    }

    const updated = await prisma.adminUser.updateMany({
      where: {
        id: admin.id,
        resetToken: token,
        resetTokenExpiry: { gt: now },
      },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    if (updated.count !== 1) {
      return invalidToken();
    }

    return NextResponse.json(
      { success: true, accountType: "admin" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[reset-password] 重置密码失败:", error);
    return jsonError("reset_failed", "密码重置失败，请稍后重试", 500);
  }
}
