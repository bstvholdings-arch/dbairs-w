-- 自动出款（Auto Payout）与人工兜底：新增 3 个字段 + 1 条索引
-- 幂等：可重复执行；全部是可空列或有默认值的列，老数据零影响
--   - 老提现单：riskStatus = NULL（历史数据）、isAuto = false（历史上全是人工）
--   - 老网关：payoutEndpoint = NULL → 一律判定「没有代付 API」→ 全部走人工审核（fail-closed）
-- 本机执行：npx tsx scripts/apply-sql.ts prisma/auto-payout.sql
-- 之后必须跑一次 npx prisma generate，让 Prisma Client 拿到新字段。
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "autoPayoutConfig" JSONB;

ALTER TABLE "PaymentGateway"
  ADD COLUMN IF NOT EXISTS "payoutEndpoint" TEXT;

ALTER TABLE "Withdrawal"
  ADD COLUMN IF NOT EXISTS "riskStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "isAuto" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Withdrawal_tenantId_isAuto_createdAt_idx"
  ON "Withdrawal" ("tenantId", "isAuto", "createdAt");
