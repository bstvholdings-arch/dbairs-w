import "dotenv/config";

import bcrypt from "bcryptjs";

import { syncProviderGames } from "../src/lib/game-sync";
import { prisma } from "../src/lib/prisma";

const ADMIN_USERNAME = "admin";
const ADMIN_EMAIL = "admin@dbairs.local";

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
      email: ADMIN_EMAIL,
      role: "super_admin",
      tenantId: null,
    },
    create: {
      username: ADMIN_USERNAME,
      passwordHash,
      email: ADMIN_EMAIL,
      role: "super_admin",
      tenantId: null,
    },
  });

  console.log(
    `超级管理员已就绪: ${admin.username} (${admin.role}) | 找回密码邮箱: ${admin.email ?? "未设置"}`,
  );

  // 写库后立刻自检，确认数据库里存的确实是 admin123，而不是手误写错的密码。
  const passwordVerified = await bcrypt.compare("admin123", admin.passwordHash);

  console.log(
    `密码自检 bcrypt.compare("admin123", hash) = ${passwordVerified} | hash 前缀 = ${admin.passwordHash.slice(0, 7)} 长度 = ${admin.passwordHash.length}`,
  );

  if (!passwordVerified) {
    throw new Error("密码写入后自检失败：数据库中的哈希与 admin123 不匹配。");
  }

  // 大厅品牌墙演示数据：保证前台的 PROVIDER SHOWCASE 至少能横向排满 5 家品牌，
  // 手机端只露出约 1.5 张、桌面端一屏 4~5 张（布局见 components/lobby/provider-wall.tsx）。
  //
  // 只补齐「缺失」的游戏商，并给新建的游戏商同步演示游戏（品牌墙上的游戏数 / 在线人数来自这里）；
  // 已存在的游戏商一律不覆盖名称、点数、排序与上下架状态，避免 seed 冲掉后台配置。
  const demoProviders = [
    {
      name: "scr888h5",
      upstreamPoint: 0.93,
      platformMarkup: 0.03,
      downstreamPoint: 0.9,
      sortOrder: 100,
    },
    {
      name: "PG Soft",
      upstreamPoint: 0.94,
      platformMarkup: 0.02,
      downstreamPoint: 0.92,
      sortOrder: 90,
    },
    {
      name: "Evo888",
      upstreamPoint: 0.95,
      platformMarkup: 0.02,
      downstreamPoint: 0.93,
      sortOrder: 80,
    },
    {
      name: "Joker",
      upstreamPoint: 0.94,
      platformMarkup: 0.02,
      downstreamPoint: 0.92,
      sortOrder: 70,
    },
    {
      name: "FastSpin",
      upstreamPoint: 0.93,
      platformMarkup: 0.03,
      downstreamPoint: 0.9,
      sortOrder: 60,
    },
  ];

  for (const demo of demoProviders) {
    const existing = await prisma.gameProvider.findUnique({
      where: { name: demo.name },
      select: { id: true },
    });

    if (existing) {
      continue;
    }

    const provider = await prisma.gameProvider.create({
      data: demo,
      select: { id: true, name: true },
    });

    // 复用后台「同步游戏」的同一套逻辑：新品牌立刻有游戏数 / 在线人数，品牌墙不会显示 0 款。
    const syncResult = await syncProviderGames(provider.id);

    console.log(
      `示例游戏商已创建: ${provider.name}（sortOrder ${demo.sortOrder}，同步 ${syncResult.created} 款游戏）`,
    );
  }

  // AI 中控台的演示线索：只在空表时写入，避免每次 seed 覆盖线上跟进状态。
  // failReason 与 AI 工具写入格式一致（5 字以内），看板才能正确归桶。
  const leadCount = await prisma.leadRecord.count();

  if (leadCount === 0) {
    const sampleLeads = [
      {
        tgOrEmail: "@stellar_bd",
        brandName: "星辰体育",
        status: "failed",
        failReason: "价格贵",
      },
      {
        tgOrEmail: "bd@nova-sports.com",
        brandName: "Nova Sports",
        status: "failed",
        failReason: "没流量",
      },
      {
        tgOrEmail: "@ocean_partner",
        brandName: "OceanBet",
        status: "failed",
        failReason: "怕黑台",
      },
      {
        tgOrEmail: "ops@lucky7.io",
        brandName: "Lucky7",
        status: "failed",
        failReason: "不信任",
      },
      {
        tgOrEmail: "@apex_gaming",
        brandName: "Apex Gaming",
        status: "failed",
        failReason: "不会推",
      },
      {
        tgOrEmail: "bd@royal-casino.com",
        brandName: "Royal Casino",
        status: "failed",
        failReason: "抽成高",
      },
      {
        tgOrEmail: "@bluewave_bd",
        brandName: "BlueWave",
        status: "pending",
        failReason: null,
      },
      {
        tgOrEmail: "hello@titanbet.com",
        brandName: "TitanBet",
        status: "pending",
        failReason: null,
      },
      {
        tgOrEmail: "@golden_lion",
        brandName: "Golden Lion",
        status: "success",
        failReason: null,
      },
    ];

    await prisma.leadRecord.createMany({
      data: sampleLeads,
      skipDuplicates: true,
    });

    console.log(`示例线索已创建: ${sampleLeads.length} 条（战败 / 跟进中 / 已成交）`);
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

