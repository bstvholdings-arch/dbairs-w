import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { verifyToken } from "./auth";
import { prisma } from "./prisma";

export type SuperAdminProfile = {
  id: string;
  username: string;
  role: "super_admin";
};

async function resolveSuperAdmin(
  token: string | undefined,
): Promise<SuperAdminProfile | null> {
  if (!token) {
    return null;
  }

  const session = verifyToken(token);

  if (!session || session.role !== "super_admin") {
    return null;
  }

  // JWT 只证明签发时的身份；这里再查一次数据库，确保账号仍然存在且权限未被撤销。
  const admin = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, role: true },
  });

  if (!admin || admin.role !== "super_admin") {
    return null;
  }

  return {
    id: admin.id,
    username: admin.username,
    role: "super_admin",
  };
}

/**
 * 供 Route Handler 使用：从请求 cookie 中解析并校验超级管理员身份。
 */
export function getSuperAdminFromRequest(request: NextRequest) {
  return resolveSuperAdmin(request.cookies.get("token")?.value);
}

/**
 * 供 Server Component 使用：从 next/headers 的 cookie 中解析超级管理员身份。
 */
export async function getSuperAdminFromCookies() {
  const token = (await cookies()).get("token")?.value;
  return resolveSuperAdmin(token);
}
