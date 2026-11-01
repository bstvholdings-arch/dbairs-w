import { NextResponse, type NextRequest } from "next/server";

import {
  impersonationCookieOptions,
  signImpersonationTicket,
} from "@/lib/impersonation";
import { prisma } from "@/lib/prisma";
import { TENANT_HOME_PATH } from "@/lib/rbac";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

/**
 * 超管「一键进入商户后台」入口。
 *
 * GET  /api/admin/impersonation/start?tenantId=xxx
 *   - 校验 super_admin → 校验租户存在 → 下发 2 小时代登录票据 → 302 到
 *     /tenant/dashboard?impersonate=<tenantId>&impersonated=1
 *   - 之所以用接口而不是直接改 URL：Cookie 只能在 Route Handler / Server Action 里下发，
 *     Server Component 里读 `?impersonate=` 是无法写 Cookie 的。
 *
 * POST /api/admin/impersonation/start  body: { tenantId }
 *   - 同上，但返回 JSON（{ success, redirectTo }），供脚本 / 未来前端调用。
 *
 * 安全：
 * - 只认 super_admin（proxy 也按 /api/admin/* 的权限矩阵拦了一道）；
 * - 票据绑定 adminId，换账号立即失效；
 * - 只允许「进入租户控制台」，不会提升任何平台权限。
 */

const STATE_CHANGING_HEADERS = { "Cache-Control": "no-store" } as const;

function loginRedirect(request: NextRequest) {
  const login = new URL("/login", request.url);
  login.searchParams.set("next", "/admin/tenants");
  return NextResponse.redirect(login);
}

function dashboardUrl(request: NextRequest, tenantId: string) {
  const url = new URL(TENANT_HOME_PATH, request.url);
  // impersonate 保留在地址栏里，便于老板确认「我正在看谁的站」；
  // impersonated=1 是「票据已下发」标记，避免页面再次跳回本接口形成死循环。
  url.searchParams.set("impersonate", tenantId);
  url.searchParams.set("impersonated", "1");
  return url;
}

export async function GET(request: NextRequest) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return loginRedirect(request);
  }

  const tenantId = (request.nextUrl.searchParams.get("tenantId") ?? "").trim();
  const tenant = tenantId
    ? await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, status: true },
      })
    : null;

  if (!tenant) {
    // 静默回到租户列表：不泄露「这个 id 是否存在」。
    return NextResponse.redirect(new URL("/admin/tenants", request.url));
  }

  const response = NextResponse.redirect(dashboardUrl(request, tenant.id));

  response.cookies.set({
    ...impersonationCookieOptions(request.nextUrl.protocol === "https:"),
    value: signImpersonationTicket({ adminId: admin.id, tenantId: tenant.id }),
  });
  response.headers.set("Cache-Control", STATE_CHANGING_HEADERS["Cache-Control"]);

  console.info(
    `[impersonate] 超管 ${admin.username} 进入商户「${tenant.name}」(${tenant.id}) 后台（票据 2 小时）`,
  );

  return response;
}

export async function POST(request: NextRequest) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return NextResponse.json(
      { error: "未登录或登录已过期，请重新登录" },
      { status: 401, headers: STATE_CHANGING_HEADERS },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求体格式错误" },
      { status: 400, headers: STATE_CHANGING_HEADERS },
    );
  }

  const tenantId = (() => {
    const value = (body as Record<string, unknown> | null)?.tenantId;
    return typeof value === "string" ? value.trim() : "";
  })();

  const tenant = tenantId
    ? await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, status: true },
      })
    : null;

  if (!tenant) {
    return NextResponse.json(
      { error: "租户不存在" },
      { status: 404, headers: STATE_CHANGING_HEADERS },
    );
  }

  const target = dashboardUrl(request, tenant.id);
  const response = NextResponse.json(
    { success: true, redirectTo: `${target.pathname}${target.search}` },
    { headers: STATE_CHANGING_HEADERS },
  );

  response.cookies.set({
    ...impersonationCookieOptions(request.nextUrl.protocol === "https:"),
    value: signImpersonationTicket({ adminId: admin.id, tenantId: tenant.id }),
  });

  console.info(
    `[impersonate] 超管 ${admin.username} 进入商户「${tenant.name}」(${tenant.id}) 后台（票据 2 小时）`,
  );

  return response;
}
