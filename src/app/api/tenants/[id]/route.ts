import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";
import {
  DOMAIN_PATTERN,
  SUBDOMAIN_PATTERN,
  isTenantStatus,
  isValidWithdrawalApprovals,
  normalizeDomain,
  normalizeSubdomain,
  normalizeTenantName,
  parseWithdrawalApprovals,
  tenantSelect,
} from "@/lib/tenant-api";

type TenantRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * 查询单个租户详情。
 * GET /api/tenants/[id]
 */
export async function GET(
  request: NextRequest,
  context: TenantRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id } = await context.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        ...tenantSelect,
        _count: {
          select: {
            players: true,
            agents: true,
            providerPoints: true,
            betRecords: true,
          },
        },
      },
    });

    if (!tenant) {
      return jsonError("租户不存在", 404);
    }

    return Response.json(
      { tenant },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取租户详情失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/**
 * 修改品牌名、域名、子域名、状态与出金审批人数。
 * PATCH 与 PUT 等价，仅更新请求体中出现的字段。
 */
async function updateTenant(
  request: NextRequest,
  context: TenantRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id } = await context.params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;

    const existing = await prisma.tenant.findUnique({
      where: { id },
      select: tenantSelect,
    });

    if (!existing) {
      return jsonError("租户不存在", 404);
    }

    const data: Prisma.TenantUpdateInput = {};

    if (hasOwn(input, "name")) {
      const name = normalizeTenantName(input.name);

      if (!name) {
        return jsonError("品牌名不能为空", 400);
      }

      if (name.length > 80) {
        return jsonError("品牌名不能超过 80 个字符", 400);
      }

      data.name = name;
    }

    if (hasOwn(input, "domain")) {
      const domain = normalizeDomain(input.domain);

      if (!domain) {
        return jsonError("域名不能为空", 400);
      }

      if (!DOMAIN_PATTERN.test(domain)) {
        return jsonError(
          "域名格式不正确，请填写类似 example.com 的完整域名",
          400,
        );
      }

      if (domain !== existing.domain.toLowerCase()) {
        const duplicate = await prisma.tenant.findFirst({
          where: {
            id: { not: id },
            domain: { equals: domain, mode: "insensitive" },
          },
          select: { id: true },
        });

        if (duplicate) {
          return jsonError("该域名已被其他租户使用", 409);
        }
      }

      data.domain = domain;
    }

    if (hasOwn(input, "subdomain")) {
      const subdomain = normalizeSubdomain(input.subdomain);

      if (!subdomain) {
        return jsonError("子域名不能为空", 400);
      }

      if (!SUBDOMAIN_PATTERN.test(subdomain)) {
        return jsonError(
          "子域名格式不正确，只需填写前缀，例如 winvora",
          400,
        );
      }

      if (subdomain !== existing.subdomain.toLowerCase()) {
        const duplicate = await prisma.tenant.findFirst({
          where: {
            id: { not: id },
            subdomain: { equals: subdomain, mode: "insensitive" },
          },
          select: { id: true },
        });

        if (duplicate) {
          return jsonError("该子域名已被其他租户使用", 409);
        }
      }

      data.subdomain = subdomain;
    }

    if (hasOwn(input, "status")) {
      if (!isTenantStatus(input.status)) {
        return jsonError("租户状态只能是 active、trial 或 suspended", 400);
      }

      data.status = input.status;
    }

    if (hasOwn(input, "withdrawalRequiredApprovals")) {
      const approvals = parseWithdrawalApprovals(
        input.withdrawalRequiredApprovals,
      );

      if (!isValidWithdrawalApprovals(approvals)) {
        return jsonError("出金审批人数只能是 1、2 或 3", 400);
      }

      data.withdrawalRequiredApprovals = approvals;
    }

    if (Object.keys(data).length === 0) {
      return jsonError("没有可更新的字段", 400);
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data,
      select: tenantSelect,
    });

    return Response.json({ success: true, tenant });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("域名或子域名已被其他租户使用", 409);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("租户不存在", 404);
    }

    console.error("更新租户失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function PATCH(
  request: NextRequest,
  context: TenantRouteContext,
) {
  return updateTenant(request, context);
}

export async function PUT(
  request: NextRequest,
  context: TenantRouteContext,
) {
  return updateTenant(request, context);
}

/**
 * 删除租户。
 *
 * 租户一旦产生玩家、代理、流水、出金或注单，就保留数据并返回 409，
 * 建议改为 suspended；空租户则连同租户管理员账号一并删除，避免孤儿登录账号。
 */
export async function DELETE(
  request: NextRequest,
  context: TenantRouteContext,
) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const { id } = await context.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            players: true,
            agents: true,
            transactions: true,
            withdrawals: true,
            betRecords: true,
          },
        },
      },
    });

    if (!tenant) {
      return jsonError("租户不存在", 404);
    }

    const businessRecords =
      tenant._count.players +
      tenant._count.agents +
      tenant._count.transactions +
      tenant._count.withdrawals +
      tenant._count.betRecords;

    if (businessRecords > 0) {
      return jsonError(
        `无法删除：租户「${tenant.name}」已有玩家、流水、出金或注单数据。请将状态改为 suspended 停用，而不是删除。`,
        409,
      );
    }

    await prisma.$transaction([
      prisma.adminUser.deleteMany({ where: { tenantId: id } }),
      prisma.tenant.delete({ where: { id } }),
    ]);

    return Response.json({ success: true, deletedId: id });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError(
        "无法删除：该租户仍有关联业务数据，请改为停用而不是删除",
        409,
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("租户不存在", 404);
    }

    console.error("删除租户失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

