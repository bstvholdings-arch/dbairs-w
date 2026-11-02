-- API 集成中心（Tab 版）增量脚本（幂等，可重复执行）
-- 对应 prisma/schema.prisma 中的：
--   1) GameProvider.apiEndpoint / merchantId / apiSecret   ← Game Providers 页签
--   2) Tenant.backendIp / walletAddress                    ← Merchant Profiles 页签
-- 与 `npx prisma db push` 生成的结构一致；CLI 连不上库时可直接执行本文件：
--   npx prisma db execute --file prisma/integration-center.sql
--   然后再 npx prisma generate

-- 1. 游戏商对接凭据（全部可空：老游戏商升级后保持「未填写」状态，
--    由超管在 /admin/integrations → Game Providers 里补录，不需要数据回填）。
ALTER TABLE "GameProvider" ADD COLUMN IF NOT EXISTS "apiEndpoint" TEXT;
ALTER TABLE "GameProvider" ADD COLUMN IF NOT EXISTS "merchantId" TEXT;
ALTER TABLE "GameProvider" ADD COLUMN IF NOT EXISTS "apiSecret" TEXT;

-- 2. 下游商户资料（同样可空，避免影响已上线租户）。
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "backendIp" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "walletAddress" TEXT;
