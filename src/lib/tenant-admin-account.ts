import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

import { prisma } from "./prisma";
import { TENANT_ROLE } from "./rbac";

/**
 * 超管在「新增 / 编辑租户」弹窗里分配商户管理员账号（tenant_admin）。
 *
 * 约定：
 * - 邮箱是唯一输入：账号名由邮箱本地部分派生（全局唯一，冲突自动加序号）；
 * - 密码由服务端随机生成，只在创建成功时返回一次明文，数据库只存 bcrypt 哈希；
 * - 绝不覆盖别人的账号：邮箱若已属于其他租户 / 平台员工，直接报告冲突；
 * - 支持传入 Prisma 事务客户端，让「建租户 + 建账号」落在同一个事务里。
 */

// 邮箱校验与前端共用一份实现（src/lib/tenant-admin-email.ts 不依赖 prisma）。
export {
  TENANT_ADMIN_EMAIL_MAX_LENGTH,
  TENANT_ADMIN_EMAIL_PATTERN,
  isValidTenantAdminEmail,
  readTenantAdminEmail,
} from "./tenant-admin-email";

/** 与 AdminUser.username / bcrypt 的口径保持一致。 */
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const PASSWORD_LENGTH = 14;
const BCRYPT_ROUNDS = 10;

/** Prisma 客户端或交互式事务客户端：两者都提供 adminUser 读写。 */
type TenantAdminDbClient = typeof prisma | Prisma.TransactionClient;


export type TenantAdminBadge = {
  id: string;
  username: string;
  email: string | null;
};

/** 一次性临时密码：大小写 + 数字 + 符号，14 位，剔除易混淆字符（0/O、1/l/I）。 */
export function generateTenantAdminPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";

  const pools = [upper, lower, digits, symbols];
  const chars: string[] = [
    upper[randomInt(upper.length)],
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    lower[randomInt(lower.length)],
    digits[randomInt(digits.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];

  while (chars.length < PASSWORD_LENGTH) {
    const pool = pools[randomInt(pools.length)];
    chars.push(pool[randomInt(pool.length)]);
  }

  // Fisher–Yates 洗牌，避免「前几位永远是固定类目」的规律。
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }

  return chars.join("");
}

/** 邮箱本地部分 → 合法账号名（3–32 位字母数字与 . _ -）。 */
function usernameBaseFromEmail(email: string) {
  const local = email.split("@")[0] ?? "";
  const slug = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .slice(0, 24);

  const base = slug.length >= 3 ? slug : `tadmin-${slug}`.replace(/-$/, "");

  return USERNAME_PATTERN.test(base)
    ? base
    : `tadmin${randomInt(9000) + 1000}`;
}

/** 找一个全局未被占用的账号名：base、base-2、base-3 … */
async function findAvailableUsername(
  base: string,
  client: TenantAdminDbClient,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;

    if (!USERNAME_PATTERN.test(candidate)) {
      continue;
    }

    const taken = await client.adminUser.findUnique({
      where: { username: candidate },
      select: { id: true },
    });

    if (!taken) {
      return candidate;
    }
  }

  return `tadmin${Date.now().toString(36).slice(-6)}`;
}

/** 批量读取租户的管理员账号，供租户列表展示「是否已分配」。 */
export async function listTenantAdminAccounts(tenantIds: string[]) {
  const map = new Map<string, TenantAdminBadge[]>();

  if (tenantIds.length === 0) {
    return map;
  }

  const accounts = await prisma.adminUser.findMany({
    where: { role: TENANT_ROLE, tenantId: { in: tenantIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, email: true, tenantId: true },
  });

  for (const account of accounts) {
    if (!account.tenantId) {
      continue;
    }

    const bucket = map.get(account.tenantId) ?? [];
    bucket.push({
      id: account.id,
      username: account.username,
      email: account.email,
    });
    map.set(account.tenantId, bucket);
  }

  return map;
}

/** 单个租户的管理员账号列表。 */
export async function listTenantAdmins(tenantId: string) {
  const map = await listTenantAdminAccounts([tenantId]);
  return map.get(tenantId) ?? [];
}

export type TenantAdminProvisionResult =
  | {
      status: "created";
      account: TenantAdminBadge;
      temporaryPassword: string;
    }
  | { status: "exists"; account: TenantAdminBadge }
  | { status: "conflict"; message: string }
  | { status: "failed"; message: string };

/**
 * 为租户创建（或幂等返回已有）管理员账号。
 *
 * - 邮箱已是本租户的管理员 → 返回 exists，不重置密码；
 * - 邮箱属于其他租户 / 平台员工 → 返回 conflict，绝不改动别人的账号；
 * - 其余情况创建 tenant_admin，并返回一次性临时密码。
 */
export async function provisionTenantAdminAccount(
  input: {
    tenantId: string;
    email: string;
  },
  /**
   * 传 Prisma 事务客户端时，「建租户 + 建账号」会落在同一个事务里一起提交 / 回滚。
   * 不传则直接用全局 prisma 客户端（编辑租户时单独补账号的场景）。
   */
  client: TenantAdminDbClient = prisma,
): Promise<TenantAdminProvisionResult> {
  const email = input.email.trim().toLowerCase();

  try {
    const existing = await client.adminUser.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        tenantId: true,
      },
    });

    if (existing) {
      if (
        existing.role === TENANT_ROLE &&
        existing.tenantId === input.tenantId
      ) {
        return {
          status: "exists",
          account: {
            id: existing.id,
            username: existing.username,
            email: existing.email,
          },
        };
      }

      return {
        status: "conflict",
        message:
          existing.role === TENANT_ROLE
            ? "该邮箱已绑定为其他商户的管理员账号，请换一个邮箱"
            : "该邮箱已被平台账号占用，请换一个邮箱",
      };
    }

    const username = await findAvailableUsername(
      usernameBaseFromEmail(email),
      client,
    );
    const temporaryPassword = generateTenantAdminPassword();

    const created = await client.adminUser.create({
      data: {
        username,
        email,
        passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
        role: TENANT_ROLE,
        tenantId: input.tenantId,
      },
      select: { id: true, username: true, email: true },
    });

    console.info(
      `[tenant-admin] 已为租户 ${input.tenantId} 创建管理员 ${created.username}（${created.email}）`,
    );

    return { status: "created", account: created, temporaryPassword };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // 并发下用户名 / 邮箱被抢占：让调用方重试一次即可拿到准确结果。
      return {
        status: "failed",
        message: "账号名或邮箱刚被占用，请重新保存一次",
      };
    }

    console.error("创建商户管理员账号失败:", error);
    return { status: "failed", message: "创建商户管理员账号失败，请稍后重试" };
  }
}
