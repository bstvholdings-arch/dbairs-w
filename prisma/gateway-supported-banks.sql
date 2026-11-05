-- 网银跳转（REDIRECT_URL）充值通道的「支持银行」列表
--
-- 玩家收银台（大厅充值弹窗）在 REDIRECT_URL 通道下渲染银行卡片：
--   玩家选银行 → 下单 → 服务端把 bank=<code> 拼到支付商跳转地址上。
-- 因此这个列表必须与后端校验同源（src/lib/payment-gateway-banks.ts）：
--   提交的银行不在列表里一律 400，绝不信任前端。
--
-- 幂等：可重复执行（IF NOT EXISTS + 默认空数组）。
-- 用法：npm run db:sql prisma/gateway-supported-banks.sql
ALTER TABLE "PaymentGateway"
  ADD COLUMN IF NOT EXISTS "supportedBanks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
