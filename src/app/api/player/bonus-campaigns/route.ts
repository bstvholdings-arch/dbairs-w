import type { NextRequest } from "next/server";

import {
  claimPlayerBonus,
  loadBonusTurnoverLock,
  loadPlayerBonusCampaigns,
} from "@/lib/bonus-campaigns";
import { normalizeCurrency } from "@/lib/currency";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";

function jsonError(code: string, message: string, status: number) {
  return Response.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 玩家面红利活动。
 *
 * GET  /api/player/bonus-campaigns —— 可领 / 已领活动列表 + 流水未打满的锁定信息
 * POST /api/player/bonus-campaigns —— 领取某个活动（body: { campaignId }）
 *
 * 防套利口径（服务端唯一裁判，前端只做展示）：
 * - 活动必须 isActive 且 now ∈ [startAt, endAt]（deriveBonusCampaignStatus === "active"）；
 * - 领取资格按类型校验：注册时间 / 窗口内成功充值 / 首充发生在窗口内；
 * - 同一玩家同一活动只能领一次（DB 唯一键，并发点击 → 409）；
 * - 领到的钱先进余额，但流水没打满前提现会被 /api/withdrawal/create 直接拒。
 */
export async function GET(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("unauthorized", "未登录或登录已过期", 401);
  }

  try {
    const [campaigns, player] = await Promise.all([
      loadPlayerBonusCampaigns(session.tenantId, session.id),
      prisma.player.findFirst({
        where: { id: session.id, tenantId: session.tenantId },
        select: { tenant: { select: { currency: true } } },
      }),
    ]);

    const currency = normalizeCurrency(player?.tenant.currency ?? "MYR");
    const lock = await loadBonusTurnoverLock({
      tenantId: session.tenantId,
      playerId: session.id,
      currency,
    });

    return Response.json(
      { campaigns, lock, currency },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取红利活动失败:", error);

    return jsonError("bonus_failed", "读取活动失败，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("unauthorized", "未登录或登录已过期", 401);
  }

  let campaignId: string;

  try {
    const body = (await request.json()) as { campaignId?: unknown };

    if (typeof body.campaignId !== "string" || !body.campaignId.trim()) {
      return jsonError("bad_request", "缺少活动编号", 400);
    }

    campaignId = body.campaignId.trim();
  } catch {
    return jsonError("bad_request", "请求体格式错误", 400);
  }

  const result = await claimPlayerBonus({
    tenantId: session.tenantId,
    playerId: session.id,
    campaignId,
  });

  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }

  return Response.json(
    {
      success: true,
      message:
        result.status === "COMPLETED"
          ? "领取成功，奖励已到账"
          : "领取成功，打满流水后即可提现",
      claim: {
        id: result.claimId,
        amount: result.amount,
        requiredTurnover: result.requiredTurnover,
        status: result.status,
      },
      balance: result.balance,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
