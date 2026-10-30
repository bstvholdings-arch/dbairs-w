import { NextResponse, type NextRequest } from "next/server";

import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";
import { readPlayerWalletAddress } from "@/lib/player-validation";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 绑定 / 更新常用钱包地址。
 * PATCH /api/player/wallet  Body: { walletAddress }（空字符串代表解绑）
 */
export async function PATCH(request: NextRequest) {
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

  if (typeof input.walletAddress !== "string") {
    return jsonError("invalid_request", "缺少钱包地址", 400);
  }

  const rawAddress = input.walletAddress.trim();
  const walletAddress = rawAddress ? readPlayerWalletAddress(rawAddress) : "";

  if (rawAddress && !walletAddress) {
    return jsonError(
      "wallet_invalid",
      "钱包地址格式不正确（8–128 位字母、数字或 : _ -）",
      400,
    );
  }

  try {
    const player = await prisma.player.update({
      where: { id: session.id },
      data: { walletAddress: walletAddress || null },
      select: { walletAddress: true },
    });

    return NextResponse.json(
      { success: true, walletAddress: player.walletAddress },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("更新玩家钱包地址失败:", error);
    return jsonError("wallet_update_failed", "保存失败，请稍后重试", 500);
  }
}
