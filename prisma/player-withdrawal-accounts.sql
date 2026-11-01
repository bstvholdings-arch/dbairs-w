-- 玩家提现账号（全球法币 / 加密货币）增量脚本（幂等，可重复执行）
-- 对应 prisma/schema.prisma 中的 model PlayerWithdrawalAccount
-- 与 `npx prisma db push` 生成的结构一致；CLI 连不上库时可直接执行本文件：
--   npx prisma db execute --file prisma/player-withdrawal-accounts.sql
--   然后再 npx prisma generate

CREATE TABLE IF NOT EXISTS "PlayerWithdrawalAccount" (
  "id"            TEXT         NOT NULL,
  "playerId"      TEXT         NOT NULL,
  "tenantId"      TEXT         NOT NULL,
  "currency"      TEXT         NOT NULL,
  "network"       TEXT         NOT NULL DEFAULT '',
  "accountType"   TEXT         NOT NULL DEFAULT 'crypto',
  "walletAddress" TEXT,
  "bankName"      TEXT,
  "accountNumber" TEXT,
  "accountName"   TEXT,
  "isDefault"     BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerWithdrawalAccount_pkey" PRIMARY KEY ("id")
);

-- 索引名与 Prisma 的默认命名保持一致（<Model>_<field1>_<field2>_key），
-- 这样之后执行 db push 时不会重复建索引、也不会提示 schema 漂移。
-- 唯一键用 [playerId, currency, network]：同一玩家同一「币种 + 网络」只留一条，
-- 法币账号的 network 存空串（Postgres 里 NULL 不参与唯一比较）。
CREATE UNIQUE INDEX IF NOT EXISTS "PlayerWithdrawalAccount_playerId_currency_network_key"
  ON "PlayerWithdrawalAccount" ("playerId", "currency", "network");

CREATE INDEX IF NOT EXISTS "PlayerWithdrawalAccount_tenantId_createdAt_idx"
  ON "PlayerWithdrawalAccount" ("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "PlayerWithdrawalAccount_playerId_isDefault_idx"
  ON "PlayerWithdrawalAccount" ("playerId", "isDefault");

-- 外键：删玩家 / 删租户时账号一起清掉，和 Prisma 的 onDelete: Cascade 对齐。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PlayerWithdrawalAccount_playerId_fkey'
  ) THEN
    ALTER TABLE "PlayerWithdrawalAccount"
      ADD CONSTRAINT "PlayerWithdrawalAccount_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PlayerWithdrawalAccount_tenantId_fkey'
  ) THEN
    ALTER TABLE "PlayerWithdrawalAccount"
      ADD CONSTRAINT "PlayerWithdrawalAccount_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
