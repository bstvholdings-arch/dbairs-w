-- API 与集成中心增量脚本（幂等，可重复执行）
-- 对应 prisma/schema.prisma 中的：
--   1) Tenant.contactEmail / apiCallbackUrl / apiKey / apiKeyUpdatedAt
--   2) model IntegrationIpWhitelist
-- 与 `npx prisma db push` 生成的结构一致；CLI 连不上库时可直接执行本文件：
--   npx prisma db execute --file prisma/integrations.sql
--   然后再 npx prisma generate

-- 1. 商户对接资料（区域 D）
-- 三个新字段都可空：老租户升级后保持「未填写对接邮箱 / 未生成密钥」状态，
-- 由超管在 /admin/integrations 里补录，不需要数据回填。
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "apiCallbackUrl" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "apiKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "apiKeyUpdatedAt" TIMESTAMP(3);

-- 2. 全局 IP 白名单（区域 B）
CREATE TABLE IF NOT EXISTS "IntegrationIpWhitelist" (
  "id"        TEXT         NOT NULL,
  "ip"        TEXT         NOT NULL,
  "note"      TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationIpWhitelist_pkey" PRIMARY KEY ("id")
);

-- 索引名与 Prisma 的默认命名保持一致，之后 db push 不会重复建索引或提示 schema 漂移。
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationIpWhitelist_ip_key"
  ON "IntegrationIpWhitelist" ("ip");

CREATE INDEX IF NOT EXISTS "IntegrationIpWhitelist_createdAt_idx"
  ON "IntegrationIpWhitelist" ("createdAt");
