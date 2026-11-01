import type { NextRequest } from "next/server";

import {
  KYC_MAX_FILE_BYTES,
  saveKycImage,
  sniffImageMime,
} from "@/lib/kyc-storage";
import { getPlayerSessionFromRequest } from "@/lib/player-session";

/**
 * 玩家证件图片上传（演示版：写本地私有目录，返回受控访问路径）。
 *
 * POST /api/player/kyc/upload  （multipart/form-data，字段名 file）
 *
 * 返回 { url }：形如 /api/player/kyc/files/<uuid>.jpg，
 * 玩家把这个 url 原样放进提交表单即可，接口会再校验文件确实存在。
 *
 * 生产环境替换：把 saveKycImage 换成对象存储直传（前端拿预签名 PUT），
 * 本接口退化成「签发上传凭证」。校验规则（类型 / 大小）保持不变。
 */
export async function POST(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return Response.json(
      { error: "未登录或登录已过期", code: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        { error: "请选择要上传的证件图片", code: "invalid_file" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (file.size === 0) {
      return Response.json(
        { error: "图片为空，请重新选择", code: "invalid_file" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (file.size > KYC_MAX_FILE_BYTES) {
      return Response.json(
        {
          error: `图片不能超过 ${Math.round(KYC_MAX_FILE_BYTES / 1024 / 1024)}MB`,
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

    const saved = await saveKycImage(bytes, mime);

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
    console.error("上传证件图片失败:", error);

    return Response.json(
      { error: "服务器内部错误，请稍后重试", code: "upload_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
