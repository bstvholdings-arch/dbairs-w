import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { parsePromotionCategoryInput } from "@/lib/promotions";
import { guardTenantApi } from "@/lib/tenant-console";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 商户后台：单个活动分类的修改与删除。
 *
 * PATCH  /api/tenant/promotions/categories/[id] —— 改名 / 改排序（提交完整对象）
 * DELETE /api/tenant/promotions/categories/[id] —— 删除分类（连带删除分类下的 Banner）
 *
 * 安全约定：
 * - 鉴权统一走 guardTenantApi；
 * - 两个方法都用 { id, tenantId } 双条件查询，别家商户的分类 id 在这里等价于
 *   「不存在」，统一 404，不泄露任何信息；
 * - 删除是硬删除：Banner 表的外键设了 onDelete: Cascade，删分类必然连带删图，
 *   后台 UI 会先弹「该分类下有 N 个活动」的二次确认。
 */
async function resolveOwnCategory(tenantId: string, id: string) {
  return prisma.promotionCategory.findFirst({
    where: { id, tenantId },
    select: { id: true, name: true },
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
    const existing = await resolveOwnCategory(tenantId, id);

    if (!existing) {
      return jsonError("分类不存在", 404);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const parsed = parsePromotionCategoryInput(body);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const duplicate = await prisma.promotionCategory.findFirst({
      where: {
        tenantId,
        name: parsed.value.name,
        id: { not: existing.id },
      },
      select: { id: true },
    });

    if (duplicate) {
      return jsonError("当前商户下已存在同名分类", 409);
    }

    const category = await prisma.promotionCategory.update({
      where: { id: existing.id },
      data: { name: parsed.value.name, sortOrder: parsed.value.sortOrder },
      select: { id: true, name: true, sortOrder: true },
    });

    return Response.json(
      { success: true, message: "分类已保存", category },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("当前商户下已存在同名分类", 409);
    }

    console.error("修改活动分类失败:", error);

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
    const existing = await resolveOwnCategory(tenantId, id);

    if (!existing) {
      return jsonError("分类不存在", 404);
    }

    const bannerCount = await prisma.promotionBanner.count({
      where: { categoryId: existing.id, tenantId },
    });

    await prisma.promotionCategory.delete({ where: { id: existing.id } });

    return Response.json(
      {
        success: true,
        message: `分类「${existing.name}」及其中 ${bannerCount} 个活动已删除`,
        deletedBanners: bannerCount,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("删除活动分类失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
