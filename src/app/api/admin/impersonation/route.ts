import { NextResponse, type NextRequest } from "next/server";

import { IMPERSONATION_COOKIE } from "@/lib/impersonation";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

/**
 * 退出「代登录」：清掉票据 cookie，回到租户管理列表。
 *
 * DELETE /api/admin/impersonation
 *
 * 不清 token（那是超管自己的登录态），只撤掉「代表某个租户」的授权，
 * 因此退出后代登录态立即消失，超管仍然留在平台后台。
 */
export async function DELETE(request: NextRequest) {
  const admin = await getSuperAdminFromRequest(request);

  const response = NextResponse.json(
    { success: true, redirectTo: "/admin/tenants" },
    { headers: { "Cache-Control": "no-store" } },
  );

  response.cookies.set({
    name: IMPERSONATION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 0,
  });

  if (admin) {
    console.info(`[impersonate] 超管 ${admin.username} 退出代登录`);
  }

  return response;
}
