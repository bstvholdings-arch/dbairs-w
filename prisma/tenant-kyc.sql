-- KYC 实名认证增量脚本（幂等，可重复执行）
-- 对应 prisma/schema.prisma 的 enum KycStatus + model PlayerKyc。
-- 与 `npx prisma db push` 生成的表结构一致；CLI 连不上库时可直接用本文件建表：
--   npx prisma db execute --file prisma/tenant-kyc.sql
--   然后再 npx prisma generate

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KycStatus') THEN
    CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "PlayerKyc" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "realName" TEXT NOT NULL,
  "idNumber" TEXT NOT NULL,
  "idCardFrontUrl" TEXT NOT NULL,
  "idCardBackUrl" TEXT NOT NULL,
  "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
  "rejectReason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerKyc_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerKyc_playerId_key"
  ON "PlayerKyc" ("playerId");

CREATE INDEX IF NOT EXISTS "PlayerKyc_tenantId_status_createdAt_idx"
  ON "PlayerKyc" ("tenantId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "PlayerKyc_tenantId_createdAt_idx"
  ON "PlayerKyc" ("tenantId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlayerKyc_tenantId_fkey') THEN
    ALTER TABLE "PlayerKyc"
      ADD CONSTRAINT "PlayerKyc_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlayerKyc_playerId_fkey') THEN
    ALTER TABLE "PlayerKyc"
      ADD CONSTRAINT "PlayerKyc_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlayerKyc_reviewedById_fkey') THEN
    ALTER TABLE "PlayerKyc"
      ADD CONSTRAINT "PlayerKyc_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "AdminUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
