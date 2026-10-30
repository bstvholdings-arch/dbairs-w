import "dotenv/config";

import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma";

const ADMIN_USERNAME = "admin";

function getDatabaseHost(connectionString: string) {
  try {
    return new URL(connectionString).host;
  } catch {
    return "(无法解析 DATABASE_URL)";
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "缺少 DATABASE_URL 环境变量，请确认项目根目录的 .env 中已配置。",
    );
  }

  // 只打印主机名和端口，不输出账号密码，便于排查 ECONNREFUSED。
  console.log(`正在连接数据库: ${getDatabaseHost(connectionString)}`);

  // 强制使用 bcrypt.hash("admin123", 10)：每次 seed 都生成新的盐，覆盖旧密码。
  const passwordHash = await bcrypt.hash("admin123", 10);

  // 使用 upsert，重复执行不会因 username 唯一约束报错
  const admin = await prisma.adminUser.upsert({
    where: { username: ADMIN_USERNAME },
    update: {
      passwordHash,
      role: "super_admin",
      tenantId: null,
    },
    create: {
      username: ADMIN_USERNAME,
      passwordHash,
      role: "super_admin",
      tenantId: null,
    },
  });

  console.log(`超级管理员已就绪: ${admin.username} (${admin.role})`);

  // 写库后立刻自检，确认数据库里存的确实是 admin123，而不是手误写错的密码。
  const passwordVerified = await bcrypt.compare("admin123", admin.passwordHash);

  console.log(
    `密码自检 bcrypt.compare("admin123", hash) = ${passwordVerified} | hash 前缀 = ${admin.passwordHash.slice(0, 7)} 长度 = ${admin.passwordHash.length}`,
  );

  if (!passwordVerified) {
    throw new Error("密码写入后自检失败：数据库中的哈希与 admin123 不匹配。");
  }

  // 首次初始化时给后台一个可直接编辑的示例游戏商，避免游戏商管理页空白。
  const providerCount = await prisma.gameProvider.count();

  if (providerCount === 0) {
    const provider = await prisma.gameProvider.create({
      data: {
        name: "PG Soft",
        upstreamPoint: 0.94,
        platformMarkup: 0.02,
        downstreamPoint: 0.92,
      },
    });

    console.log(
      `示例游戏商已创建: ${provider.name} (上游 ${provider.upstreamPoint.toString()}, 平台加点 ${provider.platformMarkup.toString()})`,
    );
  }
}

main()
  .catch((error) => {
    console.error("初始化超级管理员失败:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

