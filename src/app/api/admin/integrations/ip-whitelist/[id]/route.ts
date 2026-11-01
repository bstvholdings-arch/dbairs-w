import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

type WhitelistRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * 删除一条 IP 白名单（区域 B 的「×」按钮）。
 * DELETE /api/admin/integrations/ip-whitelist/[id]
 */
export async function DELETE(
  request: NextRequest,
  context: WhitelistRouteContext,
) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return jsonError("未登录或登录已过期，请重新登录", 401);
  }

  const { id } = await context.params;

  try {
    await prisma.integrationIpWhitelist.delete({ where: { id } });

    return Response.json({ success: true, deletedId: id });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("该白名单不存在，可能已被其他管理员删除", 404);
    }

    console.error("删除 IP 白名单失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
