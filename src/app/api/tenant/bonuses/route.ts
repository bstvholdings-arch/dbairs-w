import type { NextRequest } from "next/server";

import {
  BONUS_MAX_CAMPAIGNS,
  loadTenantBonusCampaigns,
  mapBonusCampaignView,
  parseBonusCampaignInput,
  BONUS_CAMPAIGN_SELECT,
} from "@/lib/bonus-campaigns";
import { normalizeCurrency } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { guardTenantApi } from "@/lib/tenant-console";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 商户后台：红利活动列表 + 新建。
 *
 * GET  /api/tenant/bonuses —— 当前商户的全部活动（含停用 / 过期）
 * POST /api/tenant/bonuses —— 新建活动（默认停用，显式传 isActive=true 才上线）
 *
 * 安全约定：
 * - 鉴权统一走 guardTenantApi，tenantId 只取会话，不接受前端传入；
 * - 金额 / 倍数 / 时间窗由 parseBonusCampaignInput 统一校验
 *   （结束时间必须晚于开始时间、奖励与倍数上限都在那里拦）；
 * - currency 落库时写入 Tenant.currency 快照，事后改币种不重算历史奖励。
 */
export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const campaigns = await loadTenantBonusCampaigns(gate.scope.tenantId);

    return Response.json(
      { campaigns },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取红利活动失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const tenantId = gate.scope.tenantId;

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const parsed = parseBonusCampaignInput(body);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const [tenant, count] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { currency: true },
      }),
      prisma.bonusCampaign.count({ where: { tenantId } }),
    ]);

    if (!tenant) {
      return jsonError("商户不存在", 404);
    }

    if (count >= BONUS_MAX_CAMPAIGNS) {
      return jsonError(`最多只能创建 ${BONUS_MAX_CAMPAIGNS} 个红利活动`, 409);
    }

    const campaign = await prisma.bonusCampaign.create({
      data: {
        tenantId,
        name: parsed.value.name,
        type: parsed.value.type,
        rewardAmount: parsed.value.rewardAmount,
        turnoverMultiplier: parsed.value.turnoverMultiplier,
        currency: normalizeCurrency(tenant.currency),
        startAt: parsed.value.startAt,
        endAt: parsed.value.endAt,
        isActive: parsed.value.isActive,
      },
      select: BONUS_CAMPAIGN_SELECT,
    });

    return Response.json(
      {
        success: true,
        message: "红利活动已创建",
        campaign: mapBonusCampaignView(campaign),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("创建红利活动失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
