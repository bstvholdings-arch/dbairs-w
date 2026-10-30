import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { resolveProviderPoints } from "@/lib/ggr-settlement";
import { prisma } from "@/lib/prisma";
import {
  providerSelect,
  readDecimalInput,
  serializeProvider,
} from "@/lib/provider-api";
import { can } from "@/lib/rbac";
import { guardPermission, getSessionUserFromRequest } from "@/lib/session";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * GET /api/providers
 *
 * 双用途接口：
 * - 超级管理员：返回完整配置（点数、结算状态、游戏数量、品牌墙排序/开关），供后台表格使用；
 * - 其它调用方（玩家大厅的游戏商品牌墙）：只返回「上架中」游戏商的
 *   { id, name, gameCount, sortOrder, showInShowcase }，不泄露任何点数或结算数据。
 *   品牌墙会自己按 showInShowcase 过滤、按 sortOrder 从大到小排序，
 *   这样后台【前台装修 → 游戏商商标网格】保存后前台立即生效。
 */
export async function GET(request: NextRequest) {
  try {
    // 有 providers 权限的账号（super_admin / tech）看到完整配置，
    // 其它调用方（玩家大厅品牌墙）只拿到公开字段。
    const viewer = await getSessionUserFromRequest(request);

    if (viewer && can(viewer.role, "providers")) {
      const providers = await prisma.gameProvider.findMany({
        orderBy: [{ sortOrder: "desc" }, { status: "asc" }, { name: "asc" }],
        select: providerSelect,
      });

      return Response.json(
        { providers: providers.map(serializeProvider) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const storefront = await prisma.gameProvider.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        showInShowcase: true,
        _count: { select: { games: true } },
      },
    });

    return Response.json(
      {
        providers: storefront.map((provider) => ({
          id: provider.id,
          name: provider.name,
          gameCount: provider._count.games,
          sortOrder: provider.sortOrder,
          showInShowcase: provider.showInShowcase,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取游戏商列表失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
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

    const input = (body ?? {}) as Record<string, unknown>;
    const name =
      typeof input.name === "string"
        ? input.name.trim().replace(/\s+/g, " ")
        : "";

    if (!name) {
      return jsonError("游戏商名称不能为空", 400);
    }

    if (name.length > 80) {
      return jsonError("游戏商名称不能超过 80 个字符", 400);
    }

    let points: ReturnType<typeof resolveProviderPoints>;

    try {
      points = resolveProviderPoints(
        readDecimalInput(input.upstreamPoint),
        readDecimalInput(input.platformMarkup),
      );
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "点数配置不正确",
        400,
      );
    }

    const existing = await prisma.gameProvider.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });

    if (existing) {
      return jsonError("该游戏商名称已存在", 409);
    }

    const provider = await prisma.gameProvider.create({
      data: {
        name,
        upstreamPoint: points.upstreamPoint,
        platformMarkup: points.platformMarkup,
        downstreamPoint: points.downstreamPoint,
      },
      select: providerSelect,
    });

    return Response.json(
      { success: true, provider: serializeProvider(provider) },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("该游戏商名称已存在", 409);
    }

    console.error("创建游戏商失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
