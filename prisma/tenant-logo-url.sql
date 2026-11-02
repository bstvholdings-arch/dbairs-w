-- 玩家大厅顶部白标品牌：商户 Logo 图片地址
-- 幂等：可重复执行；可空列，不影响任何既有数据。
-- 本机执行：npx tsx scripts/apply-sql.ts prisma/tenant-logo-url.sql
-- 之后必须跑一次 npx prisma generate，让 Prisma Client 拿到新字段。
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
