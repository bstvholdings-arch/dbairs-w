import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { parsePromotionBannerInput } from "@/lib/promotions";
import { guardTenantApi } from "@/lib/tenant-console";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 商户后台：单个活动的修改 / 启停 / 删除。
 *
 * PATCH  /api/tenant/promotions/banners/[id] —— 编辑全部字段（含 isActive 启停）
 * DELETE /api/tenant/promotions/banners/[id] —— 删除活动
 *
 * 安全约定：
 * - 鉴权统一走 guardTenantApi；
 * - 一律用 { id, tenantId } 双条件查询，别家商户的 Banner id 等价于「不存在」→ 404；
 * - 换分类时同样校验目标分类属于当前商户。
 */
async function resolveOwnBanner(tenantId: string, id: string) {
  return prisma.promotionBanner.findFirst({
    where: { id, tenantId },
    select: { id: true, categoryId: true, title: true },
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
    const existing = await resolveOwnBanner(tenantId, id);

    if (!existing) {
      return jsonError("活动不存在", 404);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const parsed = parsePromotionBannerInput(body);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const category = await prisma.promotionCategory.findFirst({
      where: { id: parsed.value.categoryId, tenantId },
      select: { id: true },
    });

    if (!category) {
      return jsonError("所属分类不存在", 400);
    }

    const banner = await prisma.promotionBanner.update({
      where: { id: existing.id },
      data: {
        categoryId: category.id,
        title: parsed.value.title,
        imageUrl: parsed.value.imageUrl,
        linkUrl: parsed.value.linkUrl,
        isActive: parsed.value.isActive,
        sortOrder: parsed.value.sortOrder,
      },
      select: {
        id: true,
        categoryId: true,
        title: true,
        imageUrl: true,
        linkUrl: true,
        isActive: true,
        sortOrder: true,
        createdAt: true,
      },
    });

    return Response.json(
      {
        success: true,
        message: "活动已保存",
        banner: { ...banner, createdAt: banner.createdAt.toISOString() },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("修改活动失败:", error);

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
    const existing = await resolveOwnBanner(tenantId, id);

    if (!existing) {
      return jsonError("活动不存在", 404);
    }

    await prisma.promotionBanner.delete({ where: { id: existing.id } });

    return Response.json(
      { success: true, message: "活动已删除" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("删除活动失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
