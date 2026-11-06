-- Telegram Bot 多群组接入（1 个 Bot 服务多个商户群 + 平台内部群）
-- 幂等：可重复执行；全部是「加成」（可空列 / 新表 / 新索引），不影响任何既有数据。
-- 本机执行：npx tsx scripts/apply-sql.ts prisma/telegram-bot.sql
-- 之后必须跑一次 npx prisma generate，让 Prisma Client 拿到新字段 / 新模型。

-- 1. 商户专属群：一个商户只能绑 1 个群，一个群也只能属于 1 个商户。
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_telegramChatId_key"
  ON "Tenant"("telegramChatId");

-- 2. 平台内部群：只挂在平台账号上（tenantId 为 NULL 且 role = super_admin 才认）。
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_telegramChatId_key"
  ON "AdminUser"("telegramChatId");

-- 3. AI 日志加群归属：群聊历史按「同一个群 + 同一位助手」隔离，
--    否则平台内部群的 /finance 会读到后台 AI 控制台的财务对话。
ALTER TABLE "AiChatLog" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;
CREATE INDEX IF NOT EXISTS "AiChatLog_telegramChatId_agentType_createdAt_idx"
  ON "AiChatLog"("telegramChatId", "agentType", "createdAt");

-- 4. 群会话状态（当前助手 / 上下文起点 / 幂等水位）。
CREATE TABLE IF NOT EXISTS "TelegramChatSession" (
  "chatId" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'tenant',
  "tenantId" TEXT,
  "agentType" TEXT NOT NULL DEFAULT 'support',
  "contextStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdateId" BIGINT,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramChatSession_pkey" PRIMARY KEY ("chatId")
);

CREATE INDEX IF NOT EXISTS "TelegramChatSession_tenantId_idx"
  ON "TelegramChatSession"("tenantId");

-- 外键：租户删除时连带清掉群会话状态（幂等：已存在则跳过）。
DO $$
BEGIN
  ALTER TABLE "TelegramChatSession"
    ADD CONSTRAINT "TelegramChatSession_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
