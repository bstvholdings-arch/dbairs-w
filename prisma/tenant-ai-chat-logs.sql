-- 商户后台「AI 客服监控」增量脚本（可重复执行）
--
-- 为什么需要它：
-- 历史 AiChatLog 只服务平台侧（销冠 AI / 技术 / 财务助手），没有租户字段，
-- 商户后台无法按租户隔离读取玩家与 AI 客服的对话。本脚本给它补上
-- tenantId / playerId 两列（全部可为空，不破坏已有 6 条平台日志）。
--
-- 执行方式：
--   npx prisma db execute --file prisma/tenant-ai-chat-logs.sql
--   npx prisma generate

ALTER TABLE "AiChatLog"
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "AiChatLog"
  ADD COLUMN IF NOT EXISTS "playerId" TEXT;

CREATE INDEX IF NOT EXISTS "AiChatLog_tenantId_createdAt_idx"
  ON "AiChatLog"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiChatLog_playerId_createdAt_idx"
  ON "AiChatLog"("playerId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiChatLog_tenantId_fkey'
  ) THEN
    ALTER TABLE "AiChatLog"
      ADD CONSTRAINT "AiChatLog_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiChatLog_playerId_fkey'
  ) THEN
    ALTER TABLE "AiChatLog"
      ADD CONSTRAINT "AiChatLog_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
