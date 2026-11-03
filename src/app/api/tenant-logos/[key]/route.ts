import type { NextRequest } from "next/server";

import {
  isTenantLogoStorageKey,
  readTenantLogo,
} from "@/lib/tenant-logo-storage";

type RouteContext = { params: Promise<{ key: string }> };

/**
 * 商户品牌 Logo 直链（公开只读）。
 *
 * GET /api/tenant-logos/<uuid>.png|jpg|webp
 *
 * - 玩家前台大厅 / 登录页 / 玩家中心都直接 `<img src={Tenant.logoUrl}>`，
 *   所以这里不能要会话；文件名是 uuid，内容不可枚举；
 * - key 由 isTenantLogoStorageKey 严格校验，非法 key（含 ../ 目录穿越）直接 404；
 * - 文件名不可变 → 长缓存 + immutable；超管换 Logo 会写新 key，玩家不会看到旧图。
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { key } = await context.params;

  if (!isTenantLogoStorageKey(key)) {
    return new Response("Not Found", { status: 404 });
  }

  const image = await readTenantLogo(key);

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
