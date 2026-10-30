-- AI 中控台增量建表脚本（可重复执行）
--
-- 为什么不直接 `prisma db push`：
-- 历史数据库的 "AdminUser"."role" 是 TEXT，而 schema.prisma 里是 AdminRole 枚举，
-- db push 会 DROP COLUMN + 重建，属于破坏性变更。先用 prisma/admin-role-enum.sql
-- 幂等补齐枚举（保留现有角色值），再用本脚本补 AI 三张新表。
-- 两个脚本执行完后 `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
-- 应输出「No difference detected」。
--
-- 执行方式：
--   npx prisma db execute --file prisma/admin-role-enum.sql
--   npx prisma db execute --file prisma/ai-console.sql

CREATE TABLE IF NOT EXISTS "LeadRecord" (
  "id" TEXT NOT NULL,
  "tgOrEmail" TEXT NOT NULL,
  "brandName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "failReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeadRecord_tgOrEmail_brandName_key"
  ON "LeadRecord"("tgOrEmail", "brandName");
CREATE INDEX IF NOT EXISTS "LeadRecord_status_updatedAt_idx"
  ON "LeadRecord"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "LeadRecord_failReason_idx"
  ON "LeadRecord"("failReason");

CREATE TABLE IF NOT EXISTS "AiChatLog" (
  "id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "agentType" TEXT NOT NULL DEFAULT 'sales',
  "leadId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiChatLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiChatLog_agentType_createdAt_idx"
  ON "AiChatLog"("agentType", "createdAt");
CREATE INDEX IF NOT EXISTS "AiChatLog_leadId_createdAt_idx"
  ON "AiChatLog"("leadId", "createdAt");

CREATE TABLE IF NOT EXISTS "AiAgentConfig" (
  "id" TEXT NOT NULL,
  "agentType" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "tactics" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAgentConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiAgentConfig_agentType_key"
  ON "AiAgentConfig"("agentType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiChatLog_leadId_fkey'
  ) THEN
    ALTER TABLE "AiChatLog"
      ADD CONSTRAINT "AiChatLog_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "LeadRecord"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
