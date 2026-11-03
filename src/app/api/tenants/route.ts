import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  DEFAULT_THEME_BACKGROUND,
  isThemeBackgroundId,
  THEME_BACKGROUND_IDS,
} from "@/lib/theme-backgrounds";
import { sendTenantAdminInviteEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { TENANT_ROLE } from "@/lib/rbac";
import {
  normalizeStorefrontLayout,
  serializeLayoutConfig,
} from "@/lib/storefront";
import { getSuperAdminFromRequest } from "@/lib/super-admin";
import {
  provisionTenantAdminAccount,
  readTenantAdminEmail,
  type TenantAdminProvisionResult,
} from "@/lib/tenant-admin-account";
import {
  tenantSelectWithLayout,
  toTenantPayload,
  type TenantSelectRow,
} from "@/lib/tenant-api";

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
      select: tenantSelectWithLayout,
    });

    return Response.json(
      // 只把 layoutConfig 里的 themeBackground 抽出来，整份装修配置不外泄
      { tenants: tenants.map(toTenantPayload) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取租户列表失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/** 事务内主动中止创建：Prisma 会连带回滚刚写入的租户记录。 */
class TenantRegistrationAbort extends Error {}

type TenantAdminCreated = Extract<
  TenantAdminProvisionResult,
  { status: "created" }
>;

type CreateTenantWithAdminResult =
  | {
      ok: true;
      tenant: TenantSelectRow;
      provision: TenantAdminCreated;
    }
  | { ok: false; message: string };

/**
 * 同一个事务里完成「建租户 + 建商户管理员账号」。
 *
 * 账号创建失败（邮箱 / 账号名被并发抢占等）时主动抛异常让事务回滚，
 * 绝不留下「租户建好了，但没有任何账号能登录」的孤儿数据。
 */
async function createTenantWithAdmin(input: {
  name: string;
  domain: string;
  subdomain: string;
  withdrawalRequiredApprovals: number;
  planId: string;
  adminEmail: string;
  /** 开站时选定的主题背景色（写进 layoutConfig，前台大厅与品牌展馆共用） */
  layoutConfig: ReturnType<typeof serializeLayoutConfig>;
}): Promise<CreateTenantWithAdminResult> {
  try {
    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.name,
          domain: input.domain,
          subdomain: input.subdomain,
          withdrawalRequiredApprovals: input.withdrawalRequiredApprovals,
          planId: input.planId,
          layoutConfig: input.layoutConfig,
        },
        select: tenantSelectWithLayout,
      });

      const provision = await provisionTenantAdminAccount(
        { tenantId: tenant.id, email: input.adminEmail },
        tx,
      );

      if (provision.status !== "created") {
        throw new TenantRegistrationAbort(
          provision.status === "failed"
            ? provision.message
            : "该邮箱已绑定其他账号，请换一个邮箱后重试",
        );
      }

      return { tenant, provision };
    });

    return { ok: true, ...created };
  } catch (error) {
    if (error instanceof TenantRegistrationAbort) {
      return { ok: false, message: error.message };
    }

    throw error;
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

    // 商户管理员邮箱在本流程里是必填：建租户的同时要建 tenant_admin 账号并发送登录邮件。
    const adminEmail = readTenantAdminEmail(input.adminEmail);

    if (adminEmail === null) {
      return jsonError(
        "商户管理员邮箱格式不正确，请填写类似 boss@brand.com 的邮箱",
        400,
      );
    }

    if (!adminEmail) {
      return jsonError(
        "商户管理员邮箱不能为空：系统需要用它创建商户账号并发送登录邮件",
        400,
      );
    }

    // 开站时选定的主题背景色：显式传了就必须合法（避免脏数据落到前台），
    // 不传则用默认的经典暗黑（= 改造前的大厅观感）。
    const rawThemeBackground = input.themeBackground;

    if (
      rawThemeBackground !== undefined &&
      !isThemeBackgroundId(rawThemeBackground)
    ) {
      return jsonError(
        `主题背景色只能是以下之一：${THEME_BACKGROUND_IDS.join("、")}`,
        400,
      );
    }

    const themeBackground = isThemeBackgroundId(rawThemeBackground)
      ? rawThemeBackground
      : DEFAULT_THEME_BACKGROUND;

    const [domainExists, subdomainExists, emailOwner] = await Promise.all([
      prisma.tenant.findFirst({
        where: { domain: { equals: domain, mode: "insensitive" } },
        select: { id: true },
      }),
      prisma.tenant.findFirst({
        where: { subdomain: { equals: subdomain, mode: "insensitive" } },
        select: { id: true },
      }),
      prisma.adminUser.findFirst({
        where: { email: { equals: adminEmail, mode: "insensitive" } },
        select: { id: true, role: true },
      }),
    ]);

    if (domainExists) {
      return jsonError("该域名已被其他租户使用", 409);
    }

    if (subdomainExists) {
      return jsonError("该子域名已被其他租户使用", 409);
    }

    // AdminUser.email 是全局唯一键：先提前拦一次，避免白跑一个事务。
    if (emailOwner) {
      return jsonError(
        emailOwner.role === TENANT_ROLE
          ? "该邮箱已绑定为其他商户的管理员账号，请换一个邮箱"
          : "该邮箱已被平台账号占用，请换一个邮箱",
        409,
      );
    }

    // 当前创建弹窗未包含套餐选择。优先关联现有最便宜的套餐；
    // 如果系统尚未配置套餐，则写入占位值，后续可在套餐模块中重新分配。
    const defaultPlan = await prisma.plan.findFirst({
      orderBy: { monthlyFee: "asc" },
      select: { id: true },
    });

    const created = await createTenantWithAdmin({
      name,
      domain,
      subdomain,
      withdrawalRequiredApprovals,
      planId: defaultPlan?.id ?? "unassigned",
      adminEmail,
      // 只写这一项，其余装修字段由 normalizeStorefrontLayout 补默认值，
      // 与「老租户缺字段」走同一套容错逻辑。
      layoutConfig: serializeLayoutConfig(
        normalizeStorefrontLayout({ themeBackground }),
      ),
    });

    if (!created.ok) {
      return jsonError(created.message, 409);
    }

    // 邮件在事务提交之后发送：发信失败不影响已经落库的租户与账号，
    // 弹窗仍会展示一次性临时密码，超管可以手动发给商户。
    const emailResult = await sendTenantAdminInviteEmail({
      tenantName: created.tenant.name,
      email: adminEmail,
      username: created.provision.account.username,
      password: created.provision.temporaryPassword,
    });

    return Response.json(
      {
        success: true,
        tenant: {
          ...toTenantPayload(created.tenant),
          admins: [created.provision.account],
        },
        tenantAdmin: {
          status: "created",
          username: created.provision.account.username,
          email: created.provision.account.email ?? adminEmail,
          // 明文临时密码只在这里出现一次，数据库只存 bcrypt 哈希。
          temporaryPassword: created.provision.temporaryPassword,
          emailSent: emailResult.ok,
          ...(emailResult.ok ? {} : { emailError: emailResult.error }),
        },
      },
      { status: 201 },
    );
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
