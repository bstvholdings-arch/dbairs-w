import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { verifyToken } from "./auth";
import { prisma } from "./prisma";
import {
  can,
  homePathForRole as resolveHomePath,
  isAdminRole,
  isStaffRole,
  type AdminRole,
  type Permission,
} from "./rbac";

export type { AdminRole };

export type TenantSessionInfo = {
  id: string;
  name: string;
  domain: string;
  subdomain: string;
  status: string;
};

export type SessionUser = {
  id: string;
  username: string;
  role: AdminRole;
  tenantId: string | null;
  tenant: TenantSessionInfo | null;
};

/**
 * 解析 JWT 后再次查询数据库，确保账号仍存在、角色未被撤销。
 * - 平台员工（super_admin / finance / tech / support）：tenantId 恒为 null，看到的是平台范围数据。
 * - tenant_admin：必须绑定有效租户，否则视为无效会话。
 */
async function resolveSessionUser(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) {
    return null;
  }

  const session = verifyToken(token);

  if (!session || !isAdminRole(session.role)) {
    return null;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      username: true,
      role: true,
      tenantId: true,
    },
  });

  // token 里的角色必须与数据库一致：超管把某人降级 / 改角色后，旧 token 立即失效。
  if (!admin || admin.role !== session.role || !isAdminRole(admin.role)) {
    return null;
  }

  if (isStaffRole(admin.role)) {
    return {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tenantId: null,
      tenant: null,
    };
  }

  if (!admin.tenantId) {
    return null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: admin.tenantId },
    select: {
      id: true,
      name: true,
      domain: true,
      subdomain: true,
      status: true,
    },
  });

  if (!tenant) {
    return null;
  }

  return {
    id: admin.id,
    username: admin.username,
    role: "tenant_admin",
    tenantId: tenant.id,
    tenant,
  };
}

/** Server Component 使用。 */
export async function getSessionUserFromCookies(): Promise<SessionUser | null> {
  const token = (await cookies()).get("token")?.value;
  return resolveSessionUser(token);
}

/** Route Handler / Proxy 使用。 */
export function getSessionUserFromRequest(
  request: NextRequest,
): Promise<SessionUser | null> {
  return resolveSessionUser(request.cookies.get("token")?.value);
}

/** 角色登录后的默认落地页（/admin、/admin/providers、/tenant …）。 */
export function homePathForRole(role: AdminRole) {
  return resolveHomePath(role);
}

export type PermissionGate =
  | { user: SessionUser; response: null }
  | { user: null; response: Response };

function noStoreJson(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * API 路由的权限闸门（第二道防线）。
 *
 * proxy 只校验 JWT 里的角色，这里再查一次数据库，防止「JWT 未过期但角色已被调整」。
 * 用法：
 *   const gate = await guardPermission(request, "providers");
 *   if (gate.response) return gate.response;
 */
export async function guardPermission(
  request: NextRequest,
  permission: Permission,
): Promise<PermissionGate> {
  const user = await getSessionUserFromRequest(request);

  if (!user) {
    return {
      user: null,
      response: noStoreJson("未登录或登录已过期，请重新登录", 401),
    };
  }

  if (!can(user.role, permission)) {
    return {
      user: null,
      response: noStoreJson(
        `无权限执行该操作（需要 ${permission} 权限，当前角色 ${user.role}）`,
        403,
      ),
    };
  }

  return { user, response: null };
}

