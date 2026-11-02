import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { verifyToken } from "@/lib/auth";
import { GAME_CARD_STYLE_PREVIEW_PATH } from "@/lib/game-card-styles";
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationTicket,
} from "@/lib/impersonation";
import {
  homePathForRole,
  isAdminPagePath,
  isAdminRole,
  isTenantApiPath,
  isTenantPagePath,
  can,
  permissionForApi,
  permissionForPage,
  TENANT_HOME_PATH,
  TENANT_LOGIN_PATH,
  TENANT_ROLE,
} from "@/lib/rbac";

const AUTH_COOKIE = "token";

function forbiddenApi(message: string) {
  return NextResponse.json(
    { error: message },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 把越权访问的页面用户送回「他自己的首页」，并带上 denied=权限点，
 * 由 ConsoleShell 顶部横幅提示「无权限」，避免白屏或死循环重定向。
 */
function redirectToRoleHome(request: NextRequest, role: string, permission: string) {
  const home = isAdminRole(role) ? homePathForRole(role) : "/login";

  if (request.nextUrl.pathname === home) {
    // 已经在他的首页上（理论上不会发生），直接放行，避免自循环。
    return NextResponse.next();
  }

  const url = new URL(home, request.url);
  url.searchParams.set("denied", permission);

  return NextResponse.redirect(url);
}

// Next.js 16 起，middleware 文件约定已更名为 proxy。
// 该文件是路由拦截入口：登录态、角色分区与 RBAC 权限矩阵（src/lib/rbac.ts）。
// 具体业务权限仍会在页面 / API 路由内查库复核，这里是第一道快速拦截。
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 登录页与登录接口必须始终公开，否则 token 过期后会形成重定向循环。
  if (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/api/auth/login" ||
    // 找回密码页与接口必须公开：用户此时通常没有有效登录态。
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/api/auth/forgot-password" ||
    pathname === "/api/auth/reset-password" ||
    // 登出必须公开：token 过期时也要能清掉 httpOnly cookie。
    pathname === "/api/auth/logout"
  ) {
    return NextResponse.next();
  }

  // 玩家前台登录 / 注册 / 个人中心：玩家 JWT 与后台管理员 token 是两套体系，
  // 页面与 API 内部自行校验玩家 Cookie，不能在这里被后台登录页拦住。
  if (
    pathname === "/player" ||
    pathname.startsWith("/player/") ||
    pathname.startsWith("/api/player/")
  ) {
    return NextResponse.next();
  }

  // 支付商回调不带管理员 Cookie；充值 / 提现接口使用玩家 JWT、租户管理员
  // Cookie 或开发环境 playerId。这些接口自行完成身份或签名校验，因此必须在
  // 管理员 Cookie 校验之前放行。
  if (
    pathname === "/api/deposit/create" ||
    pathname === "/api/deposit/callback" ||
    // 新版支付商回调：/api/deposit/callback/<gatewayCode>，路由内强制 x-signature 验签。
    pathname.startsWith("/api/deposit/callback/") ||
    pathname === "/api/deposit/gateways" ||
    pathname === "/api/deposit/test-callback" ||
    pathname === "/api/withdrawal/create" ||
    pathname === "/api/withdrawal/callback"
  ) {
    return NextResponse.next();
  }

  // 游戏商回调与玩家进入游戏：同样不带管理员 Cookie。
  // - /api/games/callback：路由内校验来源 IP 白名单 + HMAC 签名；
  // - /api/games/launch  ：路由内校验玩家 JWT / 商户代调用身份。
  if (
    pathname === "/api/games/callback" ||
    pathname === "/api/games/launch"
  ) {
    return NextResponse.next();
  }

  // AI 对话日志上报接口由外部销售机器人调用，同样没有管理员 Cookie。
  // 路由内部会校验「超管 Cookie」或 x-ai-log-token（AI_LOG_TOKEN），
  // 未配置 token 且非超管时直接 401，因此这里前置放行是安全的。
  if (pathname === "/api/ai/log") {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const session = token ? verifyToken(token) : null;
  const isApi = pathname.startsWith("/api/");

  // 超管「代登录」票据：只有 super_admin 且票据属于本人时才有效。
  // 它是平台账号进入 /tenant 的唯一通道；tenant_admin 自己不需要票据。
  const impersonation =
    session?.role === "super_admin"
      ? verifyImpersonationTicket(
          request.cookies.get(IMPERSONATION_COOKIE)?.value,
          session.userId,
        )
      : null;

  // 玩家大厅的只读接口：访客 / 玩家 JWT / 租户管理员都要能读取，
  // 因此无论登录态如何都放行 GET；写操作仍走下面的权限校验。
  // - /api/games      ：上架中的游戏列表（按 sortOrder 降序）
  // - /api/providers  ：上架中的游戏商（大厅筛选 Tab），内部已对非管理员隐藏点数
  const isPublicLobbyRead =
    (pathname === "/api/games" || pathname === "/api/providers") &&
    (request.method === "GET" || request.method === "HEAD");

  if (isPublicLobbyRead) {
    return NextResponse.next();
  }

  // 玩家前台大厅（/）永远属于玩家：任何身份（访客 / 玩家 / 超管 / 租户管理员）
  // 打开根路径都直接渲染大厅，绝不在这里按角色重定向到后台。
  // 后台入口是独立路径，只能手动输入 /admin（租户端为 /tenant），
  // 登录页固定 /login（商户的独立入口是 /tenant/login）。
  if (pathname === "/") {
    return NextResponse.next();
  }

  // 玩家前台的游戏商专属展馆（/provider/[code]）与大厅同级：访客也必须能直接浏览，
  // 否则品牌墙点击后会被踢到后台登录页。/admin/providers 等后台路径不受影响。
  if (pathname === "/provider" || pathname.startsWith("/provider/")) {
    return NextResponse.next();
  }

  // 独立的商户登录页（/tenant/login）：未登录必须能访问，
  // 已登录的商户账号则直接送回控制台，避免「登录了还要再看一次表单」。
  if (pathname === TENANT_LOGIN_PATH) {
    if (session?.role === TENANT_ROLE) {
      return NextResponse.redirect(new URL(TENANT_HOME_PATH, request.url));
    }

    return NextResponse.next();
  }

  // 游戏封面风格预览页（/demo/game-card-styles）：AI 销冠卖站时直接发给
  // 还没有任何账号的准客户看效果，必须公开可访问。
  // 该页只渲染真实 GameCard，不查库、不写库、不读会话。
  if (
    pathname === GAME_CARD_STYLE_PREVIEW_PATH ||
    pathname.startsWith(`${GAME_CARD_STYLE_PREVIEW_PATH}/`)
  ) {
    return NextResponse.next();
  }

  if (!session) {
    if (isApi) {
      return NextResponse.json(
        { error: "未登录或登录已过期，请重新登录" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);

    return NextResponse.redirect(loginUrl);
  }

  // ---------------------------------------------------------------- API 分区
  if (isApi) {
    // 租户侧接口只允许租户账号，或持有代登录票据的超管。
    if (isTenantApiPath(pathname)) {
      if (session.role !== TENANT_ROLE && !impersonation) {
        return forbiddenApi(
          session.role === "super_admin"
            ? "平台账号需先从租户管理「进入后台」才能调用商户接口"
            : "该接口仅限租户账号调用",
        );
      }

      return NextResponse.next();
    }

    const permission = permissionForApi(pathname);

    if (permission && !can(session.role, permission)) {
      return forbiddenApi(
        `无权限访问该接口（需要 ${permission} 权限，当前角色 ${session.role}）`,
      );
    }

    return NextResponse.next();
  }

  // ------------------------------------------------------------- 页面分区
  // 商户账号（tenant_admin）与平台后台彻底隔离：
  // - 强行访问 /admin 或子页面 → 直接送回 /tenant/dashboard
  //   （不带 denied 参数：这是「分区边界」，不是权限缺失提示）；
  // - 旧平台财务 /finance 同样送回商户财务 /tenant/finance，
  //   避免同一个模块存在两套入口、两套数据范围。
  if (session.role === TENANT_ROLE) {
    if (isAdminPagePath(pathname)) {
      return NextResponse.redirect(new URL(TENANT_HOME_PATH, request.url));
    }

    if (pathname === "/finance" || pathname.startsWith("/finance/")) {
      return NextResponse.redirect(new URL("/tenant/finance", request.url));
    }
  }

  // 租户端页面只允许 tenant_admin，或持有代登录票据的超管。
  if (isTenantPagePath(pathname)) {
    if (session.role !== TENANT_ROLE && !impersonation) {
      return redirectToRoleHome(request, session.role, "tenant_zone");
    }

    return NextResponse.next();
  }

  // 统一按权限矩阵判断页面；未登记的路径（前台等）直接放行。
  const permission = permissionForPage(pathname);

  if (permission && !can(session.role, permission)) {
    return redirectToRoleHome(request, session.role, permission);
  }

  // 旧路径统一迁移到 /admin 下，保留详情页 ID（权限已在上一步校验过）。
  if (pathname === "/providers") {
    return NextResponse.redirect(new URL("/admin/providers", request.url));
  }

  if (pathname === "/tenants") {
    return NextResponse.redirect(new URL("/admin/tenants", request.url));
  }

  if (pathname.startsWith("/tenants/")) {
    const suffix = pathname.slice("/tenants".length);
    return NextResponse.redirect(
      new URL(`/admin/tenants${suffix}${search}`, request.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  // 覆盖页面与 API，排除 Next 静态资源和带扩展名的文件。
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
