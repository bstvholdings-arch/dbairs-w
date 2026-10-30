import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

const tenantSelect = {
  id: true,
  name: true,
  domain: true,
  subdomain: true,
  status: true,
  withdrawalRequiredApprovals: true,
  createdAt: true,
} satisfies Prisma.TenantSelect;

// 域名允许用户粘贴完整 URL，入库前统一为小写 host。
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function normalizeSubdomain(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: tenantSelect,
    });

    return Response.json(
      { tenants },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取租户列表失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;

    const name =
      typeof input.name === "string"
        ? input.name.trim().replace(/\s+/g, " ")
        : "";
    const domain = normalizeDomain(
      typeof input.domain === "string" ? input.domain : "",
    );
    const subdomain = normalizeSubdomain(
      typeof input.subdomain === "string" ? input.subdomain : "",
    );
    const rawApprovals = input.withdrawalRequiredApprovals;
    const withdrawalRequiredApprovals =
      typeof rawApprovals === "number" || typeof rawApprovals === "string"
        ? Number(rawApprovals)
        : Number.NaN;

    if (!name) {
      return jsonError("品牌名不能为空", 400);
    }

    if (name.length > 80) {
      return jsonError("品牌名不能超过 80 个字符", 400);
    }

    if (!domain) {
      return jsonError("域名不能为空", 400);
    }

    if (!DOMAIN_PATTERN.test(domain)) {
      return jsonError(
        "域名格式不正确，请填写类似 example.com 的完整域名",
        400,
      );
    }

    if (!subdomain) {
      return jsonError("子域名不能为空", 400);
    }

    if (!SUBDOMAIN_PATTERN.test(subdomain)) {
      return jsonError(
        "子域名格式不正确，只需填写前缀，例如 winvora",
        400,
      );
    }

    if (
      !Number.isInteger(withdrawalRequiredApprovals) ||
      withdrawalRequiredApprovals < 1 ||
      withdrawalRequiredApprovals > 3
    ) {
      return jsonError("出金审批人数只能是 1、2 或 3", 400);
    }

    const [domainExists, subdomainExists] = await Promise.all([
      prisma.tenant.findFirst({
        where: { domain: { equals: domain, mode: "insensitive" } },
        select: { id: true },
      }),
      prisma.tenant.findFirst({
        where: { subdomain: { equals: subdomain, mode: "insensitive" } },
        select: { id: true },
      }),
    ]);

    if (domainExists) {
      return jsonError("该域名已被其他租户使用", 409);
    }

    if (subdomainExists) {
      return jsonError("该子域名已被其他租户使用", 409);
    }

    // 当前创建弹窗未包含套餐选择。优先关联现有最便宜的套餐；
    // 如果系统尚未配置套餐，则写入占位值，后续可在套餐模块中重新分配。
    const defaultPlan = await prisma.plan.findFirst({
      orderBy: { monthlyFee: "asc" },
      select: { id: true },
    });

    const tenant = await prisma.tenant.create({
      data: {
        name,
        domain,
        subdomain,
        withdrawalRequiredApprovals,
        planId: defaultPlan?.id ?? "unassigned",
      },
      select: tenantSelect,
    });

    return Response.json({ success: true, tenant }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("域名或子域名已被其他租户使用", 409);
    }

    console.error("创建租户失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
