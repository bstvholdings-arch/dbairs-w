import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    /**
     * 这份配置**只服务 CLI**（db push / migrate / studio），运行时连接串在
     * src/lib/prisma.ts（走 PrismaPg 驱动适配器），两者互不影响。
     *
     * 为什么优先 DIRECT_URL：Supabase 的 DATABASE_URL 是 pgbouncer 连接池（:6543），
     * schema engine 在连接池上推表结构会**无输出挂死**（实测 >3 分钟无响应），
     * 换直连（:5432）同一份改动 8 秒完成。没有 DIRECT_URL 的环境（CI / 本地直连库）
     * 自动回落 DATABASE_URL，行为不变。
     */
    url: process.env.DIRECT_URL?.trim() || env("DATABASE_URL"),
  },
});
