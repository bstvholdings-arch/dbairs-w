/**
 * 洗码品类白名单 —— **客户端安全模块**：不引 prisma、不引任何服务端依赖。
 *
 * 为什么要单独一个文件：服务端结算（`rebate-config.ts` / `rebate-settlement.ts`）
 * 和商户后台【洗码返水】页面必须用**同一份**品类清单与顺序。
 * 若让客户端直接 import `rebate-config.ts`，`@prisma/client` 会被打进浏览器包；
 * 若让两边各抄一份，新加品类时就会出现「后台列得出来、结算不认」的错位。
 *
 * 因此唯一事实来源放在这里：`rebate-config.ts` 从这里 import 再 re-export，
 * 老的 `import { REBATE_CATEGORIES } from "@/lib/rebate-config"` 写法继续有效。
 */
export const REBATE_CATEGORIES = [
  "slot",
  "live",
  "sport",
  "poker",
  "fish",
  "cockfight",
  "esport",
] as const;

export type RebateCategoryId = (typeof REBATE_CATEGORIES)[number];
