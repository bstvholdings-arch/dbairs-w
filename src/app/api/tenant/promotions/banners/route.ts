import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  loadTenantPromotionData,
  parsePromotionBannerInput,
  PROMOTION_MAX_BANNERS,
} from "@/lib/promotions";
import { guardTenantApi } from "@/lib/tenant-console";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 商户后台：活动 Banner 列表 + 新建。
 *
 * GET  /api/tenant/promotions/banners —— 当前商户的全部活动（含停用）
 * POST /api/tenant/promotions/banners —— 新建活动（图片地址 + 跳转链接 + 分类）
 *
 * 安全约定：
 * - 鉴权统一走 guardTenantApi，tenantId 只取会话；
 * - categoryId 必须属于**当前商户**：先按 { id, tenantId } 查一次，
 *   别家的分类 id 在这里等价于「不存在」，直接 400；
 * - 图片 / 跳转地址由 parsePromotionBannerInput 统一校验
 *   （只认 http(s) 与站内 / 路径，挡住 data: / javascript: 注入）。
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
    console.error("读取活动列表失败:", error);

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

    const count = await prisma.promotionBanner.count({ where: { tenantId } });

    if (count >= PROMOTION_MAX_BANNERS) {
      return jsonError(`最多只能创建 ${PROMOTION_MAX_BANNERS} 个活动`, 409);
    }

    const banner = await prisma.promotionBanner.create({
      data: {
        tenantId,
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
        message: "活动已创建",
        banner: { ...banner, createdAt: banner.createdAt.toISOString() },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("创建活动失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
