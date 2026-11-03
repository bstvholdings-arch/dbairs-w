import type { NextRequest } from "next/server";

import {
  isPromotionStorageKey,
  readPromotionImage,
} from "@/lib/promotion-storage";

type RouteContext = { params: Promise<{ key: string }> };

/**
 * 活动 Banner 图片直链（公开只读）。
 *
 * GET /api/promotions/banners/<uuid>.jpg|png|webp|gif
 *
 * - 图片名是 uuid，内容不可枚举；key 由 isPromotionStorageKey 严格校验，
 *   非法 key（含 ../ 目录穿越）直接 404；
 * - 活动图是公开营销素材，不需要登录，所以这里没有会话校验
 *   （对比 KYC 证件图：那份必须登录 + 归属校验，见 /api/player/kyc/files/[key]）；
 * - 文件名不可变 → 长缓存 + immutable，换图必然换 key，不会看到旧海报。
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { key } = await context.params;

  if (!isPromotionStorageKey(key)) {
    return new Response("Not Found", { status: 404 });
  }

  const image = await readPromotionImage(key);

  if (!image) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(
    image.data.buffer.slice(
      image.data.byteOffset,
      image.data.byteOffset + image.data.byteLength,
    ) as ArrayBuffer,
    {
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.data.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
