import { connection, type NextRequest } from "next/server";

import { loadPromotionFeed } from "@/lib/promotions";
import { resolveStorefront } from "@/lib/storefront-data";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 活动大厅（Promotions）的玩家端只读接口。
 *
 * GET /api/promotions?tenant=<id | 子域名 | 域名>&category=<分类 id>
 *
 * 契约约定：
 * - **公开可读**：活动海报是营销素材，未登录访客也要能看（proxy 已对 GET 放行，
 *   src/proxy.ts 里与 /api/games、/api/providers 同一处判断）；
 * - 租户只来自前台站点解析（?tenant= → 域名 → 会话 → 代登录票据 → DEFAULT_TENANT），
 *   解析不到就 404「站点不存在」，绝不回落到任意租户（AGENTS.md 第 7 条）；
 * - 只返回 isActive=true 的 Banner，以及「至少有一张启用活动」的分类；
 * - category 只是筛选条件：不属于当前租户的分类 id 会得到空列表（不会跨租户读数据）。
 *
 * 响应：{ categories, banners, currency, generatedAt }
 */
export async function GET(request: NextRequest) {
  await connection();

  const url = new URL(request.url);
  const tenantKey = (url.searchParams.get("tenant") ?? "").trim();
  const storefront = await resolveStorefront(tenantKey || null);

  if (!storefront?.tenantId) {
    return jsonError("站点不存在", 404);
  }

  try {
    const feed = await loadPromotionFeed(storefront.tenantId);
    const categoryId = (url.searchParams.get("category") ?? "").trim();
    const banners = categoryId
      ? feed.banners.filter((banner) => banner.categoryId === categoryId)
      : feed.banners;

    return Response.json(
      {
        categories: feed.categories,
        banners,
        // 金额渲染统一走前端 formatCurrency(amount, currency)
        currency: storefront.currency,
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取活动大厅数据失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
