import type { NextRequest } from "next/server";

import { KYC_PLAYER_FILE_PREFIX, readKycImage } from "@/lib/kyc-storage";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";

/**
 * 读取自己的证件图片。
 *
 * GET /api/player/kyc/files/[key]
 *
 * 三道校验，缺一不可：
 * 1. 必须是已登录玩家（玩家 JWT）；
 * 2. 该文件必须出现在「自己」的 PlayerKyc 记录里（front 或 back）；
 * 3. key 必须匹配 uuid+图片扩展名，readKycImage 内部还会再挡一次目录穿越。
 *
 * 因此把 URL 发给别人也没用：对方没有你的玩家会话，拿到路径也是 404。
 */
type RouteContext = { params: Promise<{ key: string }> };

function notFound() {
  return new Response("文件不存在", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return new Response("未登录", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { key } = await context.params;
  const url = `${KYC_PLAYER_FILE_PREFIX}${key}`;

  const owned = await prisma.playerKyc.findFirst({
    where: {
      tenantId: session.tenantId,
      playerId: session.id,
      OR: [{ idCardFrontUrl: url }, { idCardBackUrl: url }],
    },
    select: { id: true },
  });

  if (!owned) {
    return notFound();
  }

  const image = await readKycImage(key);

  if (!image) {
    return notFound();
  }

  return new Response(
    image.data.buffer.slice(
      image.data.byteOffset,
      image.data.byteOffset + image.data.byteLength,
    ) as ArrayBuffer,
    {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.data.byteLength),
        // 证件照属于敏感数据：不缓存、不嗅探、禁止被外站嵌入
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    },
  );
}
