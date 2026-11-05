-- 商户开户国家（Tenant.country）增量迁移
--
-- 产品口径（不可回退）：本平台只做**本国法币**生意 ——
-- 开站时超管选一个国家，结算币种（Tenant.currency）就被锁定为该国的法币：
--   马来西亚 MY → MYR、泰国 TH → THB、印尼 ID → IDR、越南 VN → VND、
--   新加坡 SG → SGD、印度 IN → INR、澳洲 AU → AUD、香港 HK → HKD、美国 US → USD。
-- 唯一映射表：src/lib/tenant-country.ts 的 TENANT_COUNTRIES（改表 = 改一处）。
--
-- 本脚本做两件事（幂等，可重复执行）：
--   1. 补列 country（NOT NULL DEFAULT 'MY'，与 Prisma schema 一致）；
--   2. 按**已有记账币种**回填国家，避免老租户出现「国家对 MY、币种却是 THB」的错配
--      （否则超管在编辑弹窗里点保存就会被改币种）。
--
-- 顺序：先 `npx prisma db push`（或本脚本第 1 段），再执行本脚本回填。
-- 用法：npm run db:sql prisma/tenant-country.sql
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'MY';

UPDATE "Tenant" SET "country" = 'TH' WHERE "currency" = 'THB' AND "country" <> 'TH';
UPDATE "Tenant" SET "country" = 'ID' WHERE "currency" = 'IDR' AND "country" <> 'ID';
UPDATE "Tenant" SET "country" = 'VN' WHERE "currency" = 'VND' AND "country" <> 'VN';
UPDATE "Tenant" SET "country" = 'SG' WHERE "currency" = 'SGD' AND "country" <> 'SG';
UPDATE "Tenant" SET "country" = 'IN' WHERE "currency" = 'INR' AND "country" <> 'IN';
UPDATE "Tenant" SET "country" = 'AU' WHERE "currency" = 'AUD' AND "country" <> 'AU';
UPDATE "Tenant" SET "country" = 'HK' WHERE "currency" = 'HKD' AND "country" <> 'HK';
UPDATE "Tenant" SET "country" = 'US' WHERE "currency" = 'USD' AND "country" <> 'US';
UPDATE "Tenant" SET "country" = 'MY' WHERE "currency" = 'MYR' AND "country" <> 'MY';
