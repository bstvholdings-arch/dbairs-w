import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { isStaffRole, type StaffRole } from "@/lib/rbac";
import { guardPermission } from "@/lib/session";
import { serializeStaff, staffSelect } from "@/lib/staff-api";
import {
  readStaffPassword,
  readStaffRole,
  STAFF_PASSWORD_MAX_LENGTH,
  STAFF_PASSWORD_MIN_LENGTH,
} from "@/lib/staff-validation";

/**
 * 单个员工账号的修改 / 删除（仅 super_admin）。
 *
 * 防呆规则（避免把后台锁死）：
 * 1. 不能修改自己的角色：降级自己后 JWT 里的旧角色会立刻失效，等于自锁。
 * 2. 系统至少要保留一名 super_admin：不允许把最后一名超管降级或删除。
 * 3. 不能删除当前登录账号。
 */

type StaffRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** 返回还有几名 super_admin（可选排除某个 id，用于「最后一名超管」判断）。 */
function countOtherSuperAdmins(excludeId: string) {
  return prisma.adminUser.count({
    where: { role: "super_admin", id: { not: excludeId } },
  });
}

export async function PUT(request: NextRequest, context: StaffRouteContext) {
  const gate = await guardPermission(request, "staff");

  if (gate.response) {
    return gate.response;
  }

  try {
    const { id } = await context.params;

    const target = await prisma.adminUser.findUnique({
      where: { id },
      select: staffSelect,
    });

    if (!target || !isStaffRole(target.role)) {
      return jsonError("员工账号不存在", 404);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const nextRole: StaffRole | null =
      input.role === undefined ? null : readStaffRole(input.role);

    if (input.role !== undefined && !nextRole) {
      return jsonError("角色只能是 super_admin、finance、tech 或 support", 400);
    }

    const nextPassword =
      input.password === undefined ? null : readStaffPassword(input.password);

    if (input.password !== undefined && !nextPassword) {
      return jsonError(
        `密码长度需在 ${STAFF_PASSWORD_MIN_LENGTH}–${STAFF_PASSWORD_MAX_LENGTH} 位之间`,
        400,
      );
    }

    if (!nextRole && !nextPassword) {
      return jsonError("没有需要修改的内容", 400);
    }

    if (nextRole && nextRole !== target.role) {
      if (target.id === gate.user.id) {
        return jsonError(
          "不能修改自己的角色，请让其他超级管理员操作",
          400,
        );
      }

      if (target.role === "super_admin" && nextRole !== "super_admin") {
        const otherSuperAdmins = await countOtherSuperAdmins(target.id);

        if (otherSuperAdmins === 0) {
          return jsonError("系统至少需要保留一名超级管理员", 400);
        }
      }
    }

    const updated = await prisma.adminUser.update({
      where: { id: target.id },
      data: {
        ...(nextRole ? { role: nextRole } : {}),
        ...(nextPassword
          ? { passwordHash: await bcrypt.hash(nextPassword, 10) }
          : {}),
      },
      select: staffSelect,
    });

    return Response.json({ success: true, staff: serializeStaff(updated) });
  } catch (error) {
    console.error("修改员工失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  context: StaffRouteContext,
) {
  const gate = await guardPermission(request, "staff");

  if (gate.response) {
    return gate.response;
  }

  try {
    const { id } = await context.params;

    const target = await prisma.adminUser.findUnique({
      where: { id },
      select: staffSelect,
    });

    if (!target || !isStaffRole(target.role)) {
      return jsonError("员工账号不存在", 404);
    }

    if (target.id === gate.user.id) {
      return jsonError("不能删除当前登录的账号", 400);
    }

    if (target.role === "super_admin") {
      const otherSuperAdmins = await countOtherSuperAdmins(target.id);

      if (otherSuperAdmins === 0) {
        return jsonError("系统至少需要保留一名超级管理员", 400);
      }
    }

    await prisma.adminUser.delete({ where: { id: target.id } });

    return Response.json({ success: true });
  } catch (error) {
    console.error("删除员工失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
