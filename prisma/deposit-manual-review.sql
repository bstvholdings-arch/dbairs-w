-- 充值订单的人工审核字段（静态码 / 银行转账专用）
--
-- 资金安全红线：STATIC_QR（商户自己的收款码）与 BANK_TRANSFER（玩家转账到商户银行账户）
-- 这两类通道的钱直接进商户自己的银行账户，系统拿不到「支付商已收款」的机器凭证。
-- 因此它们**永不自动上分**：
--   收到「已付款」信号 → status 仍是 pending + manualReviewStatus=pending；
--   商户在 /tenant/deposits 核对银行流水 → 点【确认到账】才写余额与流水。
--
-- callbackAmount / callbackTxHash / callbackReceivedAt 存回调凭证，供人工核对与事后对账。
-- 幂等：可重复执行（IF NOT EXISTS）。
-- 用法：npm run db:sql prisma/deposit-manual-review.sql
ALTER TABLE "DepositOrder"
  ADD COLUMN IF NOT EXISTS "manualReviewStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "callbackAmount" DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS "callbackTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "callbackReceivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "DepositOrder_tenantId_manualReviewStatus_idx"
  ON "DepositOrder" ("tenantId", "manualReviewStatus");
