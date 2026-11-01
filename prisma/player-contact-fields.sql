-- 玩家 / 后台账号「手机号 + 邮箱」增量脚本（幂等，可重复执行）
-- 对应 prisma/schema.prisma 中：
--   Player.phone    + @@unique([tenantId, phone])
--   AdminUser.phone + @@unique([tenantId, phone]) + @@unique([tenantId, email])
-- 与 `npx prisma db push` 生成的结构一致；CLI 连不上库时可直接执行本文件：
--   npx prisma db execute --file prisma/player-contact-fields.sql
--   然后再 npx prisma generate

ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- 索引名与 Prisma 的默认命名保持一致（<Model>_<field1>_<field2>_key），
-- 这样之后执行 db push 时不会重复建索引、也不会提示 schema 漂移。
CREATE UNIQUE INDEX IF NOT EXISTS "Player_tenantId_email_key"
  ON "Player" ("tenantId", "email");

CREATE UNIQUE INDEX IF NOT EXISTS "Player_tenantId_phone_key"
  ON "Player" ("tenantId", "phone");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_tenantId_email_key"
  ON "AdminUser" ("tenantId", "email");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_tenantId_phone_key"
  ON "AdminUser" ("tenantId", "phone");
