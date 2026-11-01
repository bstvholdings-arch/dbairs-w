/**
 * 创建 / 重置商户老板账号（tenant_admin）。
 *
 * 商户账号不能通过 /admin/staff 创建（那里只允许平台员工角色），
 * 所以用这个脚本给某个租户开一个能登录 /tenant 后台的账号。
 *
 * 用法：
 *   npx tsx scripts/create-tenant-admin.ts --tenant winvora --username boss --password 'ChangeMe#2026'
 *   npx tsx scripts/create-tenant-admin.ts --tenant winvora --username boss --password 'ChangeMe#2026' \
 *     --phone +60123456789 --email boss@winvora.com
 *
 * 参数：
 *   --tenant   租户 id / 域名 / 子域名 / 品牌名，四选一精确匹配
 *   --username 登录账号（全局唯一）
 *   --password 登录密码（至少 8 位）
 *   --phone    选填，联系手机号（E.164，如 +60123456789）；同一租户内唯一
 *   --email    选填，联系邮箱；同一租户内唯一（另外全局也有 @unique 兜底）
 *
 * 行为：
 * - 账号不存在 → 新建 tenant_admin，并绑定到该租户；
 * - 账号已存在且是同一租户的 tenant_admin → 只重置密码（可用于找回）；
 * - 账号已存在但角色 / 租户不同 → 直接报错退出，绝不悄悄改别人的账号。
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma";

function readArg(name: string) {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? (process.argv[index + 1] ?? "").trim() : "";
}

async function main() {
  const tenantKey = readArg("tenant");
  const username = readArg("username");
  const password = readArg("password");
  const phoneArg = readArg("phone").replace(/[\s()\-.]/g, "");
  const emailArg = readArg("email").toLowerCase();
  const phone = phoneArg
    ? phoneArg.startsWith("+")
      ? phoneArg
      : `+${phoneArg}`
    : "";

  if (!tenantKey || !username || !password) {
    console.error(
      "用法: npx tsx scripts/create-tenant-admin.ts --tenant <id|域名|子域名|品牌名> --username <账号> --password <密码> [--phone +60...] [--email ...]",
    );
    return 1;
  }

  if (password.length < 8) {
    console.error("✗ 密码至少 8 位");
    return 1;
  }

  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
    console.error("✗ 手机号需为 E.164 格式，如 +60123456789");
    return 1;
  }

  if (emailArg && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailArg)) {
    console.error("✗ 邮箱格式不正确");
    return 1;
  }

  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { id: tenantKey },
        { domain: tenantKey.toLowerCase() },
        { subdomain: tenantKey.toLowerCase() },
        { name: tenantKey },
      ],
    },
    select: { id: true, name: true, subdomain: true, status: true },
  });

  if (!tenant) {
    console.error(`✗ 找不到租户「${tenantKey}」`);
    return 1;
  }

  const existing = await prisma.adminUser.findUnique({
    where: { username },
    select: { id: true, role: true, tenantId: true },
  });

  if (existing) {
    if (existing.role !== "tenant_admin" || existing.tenantId !== tenant.id) {
      console.error(
        `✗ 账号「${username}」已存在，且角色 / 归属不同（role=${existing.role}, tenantId=${existing.tenantId ?? "null"}），已终止。`,
      );
      return 1;
    }

    await prisma.adminUser.update({
      where: { id: existing.id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });

    console.log(
      `✓ 已重置商户账号密码: ${username}（${tenant.name} / ${tenant.subdomain}）`,
    );
    return 0;
  }

  await prisma.adminUser.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role: "tenant_admin",
      tenantId: tenant.id,
      ...(phone ? { phone } : {}),
      ...(emailArg ? { email: emailArg } : {}),
    },
  });

  console.log(
    `✓ 已创建商户账号: ${username} → ${tenant.name}（${tenant.subdomain}，状态 ${tenant.status}）`,
  );
  console.log("  登录页: /tenant/login（独立商户入口），登录后会被送到 /tenant/dashboard");

  return 0;
}

main()
  .then(async (code) => {
    process.exitCode = code;
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("✗ 脚本执行失败:", error);
    process.exitCode = 1;
    await prisma.$disconnect();
  });
