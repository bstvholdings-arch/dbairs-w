import type { NextRequest } from "next/server";

import { loadIntegrationSnapshot } from "@/lib/integrations-data";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

/**
 * API 与集成中心的全量快照（区域 A/B/C/D），供页面首屏之后的刷新使用。
 * GET /api/admin/integrations
 *
 * 权限：仅 super_admin。proxy 已按 /api/admin/integrations → integrations 权限点拦截，
 * 这里再查库复核一次，避免权限矩阵被改动后出现「菜单没了但接口还能调」。
 */
export async function GET(request: NextRequest) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return Response.json(
      { error: "未登录或登录已过期，请重新登录" },
      { status: 401 },
    );
  }

  try {
    const snapshot = await loadIntegrationSnapshot();

    // 密钥掩码 / 白名单都要求实时，禁止任何中间层缓存。
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("获取 API 集成中心数据失败:", error);
    return Response.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 },
    );
  }
}
