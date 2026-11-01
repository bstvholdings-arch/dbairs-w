import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { normalizeDatabaseUrl } from "@/lib/database-url";

// 连接串先过一层规范化：剥掉复制时带进来的引号/空格，
// 并给 Supabase 连接池补上 sslmode=require（详见 lib/database-url.ts）。
const rawConnectionString = process.env.DATABASE_URL;

if (!rawConnectionString) {
  throw new Error(
    "缺少 DATABASE_URL 环境变量，无法初始化 Prisma Client。请检查项目根目录的 .env 文件。",
  );
}

const connectionString = normalizeDatabaseUrl(rawConnectionString);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
