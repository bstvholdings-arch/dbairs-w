-- 活动大厅（Promotions）增量脚本（幂等，可重复执行）
-- 对应 prisma/schema.prisma 的 model PromotionCategory / model PromotionBanner。
-- 与 `npx prisma db push` 生成的表结构一致；CLI 连不上库时可直接用本文件建表：
--   npx prisma db execute --file prisma/promotions.sql
--   然后再 npx prisma generate

CREATE TABLE IF NOT EXISTS "PromotionCategory" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PromotionCategory_tenantId_name_key"
  ON "PromotionCategory" ("tenantId", "name");

CREATE INDEX IF NOT EXISTS "PromotionCategory_tenantId_sortOrder_idx"
  ON "PromotionCategory" ("tenantId", "sortOrder");

CREATE TABLE IF NOT EXISTS "PromotionBanner" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "title" TEXT,
  "linkUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionBanner_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PromotionBanner_tenantId_isActive_sortOrder_idx"
  ON "PromotionBanner" ("tenantId", "isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS "PromotionBanner_categoryId_sortOrder_idx"
  ON "PromotionBanner" ("categoryId", "sortOrder");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromotionCategory_tenantId_fkey') THEN
    ALTER TABLE "PromotionCategory"
      ADD CONSTRAINT "PromotionCategory_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromotionBanner_tenantId_fkey') THEN
    ALTER TABLE "PromotionBanner"
      ADD CONSTRAINT "PromotionBanner_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromotionBanner_categoryId_fkey') THEN
    ALTER TABLE "PromotionBanner"
      ADD CONSTRAINT "PromotionBanner_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "PromotionCategory"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
