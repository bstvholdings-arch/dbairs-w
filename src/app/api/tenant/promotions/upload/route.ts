import type { NextRequest } from "next/server";

import { sniffImageMime } from "@/lib/kyc-storage";
import {
  PROMOTION_MAX_FILE_BYTES,
  savePromotionImage,
} from "@/lib/promotion-storage";
import { guardTenantApi } from "@/lib/tenant-console";

/**
 * 商户后台上传活动 Banner 图片。
 *
 * POST /api/tenant/promotions/upload  （multipart/form-data，字段名 file）
 *
 * - 鉴权统一走 guardTenantApi：只有登录的商户账号（或超管代登录）能上传，
 *   访客无法往服务器写文件；
 * - 类型按文件头（magic bytes）判断，改扩展名伪造的 .html / .svg 一律 415
 *   （活动图是公开直链，存 HTML 等于送一个存储型 XSS 入口）；
 * - 返回 { url }：形如 /api/promotions/banners/<uuid>.jpg，
 *   后台把它原样提交进 POST/PATCH /api/tenant/promotions/banners 的 imageUrl 即可。
 *
 * 生产环境替换：把 savePromotionImage 换成对象存储直传（前端拿预签名 PUT），
 * 本接口退化成「签发上传凭证」；校验规则与返回结构保持不变。
 */
export async function POST(request: NextRequest) {
  const gate = await guardTenantApi(request);

  if (gate.response) {
    return gate.response;
  }

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        { error: "请选择要上传的活动图片", code: "invalid_file" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (file.size === 0) {
      return Response.json(
        { error: "图片为空，请重新选择", code: "invalid_file" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (file.size > PROMOTION_MAX_FILE_BYTES) {
      return Response.json(
        {
          error: `图片不能超过 ${Math.round(PROMOTION_MAX_FILE_BYTES / 1024 / 1024)}MB`,
          code: "file_too_large",
        },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);

    if (!mime) {
      return Response.json(
        { error: "仅支持 JPG / PNG / WEBP 图片", code: "invalid_file_type" },
        { status: 415, headers: { "Cache-Control": "no-store" } },
      );
    }

    const saved = await savePromotionImage(bytes, mime);

    if (!saved) {
      return Response.json(
        { error: "图片保存失败，请重试", code: "upload_failed" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        success: true,
        url: saved.url,
        key: saved.key,
        size: saved.size,
        contentType: saved.contentType,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("上传活动图片失败:", error);

    return Response.json(
      { error: "服务器内部错误，请稍后重试", code: "upload_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
