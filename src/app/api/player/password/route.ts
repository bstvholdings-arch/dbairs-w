import { NextResponse, type NextRequest } from "next/server";

import { hashPlayerPassword, verifyPlayerPassword } from "@/lib/player-auth";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";
import { readPlayerPassword } from "@/lib/player-validation";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 修改登录密码。
 * POST /api/player/password  Body: { currentPassword, newPassword, confirmPassword? }
 */
export async function POST(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("unauthorized", "未登录或登录已过期", 401);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_request", "请求体格式错误", 400);
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const currentPassword =
    typeof input.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = readPlayerPassword(input.newPassword);

  if (!currentPassword) {
    return jsonError("current_password_invalid", "请输入当前密码", 400);
  }

  if (!newPassword) {
    return jsonError("password_invalid", "新密码长度需为 8–72 个字节", 400);
  }

  if (newPassword === currentPassword) {
    return jsonError("password_same", "新密码不能与当前密码相同", 400);
  }

  if (
    typeof input.confirmPassword === "string" &&
    input.confirmPassword !== newPassword
  ) {
    return jsonError("password_mismatch", "两次输入的新密码不一致", 400);
  }

  try {
    const player = await prisma.player.findUnique({
      where: { id: session.id },
      select: { passwordHash: true },
    });

    if (!player) {
      return jsonError("unauthorized", "未登录或登录已过期", 401);
    }

    const matches = await verifyPlayerPassword(
      currentPassword,
      player.passwordHash,
    );

    if (!matches) {
      return jsonError("current_password_invalid", "当前密码不正确", 403);
    }

    await prisma.player.update({
      where: { id: session.id },
      data: { passwordHash: await hashPlayerPassword(newPassword) },
    });

    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("修改玩家密码失败:", error);
    return jsonError("password_update_failed", "保存失败，请稍后重试", 500);
  }
}
