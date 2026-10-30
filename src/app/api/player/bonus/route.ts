import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function readBonusAmount() {
  try {
    const amount = new Prisma.Decimal(process.env.DAILY_BONUS_AMOUNT ?? "0.5");

    return amount.greaterThan(0) ? amount : null;
  } catch {
    return null;
  }
}

function utcStartOfToday() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * 每日签到奖励。
 * POST /api/player/bonus
 *
 * - 每个玩家每个 UTC 日期只能领取一次（数据库唯一约束 + 事务内原子入账）；
 * - 金额来自 DAILY_BONUS_AMOUNT，默认 0.5；为 0 或非法时关闭签到；
 * - 奖励流水 type=daily_bonus，可作为对账依据。
 */
export async function POST(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("unauthorized", "未登录或登录已过期", 401);
  }

  const amount = readBonusAmount();

  if (!amount) {
    return jsonError("bonus_failed", "签到活动暂未开放", 403);
  }

  const claimDate = utcStartOfToday();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.dailyBonusClaim.create({
        data: {
          tenantId: session.tenantId,
          playerId: session.id,
          claimDate,
          amount,
          currency: "USDT",
        },
        select: { id: true },
      });

      const transaction = await tx.transaction.create({
        data: {
          tenantId: session.tenantId,
          playerId: session.id,
          type: "daily_bonus",
          amount,
          currency: "USDT",
          status: "success",
          txHash: `bonus-${claim.id}`,
        },
        select: { id: true },
      });

      await tx.dailyBonusClaim.update({
        where: { id: claim.id },
        data: { transactionId: transaction.id },
      });

      const player = await tx.player.update({
        where: { id: session.id },
        data: { balance: { increment: amount } },
        select: { balance: true },
      });

      return { claimId: claim.id, balance: player.balance.toString() };
    });

    return NextResponse.json(
      { success: true, amount: amount.toString(), balance: result.balance },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("bonus_claimed", "今天已经签到过了，明天再来", 409);
    }

    console.error("每日签到失败:", error);
    return jsonError("bonus_failed", "签到失败，请稍后重试", 500);
  }
}
