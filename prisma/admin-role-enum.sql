-- 修复既有数据库漂移：AdminUser.role 从 TEXT 转成 schema.prisma 声明的 AdminRole 枚举。
--
-- 背景：schema 里 role 是 enum AdminRole，但远端库是 TEXT 且没有该枚举类型，
-- 导致 prisma seed / 登录写入报 `type "public.AdminRole" does not exist`。
-- 本脚本可重复执行，且不会丢失现有角色值（只接受合法枚举值）。
--
-- 执行方式：
--   npx prisma db execute --file prisma/admin-role-enum.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdminRole') THEN
    CREATE TYPE "AdminRole" AS ENUM (
      'super_admin',
      'finance',
      'tech',
      'support',
      'tenant_admin'
    );
  END IF;
END
$$;

ALTER TABLE "AdminUser" ALTER COLUMN "role" DROP DEFAULT;

DO $$
BEGIN
  IF (
    SELECT udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AdminUser'
      AND column_name = 'role'
  ) <> 'AdminRole' THEN
    ALTER TABLE "AdminUser"
      ALTER COLUMN "role" TYPE "AdminRole"
      USING "role"::"AdminRole";
  END IF;
END
$$;

ALTER TABLE "AdminUser"
  ALTER COLUMN "role" SET DEFAULT 'support'::"AdminRole";
