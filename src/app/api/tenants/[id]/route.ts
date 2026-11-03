import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  readBackendIp,
  readCallbackUrl,
  readContactEmail,
  readWalletAddress,
} from "@/lib/integrations";
import {
  isThemeBackgroundId,
  THEME_BACKGROUND_IDS,
} from "@/lib/theme-backgrounds";
import { sendTenantAdminInviteEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import {
  TENANT_LOGO_POSITIONS,
  isTenantLogoPosition,
  normalizeStorefrontLayout,
  normalizeTenantLogoUrl,
  serializeLayoutConfig,
} from "@/lib/storefront";
import { getSuperAdminFromRequest } from "@/lib/super-admin";
import {
  listTenantAdmins,
  provisionTenantAdminAccount,
  readTenantAdminEmail,
} from "@/lib/tenant-admin-account";
import {
  DOMAIN_PATTERN,
  SUBDOMAIN_PATTERN,
  isTenantStatus,
  isValidWithdrawalApprovals,
  normalizeDomain,
  normalizeSubdomain,
  normalizeTenantName,
  parseWithdrawalApprovals,
  tenantSelectWithLayout,
  toTenantPayload,
} from "@/lib/tenant-api";
import {
  formatBackupDomainConflict,
  findBackupDomainConflict,
} from "@/lib/tenant-domain-service";
import { readBackupDomainsInput } from "@/lib/tenant-domains";

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
        ...tenantSelectWithLayout,
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

    const admins = await listTenantAdmins(id);

    return Response.json(
      { tenant: { ...toTenantPayload(tenant), admins } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取租户详情失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/**
 * 修改品牌名、域名、子域名、状态、出金审批人数与品牌 Logo。
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
      select: tenantSelectWithLayout,
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

    /**
     * 备用域名池（多域名防封自动切换）。
     *
     * - 传 `[]` / 空字符串 = 清空线路池；
     * - 这里只做格式 + 数量校验，跨租户唯一性交给 findBackupDomainConflict；
     * - 自己的主域名 / 子域名会被静默剔除（reserved），避免候选列表绕回自己。
     */
    if (hasOwn(input, "backupDomains")) {
      const nextDomain =
        typeof data.domain === "string" ? data.domain : existing.domain;
      const nextSubdomain =
        typeof data.subdomain === "string"
          ? data.subdomain
          : existing.subdomain;

      const parsed = readBackupDomainsInput(input.backupDomains, {
        reserved: [nextDomain, nextSubdomain],
      });

      if (!parsed.ok) {
        return jsonError(parsed.error, 400);
      }

      const conflict = await findBackupDomainConflict(parsed.domains, id);

      if (conflict) {
        return jsonError(formatBackupDomainConflict(conflict), 409);
      }

      data.backupDomains = { set: parsed.domains };
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

    /**
     * 品牌 Logo（白标）：**超管唯一写入口**就在这里。
     *
     * - 传 null / 空字符串 = 清空（前台自动退回商户名首字母占位）；
     * - 传值必须是 normalizeTenantLogoUrl 认可的结果（http(s) 绝对地址，或
     *   上传接口返回的 /api/tenant-logos/<uuid>.png 这种站内路径）；
     * - 商户后台没有任何写入口：/api/tenant/settings 的 PATCH 会显式忽略该字段，
     *   页面也不再渲染任何上传 / 修改控件（产品决策，见 AGENTS.md「品牌 Logo」）。
     */
    if (hasOwn(input, "logoUrl")) {
      if (input.logoUrl === null) {
        data.logoUrl = null;
      } else if (typeof input.logoUrl !== "string") {
        return jsonError("Logo 地址格式不正确", 400);
      } else {
        const trimmedLogoUrl = input.logoUrl.trim();

        if (!trimmedLogoUrl) {
          data.logoUrl = null;
        } else {
          const logoUrl = normalizeTenantLogoUrl(trimmedLogoUrl);

          if (!logoUrl) {
            return jsonError(
              "Logo 必须是 http(s) 开头的图片地址，或以 / 开头的站内路径（上传后的地址即为此格式）",
              400,
            );
          }

          data.logoUrl = logoUrl;
        }
      }
    }

    /**
     * Logo 显示位置（大厅顶栏）：left / center。
     *
     * 与 logoUrl 同一权限口径 —— 全系统唯一写入口就在这里（标量列，不进 layoutConfig），
     * 商户后台（saveTenantSiteSettings 的签名里没有它）构造请求也改不动。
     */
    if (hasOwn(input, "logoPosition")) {
      if (!isTenantLogoPosition(input.logoPosition)) {
        return jsonError(
          `Logo 显示位置只能是以下之一：${TENANT_LOGO_POSITIONS.join("、")}`,
          400,
        );
      }

      data.logoPosition = input.logoPosition;
    }

    /**
     * 主题背景色（Theme Background Color，15 选 1）。
     *
     * 权限决策：只有超管在【租户管理 → 新增 / 编辑】时能配，商户后台与装修页
     * 都不提供切换入口（/api/admin/storefront 与 /api/tenant/settings 的
     * 写白名单都已剔除该字段）。
     * 值存在 layoutConfig 里，因此只做「读旧 JSON → 覆盖这一个键 → 整体归一化」，
     * 不会把装修页配置的模块顺序 / 互动组件开关冲掉。
     */
    if (hasOwn(input, "themeBackground")) {
      if (!isThemeBackgroundId(input.themeBackground)) {
        return jsonError(
          `主题背景色只能是以下之一：${THEME_BACKGROUND_IDS.join("、")}`,
          400,
        );
      }

      const currentLayout = normalizeStorefrontLayout(existing.layoutConfig);

      data.layoutConfig = serializeLayoutConfig({
        ...currentLayout,
        themeBackground: input.themeBackground,
      });
    }

    // API 集成中心（/admin/integrations）的「编辑对接资料」弹窗：
    // 只允许改对接邮箱与商户专属回调地址，商户专属 API Key 走单独的
    // POST /api/admin/tenants/[id]/reset-key，避免普通编辑把密钥改坏。
    if (hasOwn(input, "contactEmail")) {
      const contactEmail = readContactEmail(input.contactEmail);

      if (contactEmail === null) {
        return jsonError("对接联系邮箱格式不正确", 400);
      }

      // 传空串表示清空（发密钥时会提示先补邮箱）。
      data.contactEmail = contactEmail || null;
    }

    if (hasOwn(input, "apiCallbackUrl")) {
      const apiCallbackUrl = readCallbackUrl(input.apiCallbackUrl);

      if (apiCallbackUrl === null) {
        return jsonError(
          "商户专属回调地址必须是 http:// 或 https:// 开头的完整地址",
          400,
        );
      }

      // 空串 = 沿用平台默认回调地址，不存空字符串，避免列表里出现空白项。
      data.apiCallbackUrl = apiCallbackUrl || null;
    }

    // API 集成中心「商户资料（Merchant Profiles）」：后台出口 IP + 结算钱包。
    // 两个字段都只是人工核对用的资料，不参与登录 / 结算计算，
    // 因此允许清空（空串 -> null），但仍做格式校验挡掉明显手误。
    if (hasOwn(input, "backendIp")) {
      const backendIp = readBackendIp(input.backendIp);

      if (backendIp === null) {
        return jsonError("Backend IP 必须是合法的 IPv4 / IPv6 地址或 CIDR 段", 400);
      }

      data.backendIp = backendIp || null;
    }

    if (hasOwn(input, "walletAddress")) {
      const walletAddress = readWalletAddress(input.walletAddress);

      if (walletAddress === null) {
        return jsonError(
          "Wallet 地址只能包含字母、数字与 : _ -，且长度不能超过 128 个字符",
          400,
        );
      }

      data.walletAddress = walletAddress || null;
    }

    // 分配商户管理员账号：只收邮箱，账号名 / 临时密码由服务端生成。
    // "" 表示本次不创建；非法格式直接 400，避免半保存。
    const adminEmail = readTenantAdminEmail(input.adminEmail);

    if (adminEmail === null) {
      return jsonError("商户管理员邮箱格式不正确", 400);
    }

    if (Object.keys(data).length === 0 && !adminEmail) {
      return jsonError("没有可更新的字段", 400);
    }

    const tenant =
      Object.keys(data).length > 0
        ? await prisma.tenant.update({
            where: { id },
            data,
            select: tenantSelectWithLayout,
          })
        : existing;

    let tenantAdmin:
      | {
          status: "created" | "exists" | "conflict" | "failed";
          username?: string;
          email?: string;
          temporaryPassword?: string;
          emailSent?: boolean;
          emailError?: string;
          message?: string;
        }
      | undefined;

    if (adminEmail) {
      const result = await provisionTenantAdminAccount({
        tenantId: id,
        email: adminEmail,
      });

      if (result.status === "created") {
        // 与「新增租户」保持一致：建号后立刻把登录地址与初始密码发到该邮箱。
        const emailResult = await sendTenantAdminInviteEmail({
          tenantName: tenant.name,
          email: result.account.email ?? adminEmail,
          username: result.account.username,
          password: result.temporaryPassword,
        });

        tenantAdmin = {
          status: "created",
          username: result.account.username,
          email: result.account.email ?? adminEmail,
          // 明文临时密码只在这里出现一次，数据库只存 bcrypt 哈希。
          temporaryPassword: result.temporaryPassword,
          emailSent: emailResult.ok,
          ...(emailResult.ok ? {} : { emailError: emailResult.error }),
        };
      } else if (result.status === "exists") {
        tenantAdmin = {
          status: "exists",
          username: result.account.username,
          email: result.account.email ?? adminEmail,
          message: "该邮箱已是本租户的管理员账号，本次未重置密码",
        };
      } else {
        // 冲突 / 失败不阻断租户资料保存：返回 200 + 提示，由弹窗展示。
        tenantAdmin = { status: result.status, message: result.message };
      }
    }

    const admins = await listTenantAdmins(id);

    return Response.json({
      success: true,
      tenant: { ...toTenantPayload(tenant), admins },
      ...(tenantAdmin ? { tenantAdmin } : {}),
    });
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

