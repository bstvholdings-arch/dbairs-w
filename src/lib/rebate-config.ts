import { Prisma } from "@prisma/client";

import {
  REBATE_CATEGORIES,
  type RebateCategoryId,
} from "./rebate-categories";

/**
 * 洗码（返水）配置的唯一事实来源。
 *
 * 存储：`Tenant.rebateConfig`（JSON 列，无需迁移加表）：
 *
 *   {
 *     "version": 1,
 *     "categories": {
 *       "slot":      { "ratePercent": 0.5, "isActive": true },
 *       "live":      { "ratePercent": 0.3, "isActive": false }
 *     }
 *   }
 *
 * 三条硬规则：
 * 1. `ratePercent` 是**真百分比**（0.5 = 0.5%），不是小数倍率；
 *    结算公式是 turnover × ratePercent / 100，别再乘 100。
 * 2. 读侧一律先过 `normalizeRebateConfig()`：null / 脏数据 / 缺字段 / 老租户
 *    一律视为「该品类关闭 + 费率 0」（fail-closed）。宁可少发钱，不能因为一个
 *    undefined 把全站流水按 100% 返出去。
 * 3. 品类白名单只认 `REBATE_CATEGORIES`，与 `Game.category` /
 *    `BetRecord.gameCategory` 用同一套 id；未知品类直接丢弃。
 */

/** 洗码品类白名单（客户端安全模块 rebate-categories.ts，与 Game.category 同一套 id） */
export { REBATE_CATEGORIES };
export type { RebateCategoryId };

export type RebateCategoryConfig = {
  /** 真百分比，0.5 = 0.5% */
  ratePercent: number;
  /** 该品类是否参与每日洗码（关闭 = 该品类流水一律不结算） */
  isActive: boolean;
};

export type RebateConfig = {
  version: 1;
  categories: Record<RebateCategoryId, RebateCategoryConfig>;
};

export const REBATE_CONFIG_VERSION = 1;

/**
 * 单品类费率上限：5%。
 * 洗码是「按流水返水」，费率一旦被填成 50，玩家随便对打就能掏空商户，
 * 所以这里做硬上限。
 */
export const REBATE_MAX_RATE_PERCENT = 5;

/** 费率小数位：0.0001%（够精确，又不至于让 JSON 里出现浮点长尾） */
export const REBATE_RATE_DECIMALS = 4;

/** 结算最小起付额（本站记账币种，默认 0.01 = 一分钱）：小于它的零头不落单 */
export const REBATE_MIN_PAYOUT = new Prisma.Decimal("0.01");

const ZERO = new Prisma.Decimal(0);

export function isRebateCategoryId(value: unknown): value is RebateCategoryId {
  return (
    typeof value === "string" &&
    (REBATE_CATEGORIES as readonly string[]).includes(value)
  );
}

/** 全部关闭、费率 0 的空配置（新建租户 / JSON 为空时的默认值） */
export function createDefaultRebateConfig(): RebateConfig {
  const categories = {} as Record<RebateCategoryId, RebateCategoryConfig>;

  for (const category of REBATE_CATEGORIES) {
    categories[category] = { ratePercent: 0, isActive: false };
  }

  return { version: REBATE_CONFIG_VERSION, categories };
}

/** 读费率：只接受 0 ≤ n ≤ REBATE_MAX_RATE_PERCENT 的有限数字，其余返回 null */
function readRatePercent(value: unknown): number | null {
  const rate =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(rate) || rate < 0 || rate > REBATE_MAX_RATE_PERCENT) {
    return null;
  }

  return Number(rate.toFixed(REBATE_RATE_DECIMALS));
}

/**
 * 把任意来源的 `Tenant.rebateConfig` 归一化成可用配置。
 *
 * fail-closed：任何读不懂的值（null / 字符串 / 负数 / NaN / 超上限 / 非布尔开关）
 * 都退回「0 费率 + 关闭」，绝不猜测商户意图。
 */
export function normalizeRebateConfig(value: unknown): RebateConfig {
  const config = createDefaultRebateConfig();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return config;
  }

  const rawCategories = (value as Record<string, unknown>).categories;

  if (
    !rawCategories ||
    typeof rawCategories !== "object" ||
    Array.isArray(rawCategories)
  ) {
    return config;
  }

  for (const category of REBATE_CATEGORIES) {
    const raw = (rawCategories as Record<string, unknown>)[category];

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }

    const entry = raw as Record<string, unknown>;
    const rate = readRatePercent(entry.ratePercent);

    // 费率非法 → 整个品类当关闭（不保留「开了但费率为 0」的假开关）
    if (rate === null) {
      continue;
    }

    config.categories[category] = {
      ratePercent: rate,
      isActive: entry.isActive === true,
    };
  }

  return config;
}
/** 该品类是否真的会发洗码：开关打开 **且** 费率 > 0（两者缺一都不结算） */
export function isRebateCategoryEnabled(
  config: RebateConfig,
  category: RebateCategoryId,
): boolean {
  const entry = config.categories[category];

  return Boolean(entry && entry.isActive && entry.ratePercent > 0);
}

/** 取该品类生效费率（关闭时返回 0，调用方不需要再判开关） */
export function rebateRateOf(
  config: RebateConfig,
  category: RebateCategoryId,
): number {
  return isRebateCategoryEnabled(config, category)
    ? config.categories[category].ratePercent
    : 0;
}

/** 当前参与结算的品类（结算任务只用这份列表查流水） */
export function activeRebateCategories(
  config: RebateConfig,
): RebateCategoryId[] {
  return REBATE_CATEGORIES.filter((category) =>
    isRebateCategoryEnabled(config, category),
  );
}

/**
 * 洗码金额 = 流水 × 费率% 。
 * 法币只到「分」，所以统一四舍五入到 2 位小数（与提现手续费同一口径）。
 */
export function calculateRebateAmount(
  turnover: Prisma.Decimal.Value,
  ratePercent: number,
): Prisma.Decimal {
  const base = new Prisma.Decimal(turnover);

  if (base.lte(0) || ratePercent <= 0) {
    return ZERO;
  }

  return base
    .mul(ratePercent)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export type RebateConfigInputResult =
  | { ok: true; value: RebateConfig }
  | { ok: false; error: string; status: number };

/**
 * 商户后台保存配置的解析器。
 *
 * 与读侧不同，这里**不 fail-closed**：输入错了就 400 让商户改，
 * 免得「填了 8% 却被静默改成 5% / 0%」这种更难受的情况。
 * 只接受白名单品类，未知品类直接忽略（不报错，兼容前端多传）。
 */
export function parseRebateConfigInput(body: unknown): RebateConfigInputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "请求体格式错误", status: 400 };
  }

  const rawCategories = (body as Record<string, unknown>).categories;

  if (
    !rawCategories ||
    typeof rawCategories !== "object" ||
    Array.isArray(rawCategories)
  ) {
    return { ok: false, error: "缺少品类配置", status: 400 };
  }

  const config = createDefaultRebateConfig();

  for (const category of REBATE_CATEGORIES) {
    const raw = (rawCategories as Record<string, unknown>)[category];

    if (raw === undefined || raw === null) {
      continue;
    }

    if (typeof raw !== "object" || Array.isArray(raw)) {
      return {
        ok: false,
        error: `品类 ${category} 的配置格式错误`,
        status: 400,
      };
    }

    const entry = raw as Record<string, unknown>;
    const rate = readRatePercent(entry.ratePercent);

    if (rate === null) {
      return {
        ok: false,
        error: `品类 ${category} 的费率必须是 0 - ${REBATE_MAX_RATE_PERCENT} 之间的百分比（0.5 表示 0.5%）`,
        status: 400,
      };
    }

    const isActive = entry.isActive === true;

    // 开了开关却没填费率 = 记录在案的「发不出去的洗码」，直接拒绝，
    // 避免商户以为已上线、玩家却一分钱收不到。
    if (isActive && rate <= 0) {
      return {
        ok: false,
        error: `品类 ${category} 已开启洗码，费率必须大于 0`,
        status: 400,
      };
    }

    config.categories[category] = { ratePercent: rate, isActive };
  }

  return { ok: true, value: config };
}

