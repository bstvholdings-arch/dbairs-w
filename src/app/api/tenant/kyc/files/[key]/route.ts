import type { NextRequest } from "next/server";

import { readKycImage } from "@/lib/kyc-storage";
import { prisma } from "@/lib/prisma";
import { guardTenantApi } from "@/lib/tenant-console";

/**
 * 商户审核时读取证件图片。
 *
 * GET /api/tenant/kyc/files/[key]
 *
 * 只有 tenant_admin 能调用，且必须存在「本租户」的 KYC 记录引用这个文件：
 * 别家商户拿到 URL 也是 404，不存在跨租户读取。
 *
 * 生产环境应改成对象存储的短期签名 URL（5-15 分钟），
 * 让浏览器直连存储而不是穿过应用服务器。
 */
type RouteContext = { params: Promise<{ key: string }> };

function notFound() {
  return new Response("文件不存在", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  const { key } = await context.params;

  const owned = await prisma.playerKyc.findFirst({
    where: {
      tenantId: gate.scope.tenantId,
      OR: [
        { idCardFrontUrl: { endsWith: `/${key}` } },
        { idCardBackUrl: { endsWith: `/${key}` } },
      ],
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
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    },
  );
}
