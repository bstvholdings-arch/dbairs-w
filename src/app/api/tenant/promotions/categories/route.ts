import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  loadTenantPromotionData,
  parsePromotionCategoryInput,
  PROMOTION_MAX_CATEGORIES,
} from "@/lib/promotions";
import { guardTenantApi } from "@/lib/tenant-console";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 商户后台：活动分类列表 + 新建分类。
 *
 * GET  /api/tenant/promotions/categories —— 当前商户的全部分类（含 Banner 数）
 * POST /api/tenant/promotions/categories —— 新建分类
 *
 * 安全约定：
 * - 鉴权统一走 guardTenantApi（未登录 401 / 非商户账号 403 / 支持超管代登录）；
 * - tenantId 只取 gate.scope.tenantId，前端传什么都改不了归属；
 * - 同名分类在库里有 (tenantId, name) 唯一键，这里先查一次给出可读的 409。
 */
export async function GET(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const data = await loadTenantPromotionData(gate.scope.tenantId);

    return Response.json(
      { categories: data.categories, banners: data.banners },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取活动分类失败:", error);

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

    const parsed = parsePromotionCategoryInput(body);

    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }

    const count = await prisma.promotionCategory.count({ where: { tenantId } });

    if (count >= PROMOTION_MAX_CATEGORIES) {
      return jsonError(
        `最多只能创建 ${PROMOTION_MAX_CATEGORIES} 个活动分类`,
        409,
      );
    }

    const duplicate = await prisma.promotionCategory.findFirst({
      where: { tenantId, name: parsed.value.name },
      select: { id: true },
    });

    if (duplicate) {
      return jsonError("当前商户下已存在同名分类", 409);
    }

    const category = await prisma.promotionCategory.create({
      data: {
        tenantId,
        name: parsed.value.name,
        sortOrder: parsed.value.sortOrder,
      },
      select: { id: true, name: true, sortOrder: true },
    });

    return Response.json(
      {
        success: true,
        message: "分类已创建",
        category: {
          ...category,
          bannerCount: 0,
          activeBannerCount: 0,
        },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("当前商户下已存在同名分类", 409);
    }

    console.error("创建活动分类失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
