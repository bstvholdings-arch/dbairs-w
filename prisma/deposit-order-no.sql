-- 充值订单号（orderNo）增量脚本（幂等，可重复执行）
-- 对应 prisma/schema.prisma 中 model DepositOrder 的 orderNo 字段。
--
-- 为什么需要它：真实支付商回调只会带回「商户订单号」，不会带本系统的 uuid 主键。
-- 订单号格式 DEP_<毫秒时间戳>_<6 位十六进制随机>，由 src/lib/deposit-order.ts 生成。
--
-- 历史数据：列允许 NULL，老订单继续用主键 id 回查，不会因为唯一索引冲突而失败。
--
-- 与 `npx prisma db push` 生成的结构一致；CLI 连不上库时可直接执行本文件：
--   npx prisma db execute --file prisma/deposit-order-no.sql
--   然后再 npx prisma generate

ALTER TABLE "DepositOrder" ADD COLUMN IF NOT EXISTS "orderNo" TEXT;

-- 索引名与 Prisma 的默认命名保持一致（<Model>_<field>_key），
-- 这样之后执行 db push 时不会重复建索引、也不会提示 schema 漂移。
CREATE UNIQUE INDEX IF NOT EXISTS "DepositOrder_orderNo_key"
  ON "DepositOrder" ("orderNo");
