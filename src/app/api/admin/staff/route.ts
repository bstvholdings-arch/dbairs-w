import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { STAFF_ROLES } from "@/lib/rbac";
import { guardPermission } from "@/lib/session";
import { serializeStaff, staffSelect } from "@/lib/staff-api";
import {
  readStaffPassword,
  readStaffRole,
  readStaffUsername,
  STAFF_PASSWORD_MAX_LENGTH,
  STAFF_PASSWORD_MIN_LENGTH,
} from "@/lib/staff-validation";

/**
 * 员工账号接口（仅 super_admin）。
 *
 * 权限链：proxy 按 /api/admin/staff → staff 权限拦截 → 这里 guardPermission
 * 再查一次数据库确认角色没有被临时调整。
 */

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** 只返回平台员工，租户老板（tenant_admin）不在这里出现。 */
export async function GET(request: NextRequest) {
  const gate = await guardPermission(request, "staff");

  if (gate.response) {
    return gate.response;
  }

  try {
    const staff = await prisma.adminUser.findMany({
      where: { role: { in: [...STAFF_ROLES] } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: staffSelect,
    });

    return Response.json(
      { staff: staff.map(serializeStaff) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取员工列表失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
  const gate = await guardPermission(request, "staff");

  if (gate.response) {
    return gate.response;
  }

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const username = readStaffUsername(input.username);

    if (!username) {
      return jsonError(
        "用户名需为 3–32 位字母、数字、下划线、点或连字符",
        400,
      );
    }

    const password = readStaffPassword(input.password);

    if (!password) {
      return jsonError(
        `密码长度需在 ${STAFF_PASSWORD_MIN_LENGTH}–${STAFF_PASSWORD_MAX_LENGTH} 位之间`,
        400,
      );
    }

    const role = readStaffRole(input.role);

    if (!role) {
      return jsonError(
        "角色只能是 super_admin、finance、tech 或 support",
        400,
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // 员工账号一律 tenantId = null：平台员工看的是全平台数据。
    const created = await prisma.adminUser.create({
      data: { username, passwordHash, role, tenantId: null },
      select: staffSelect,
    });

    return Response.json(
      { success: true, staff: serializeStaff(created) },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("该用户名已被占用", 409);
    }

    console.error("创建员工失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
