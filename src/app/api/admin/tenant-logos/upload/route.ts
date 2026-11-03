import type { NextRequest } from "next/server";

import { sniffImageMime } from "@/lib/kyc-storage";
import { getSuperAdminFromRequest } from "@/lib/super-admin";
import {
  TENANT_LOGO_MAX_FILE_BYTES,
  saveTenantLogo,
} from "@/lib/tenant-logo-storage";

/**
 * 超级管理员上传商户品牌 Logo。
 *
 * POST /api/admin/tenant-logos/upload  （multipart/form-data，字段名 file）
 *
 * 权限（产品决策，见 AGENTS.md「品牌 Logo」）：
 * - Logo 的**唯一写入口**在这里，只认超管会话（商户后台已彻底移除上传 / 修改）；
 * - 没有会话 / 不是超管一律 401，未知路径 / 商户身份拿不到任何上传能力；
 * - 类型按文件头（magic bytes）判断，改扩展名伪造的 .html / .svg 一律 415
 *   （Logo 是公开直链，存 HTML / SVG 等于送一个存储型 XSS 入口）；
 * - 返回 { url }：形如 /api/tenant-logos/<uuid>.png，
 *   后台把它提交进 POST /api/tenants 或 PUT /api/tenants/[id] 的 logoUrl 即可。
 *
 * 生产环境替换：把 saveTenantLogo 换成对象存储直传（Supabase Storage / S3），
 * 校验规则与返回结构保持不变，前端组件完全不用改。
 */
export async function POST(request: NextRequest) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return Response.json(
      { error: "未登录或登录已过期，请重新登录", code: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        { error: "请选择要上传的 Logo 图片", code: "invalid_file" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (file.size === 0) {
      return Response.json(
        { error: "图片为空，请重新选择", code: "invalid_file" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (file.size > TENANT_LOGO_MAX_FILE_BYTES) {
      return Response.json(
        {
          error: `Logo 不能超过 ${Math.round(
            TENANT_LOGO_MAX_FILE_BYTES / 1024 / 1024,
          )}MB`,
          code: "file_too_large",
        },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);

    if (!mime) {
      return Response.json(
        { error: "仅支持 PNG / JPG / WEBP 图片（不支持 SVG）", code: "invalid_file_type" },
        { status: 415, headers: { "Cache-Control": "no-store" } },
      );
    }

    const saved = await saveTenantLogo(bytes, mime);

    if (!saved) {
      return Response.json(
        { error: "Logo 保存失败，请重试", code: "upload_failed" },
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
    console.error("上传商户 Logo 失败:", error);

    return Response.json(
      { error: "服务器内部错误，请稍后重试", code: "upload_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
