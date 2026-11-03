-- 多域名防封：备用域名池（Tenant.backupDomains，数组）
-- 幂等：可重复执行；有默认空数组，不影响任何既有数据。
-- 本机执行：npx tsx scripts/apply-sql.ts prisma/tenant-backup-domains.sql
-- （Supabase 连接池上 `npx prisma db push` 常卡在 shadow database，所以按仓库惯例用幂等 SQL）
-- 之后必须跑一次 npx prisma generate，让 Prisma Client 拿到新字段。
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "backupDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
