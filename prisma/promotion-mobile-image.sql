-- 活动海报「双图分离」：电脑端海报（imageUrl）+ 手机端海报（mobileImageUrl，可选）。
--
-- 执行（本机已确认 prisma db push 会卡在 shadow database 上，按仓库惯例走幂等 SQL）：
--   npx tsx scripts/apply-sql.ts prisma/promotion-mobile-image.sql
--
-- 特性：
-- - 幂等：ADD COLUMN IF NOT EXISTS，重复执行无副作用；
-- - 纯增量：只在 PromotionBanner 上加一个可空列，不重建表、不动任何历史数据
--   （历史活动全部为 NULL → 手机端自动回落成「电脑图模糊底 + 完整显示」）；
-- - 回滚：ALTER TABLE "PromotionBanner" DROP COLUMN IF EXISTS "mobileImageUrl";
--
-- 说明：列必须可空。手机图是可选素材，商户只传一张电脑图时前端要能整条链路跑通，
-- 所以不能用 NOT NULL DEFAULT ''（空串会绕过「没配手机图」的判断）。

ALTER TABLE "PromotionBanner"
  ADD COLUMN IF NOT EXISTS "mobileImageUrl" TEXT;
