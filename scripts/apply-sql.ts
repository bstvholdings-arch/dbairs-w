/**
 * 一次性执行 prisma/*.sql（本机开发用）：
 *   npx tsx scripts/apply-sql.ts prisma/tenant-currency.sql
 *
 * 为什么需要它：`npx prisma db push` 在 Supabase 连接池（6543 端口）上经常
 * 卡在 shadow database 这一步；只补一个可空 / 有默认值的列时，直接跑幂等 SQL
 * 更快，之后再 `npx prisma generate` 让客户端拿到新字段即可。
 */
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";

import { normalizeDatabaseUrl } from "../src/lib/database-url";

config();

const file = process.argv[2];

if (!file) {
  console.error("用法：npx tsx scripts/apply-sql.ts prisma/xxx.sql");
  process.exit(1);
}

const raw = process.env.DATABASE_URL;

if (!raw) {
  console.error("✗ 没有找到 DATABASE_URL，请检查项目根目录的 .env。");
  process.exit(1);
}

async function main() {
  const sql = await readFile(file, "utf8");
  const client = new pg.Client({
    connectionString: normalizeDatabaseUrl(raw!),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log(`✓ 已执行 ${file}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error("✗ 执行失败，已回滚：", error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
