-- 玩家大厅顶栏：Logo 显示位置（left = 左侧品牌区 / center = 屏幕正中央）
-- 幂等：可重复执行；带默认值的新列，不影响任何既有数据（老租户自动 = left，外观不变）。
-- 本机执行：npx tsx scripts/apply-sql.ts prisma/tenant-logo-position.sql
-- 之后必须跑一次 npx prisma generate，让 Prisma Client 拿到新字段。
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "logoPosition" TEXT NOT NULL DEFAULT 'left';
