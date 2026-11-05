-- 通道费率 + 充值手续费账本（商户对账用，幂等）
--
-- 背景（AGENTS.md §14）：包网平台绝不碰资金，只做精准账本。
--   1. PaymentGateway.feeRate      —— 商户自己填的通道费率（百分比，2 = 2%）；
--   2. DepositOrder.feeAmount      —— 通道手续费 = amount × feeRate ÷ 100；
--   3. DepositOrder.actualReceived —— 商户实际到账 = amount − feeAmount。
-- 玩家余额永远只加 amount，一分钱都不扣（本迁移只加列 + 回填展示口径）。
--
-- 执行：npm run db:sql prisma/gateway-fee-rate.sql
-- 之后：npx prisma generate && 重启 dev server（旧的内存客户端看不到新字段）

ALTER TABLE "PaymentGateway"
  ADD COLUMN IF NOT EXISTS "feeRate" DECIMAL(6,4) NOT NULL DEFAULT 0;

ALTER TABLE "DepositOrder"
  ADD COLUMN IF NOT EXISTS "feeAmount" DECIMAL(18,6) NOT NULL DEFAULT 0;

ALTER TABLE "DepositOrder"
  ADD COLUMN IF NOT EXISTS "actualReceived" DECIMAL(18,6) NOT NULL DEFAULT 0;

-- 历史订单回填：本功能上线前的单没有手续费概念，实际入账即订单金额。
-- 只动「两个字段都还是 0」的行：功能上线后的单一定会写 actualReceived（费率 0 时等于 amount），
-- 所以重跑这段 SQL 不会把「费率 100% 导致的实际到账 0」误改成全额。
UPDATE "DepositOrder"
   SET "actualReceived" = "amount"
 WHERE "actualReceived" = 0
   AND "feeAmount" = 0
   AND "amount" > 0;
