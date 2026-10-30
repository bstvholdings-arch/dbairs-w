import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  buildPasswordResetUrl,
  PASSWORD_RESET_MESSAGE,
  PASSWORD_RESET_TTL_MS,
} from "@/lib/password-reset";
import { readPlayerEmail } from "@/lib/player-validation";
import { prisma } from "@/lib/prisma";

function genericSuccess() {
  return NextResponse.json(
    { success: true, message: PASSWORD_RESET_MESSAGE },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 发起找回密码。
 *
 * 防枚举：无论邮箱是否存在、是否格式错误，响应体与状态码都保持一致；
 * 只有服务端终端日志能看出是否真正命中了账号。
 *
 * 同一邮箱可能在同一平台对应多个租户的玩家账号，因此每个命中账号都会
 * 生成独立 Token，并各打印一条重置链接（真实邮件上线后即各发一封邮件）。
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求体格式错误" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const email = readPlayerEmail(input.email);

  // 空值 / 非法格式同样返回成功，避免通过接口行为判断账号是否存在。
  if (!email) {
    return genericSuccess();
  }

  try {
    const [players, admin] = await Promise.all([
      prisma.player.findMany({
        where: { email, status: "active" },
        select: { id: true, username: true, tenantId: true },
      }),
      prisma.adminUser.findFirst({
        where: { email },
        select: { id: true, username: true },
      }),
    ]);

    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const playerTokens = players.map((player) => ({
      player,
      token: randomUUID(),
    }));
    const adminToken = admin ? randomUUID() : null;

    // 同一邮箱命中多个租户账号时一次性写入，避免部分账号失败却已打印链接。
    if (playerTokens.length > 0 || adminToken) {
      await prisma.$transaction([
        ...playerTokens.map(({ player, token }) =>
          prisma.player.update({
            where: { id: player.id },
            data: { resetToken: token, resetTokenExpiry: expiresAt },
          }),
        ),
        ...(admin && adminToken
          ? [
              prisma.adminUser.update({
                where: { id: admin.id },
                data: { resetToken: adminToken, resetTokenExpiry: expiresAt },
              }),
            ]
          : []),
      ]);
    }

    // 每个账号使用独立 Token：多租户允许不同站点的玩家使用同一个邮箱。
    for (const { player, token } of playerTokens) {
      console.log(
        `[forgot-password] 模拟发送玩家重置邮件 (${player.username}, tenant=${player.tenantId}): ${buildPasswordResetUrl(request, token)}`,
      );
    }

    if (admin && adminToken) {
      console.log(
        `[forgot-password] 模拟发送管理员重置邮件 (${admin.username}): ${buildPasswordResetUrl(request, adminToken)}`,
      );
    }

    return genericSuccess();
  } catch (error) {
    console.error("[forgot-password] 生成重置 Token 失败:", error);
    return NextResponse.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
