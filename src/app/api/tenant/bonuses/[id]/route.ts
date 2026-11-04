import type { NextRequest } from "next/server";

import {
  BONUS_CAMPAIGN_SELECT,
  mapBonusCampaignView,
  parseBonusCampaignInput,
} from "@/lib/bonus-campaigns";
import { prisma } from "@/lib/prisma";
import { guardTenantApi } from "@/lib/tenant-console";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 商户后台：单个红利活动的编辑 / 启停 / 删除。
 *
 * PATCH  /api/tenant/bonuses/[id] —— 编辑全部字段，或只传 { isActive } 做启停
 * DELETE /api/tenant/bonuses/[id] —— 删除活动（仅限「从没人领过」的活动）
 *
 * 安全约定：
 * - 鉴权走 guardTenantApi；一律用 { id, tenantId } 双条件查询，
 *   别家商户的活动 id 等价于「不存在」→ 404；
 * - **有人领过的活动禁止删除**（409）。schema 里 PlayerBonusClaim 对
 *   BonusCampaign 是 onDelete: Cascade，一删领取记录就跟着没了，
 *   等于把「PENDING = 禁止提现」的闸门一起删掉 —— 玩家领完红利删活动再提现，
 *   就是白拿奖金。要下线请用 PATCH 停用（isActive=false），
 *   已发放的流水要求继续有效，之后的领取自然被拒。
 */
async function resolveOwnCampaign(tenantId: string, id: string) {
  return prisma.bonusCampaign.findFirst({
    where: { id, tenantId },
    select: { id: true, _count: { select: { claims: true } } },
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const tenantId = gate.scope.tenantId;
  const { id } = await context.params;

  try {
    const existing = await resolveOwnCampaign(tenantId, id);

    if (!existing) {
      return jsonError("红利活动不存在", 404);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    // 列表页的「启用 / 停用」开关只传一个布尔值：单独走轻量分支，
    // 避免为了改一个开关把整份表单（含时间窗）重新提交一遍。
    const record = (body ?? {}) as Record<string, unknown>;
    const isToggleOnly =
      Object.keys(record).length === 1 && typeof record.isActive === "boolean";

    if (isToggleOnly) {
      const updated = await prisma.bonusCampaign.update({
        where: { id: existing.id },
        data: { isActive: record.isActive === true },
        select: BONUS_CAMPAIGN_SELECT,
      });

      return Response.json(
        {
          success: true,
          message: updated.isActive ? "活动已启用" : "活动已停用",
          campaign: mapBonusCampaignView(updated),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const parsed = parseBonusCampaignInput(body);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const updated = await prisma.bonusCampaign.update({
      where: { id: existing.id },
      data: {
        name: parsed.value.name,
        type: parsed.value.type,
        rewardAmount: parsed.value.rewardAmount,
        turnoverMultiplier: parsed.value.turnoverMultiplier,
        startAt: parsed.value.startAt,
        endAt: parsed.value.endAt,
        isActive: parsed.value.isActive,
      },
      select: BONUS_CAMPAIGN_SELECT,
    });

    return Response.json(
      {
        success: true,
        message: "活动已保存",
        campaign: mapBonusCampaignView(updated),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("更新红利活动失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const tenantId = gate.scope.tenantId;
  const { id } = await context.params;

  try {
    const existing = await resolveOwnCampaign(tenantId, id);

    if (!existing) {
      return jsonError("红利活动不存在", 404);
    }

    // 已有人领过 → 不许物理删除（会把「流水没打满禁止提现」的锁一起 cascade 掉）
    if (existing._count.claims > 0) {
      return jsonError(
        "已有玩家领取过该活动，不能删除；请改为「停用」，已发放的流水要求仍然有效",
        409,
      );
    }

    await prisma.bonusCampaign.delete({ where: { id: existing.id } });

    return Response.json(
      { success: true, message: "活动已删除" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("删除红利活动失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
