/**
 * 红利类型白名单 —— **客户端安全模块**：不引 prisma、不引任何服务端依赖。
 *
 * 取值必须与 `prisma/schema.prisma` 的 `enum BonusCampaignType` 完全一致。
 * 商户后台的「新建 / 编辑红利活动」下拉框与 `bonus-campaigns.ts` 的入参校验
 * 共用这一份：加类型时只改这里（+ schema enum），不会出现
 * 「后台能选、服务端 400」，也不会出现「服务端认、后台选不到」。
 */
export const BONUS_CAMPAIGN_TYPES = [
  "register",
  "deposit",
  "first_deposit",
] as const;

export type BonusCampaignTypeId = (typeof BONUS_CAMPAIGN_TYPES)[number];
