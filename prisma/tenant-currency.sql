-- 租户记账货币（Tenant.currency）：玩家钱包余额 / 提现 / 统计金额的统一币种。
-- 幂等：重复执行不会报错，也不会覆盖后台已经改过的值。
-- 与 prisma/schema.prisma 的 `currency String @default("MYR")` 保持一致；
-- 正常执行 `npx prisma db push` 会自动建列，本文件用于只跑 SQL 的部署环境。

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'MYR';

-- 可选：把历史上默认按马币展示的租户显式落成 MYR（新列默认值已经是 MYR，这里只是兜底空值）
UPDATE "Tenant"
SET "currency" = 'MYR'
WHERE "currency" IS NULL OR btrim("currency") = '';
