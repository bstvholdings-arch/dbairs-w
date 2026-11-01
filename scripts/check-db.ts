/**
 * 数据库连接自检：`npm run db:check`
 *
 * 会把 DATABASE_URL 打码打印出来（不暴露密码），然后真的连一次库；
 * 认证失败、Supabase 熔断（ECIRCUITBREAKER）等常见错误会直接给出处理建议。
 * 只读：不写任何数据，也不改 .env。
 */
import { config } from "dotenv";
import pg from "pg";

import {
  maskDatabaseUrl,
  normalizeDatabaseUrl,
} from "../src/lib/database-url";

config();

const raw = process.env.DATABASE_URL;

if (!raw) {
  console.error("✗ 没有找到 DATABASE_URL，请检查项目根目录的 .env。");
  process.exit(1);
}

const connectionString = normalizeDatabaseUrl(raw);

function describeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN";
}

function adviceFor(code: string, message: string): string[] {
  const lower = message.toLowerCase();

  if (lower.includes("circuitbreaker")) {
    return [
      "Supabase 的 Supavisor 在连续收到错误密码后，会临时封禁新的连接（ECIRCUITBREAKER）。",
      "先确认 .env 里的密码正确，再等几分钟重试；这期间别反复重试，否则封禁会一直续期。",
    ];
  }

  if (
    code === "28P01" ||
    (lower.includes("password") && lower.includes("not valid"))
  ) {
    return [
      "数据库密码不被接受（这是 .env 的问题，不是前端 hydration 问题）。",
      "Supabase → Project Settings → Database → Reset database password，",
      "再到 Connect 面板复制最新的 Prisma 连接串，覆盖 .env 的 DATABASE_URL（直连串给 DIRECT_URL）。",
      "改完重启 npm run dev，左下角的 issues 也会一起消失。",
    ];
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return [
      "域名解析失败：检查网络 / VPN，或确认 Supabase 项目没有被暂停。",
    ];
  }

  if (code === "ECONNREFUSED" || code === "ETIMEDOUT") {
    return [
      "端口不可达：检查网络、防火墙，以及连接串端口（连接池 6543 / 直连 5432）。",
    ];
  }

  if (code === "3D000") {
    return ["连接串里的数据库名不存在（Supabase 一般是 /postgres）。"];
  }

  if (lower.includes("certificate")) {
    return [
      "TLS 证书校验失败：检查代理 / VPN 是否替换了证书。",
      "若确实需要放行，可在连接串显式追加 sslmode=require（安全性会低于 verify-full）。",
    ];
  }

  return ["请对照上方错误码检查 .env 与数据库状态；本脚本只读，不会修改数据。"];
}

async function main() {
  console.log(`DATABASE_URL = ${maskDatabaseUrl(connectionString)}`);

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();

    const result = await client.query<{
      user: string;
      database: string;
      server_version: string;
    }>(
      'select current_user as "user", current_database() as "database", current_setting(\'server_version\') as "server_version"',
    );

    console.log("✓ 数据库连接成功:", result.rows[0]);
    return 0;
  } catch (error) {
    const code = describeErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);

    console.error(`✗ 数据库连接失败 [${code}] ${message}`);

    for (const line of adviceFor(code, message)) {
      console.error(`  → ${line}`);
    }

    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error("✗ 自检脚本自身出错:", error);
    process.exitCode = 1;
  });
