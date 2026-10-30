import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { readShowcaseOrderInput } from "@/lib/provider-showcase";
import { guardPermission } from "@/lib/session";

/**
 * 游戏商商标网格（Provider Showcase）批量排序 / 显隐。
 *
 * PATCH /api/admin/providers/reorder
 *   请求体（两种都可以）：
 *     [{ id, sortOrder, showInShowcase }, ...]
 *     { providers: [{ id, sortOrder, showInShowcase }, ...] }
 *
 * 需要 providers 权限（super_admin / tech）。整批一次性校验、一次性事务写入：
 * 只要有一条 id 不存在或字段不合法就整体拒绝，避免前台出现「一半旧顺序、一半新顺序」。
 * 保存后立刻 revalidate 大厅与展馆，玩家刷新页面就能看到新排列。
 */

const reorderSelect = {
  id: true,
  name: true,
  sortOrder: true,
  showInShowcase: true,
} as const;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest) {
  try {
    const gate = await guardPermission(request, "providers");

    if (gate.response) {
      return gate.response;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    // 兼容裸数组与 { providers: [...] } 两种写法
    const rawRows = Array.isArray(body)
      ? body
      : body && typeof body === "object"
        ? (body as Record<string, unknown>).providers
        : undefined;
    const rows = readShowcaseOrderInput(rawRows);

    if (!rows) {
      return jsonError(
        "排序数据格式错误：需要 [{ id, sortOrder, showInShowcase }] 非空数组，sortOrder 必须是整数",
        400,
      );
    }

    const existing = await prisma.gameProvider.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: { id: true },
    });

    if (existing.length !== rows.length) {
      const known = new Set(existing.map((provider) => provider.id));
      const missing = rows
        .filter((row) => !known.has(row.id))
        .map((row) => row.id)
        .slice(0, 5);

      return jsonError(`游戏商不存在：${missing.join(", ")}`, 404);
    }

    await prisma.$transaction(
      rows.map((row) =>
        prisma.gameProvider.update({
          where: { id: row.id },
          data: {
            sortOrder: row.sortOrder,
            showInShowcase: row.showInShowcase,
          },
          select: { id: true },
        }),
      ),
    );

    // 前台是实时读库的，这里再显式失效一次：即使以后给大厅套上缓存也能立刻生效
    revalidatePath("/");
    revalidatePath("/provider/[code]", "page");

    const providers = await prisma.gameProvider.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
      select: reorderSelect,
    });

    return Response.json({ success: true, providers });
  } catch (error) {
    console.error("保存游戏商商标排列失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
