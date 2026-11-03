import { Prisma } from "@prisma/client";

import { logDataFallback } from "./data-fallback-log";
import { prisma } from "./prisma";
import { normalizeTenantLogoUrl } from "./storefront";

/**
 * 活动大厅（Promotions）的数据访问层。
 *
 * 安全约定（与本仓库其它多租户模块一致）：
 * 每个查询都必须带 `where: { tenantId }`，且 tenantId 只能来自登录会话
 * （商户后台）或前台站点解析（玩家面），绝不接受前端传入的 tenantId。
 *
 * 两套读法：
 * - loadPromotionFeed()       玩家面：只返回 isActive=true 的 Banner，
 *                             以及「至少有一张启用中 Banner」的分类（空分类不上导航）；
 * - loadTenantPromotionData() 商户后台：全量返回（含停用），分类里带总数 / 启用数，
 *                             运营才能看到自己刚建好但还没启用的活动。
 */

/** 分类名长度上限（侧边栏 / 横向 Tab 都放得下） */
export const PROMOTION_CATEGORY_NAME_MAX_LENGTH = 24;

/** 活动标题长度上限 */
export const PROMOTION_TITLE_MAX_LENGTH = 80;

/** 单个商户最多维护多少分类 / 活动（防止脏脚本灌爆前台首屏） */
export const PROMOTION_MAX_CATEGORIES = 30;
export const PROMOTION_MAX_BANNERS = 200;

/** 排序值范围：前端输入框按这个夹取，避免写入 1e9 把别的活动挤到看不见 */
export const PROMOTION_SORT_MIN = -9999;
export const PROMOTION_SORT_MAX = 9999;

/** 每日签到彩金面额：与 /api/player/bonus、src/lib/player-profile.ts 同一个 env */
const DAILY_BONUS_AMOUNT = Number(process.env.DAILY_BONUS_AMOUNT ?? "0.5");

export type PromotionCategoryView = {
  id: string;
  name: string;
  sortOrder: number;
  /**
   * 该分类下的 Banner 数量。
   * 玩家面只统计启用中的（停用 = 前台不存在）；
   * 商户后台统计全部（用来显示「3 张里有 2 张启用」）。
   */
  bannerCount: number;
  /** 其中启用中的数量（商户后台用；玩家面与 bannerCount 相同） */
  activeBannerCount: number;
};

export type PromotionBannerView = {
  id: string;
  categoryId: string;
  title: string | null;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

export type PromotionFeed = {
  categories: PromotionCategoryView[];
  banners: PromotionBannerView[];
};

const BANNER_SELECT = {
  id: true,
  categoryId: true,
  title: true,
  imageUrl: true,
  linkUrl: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
} as const;

type PromotionBannerRow = {
  id: string;
  categoryId: string;
  title: string | null;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
};

function toBannerView(row: PromotionBannerRow): PromotionBannerView {
  return {
    id: row.id,
    categoryId: row.categoryId,
    title: row.title,
    imageUrl: row.imageUrl,
    linkUrl: row.linkUrl,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 玩家面：只读启用中的活动，分类按「有启用活动」过滤 */
export async function loadPromotionFeed(
  tenantId: string,
): Promise<PromotionFeed> {
  try {
    const [categories, banners] = await Promise.all([
      prisma.promotionCategory.findMany({
        where: { tenantId, banners: { some: { isActive: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          sortOrder: true,
          _count: { select: { banners: { where: { isActive: true } } } },
        },
      }),
      prisma.promotionBanner.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        select: BANNER_SELECT,
      }),
    ]);

    return {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        bannerCount: category._count.banners,
        activeBannerCount: category._count.banners,
      })),
      banners: banners.map(toBannerView),
    };
  } catch (error) {
    // 数据库抖动 / 还没执行 db push 时回退成空列表：
    // 玩家看到「暂无活动」的空状态，而不是一张 500 错误页（与大厅回退内置数据的口径一致）。
    logDataFallback("读取活动大厅数据失败，回退到空列表", error);

    return { categories: [], banners: [] };
  }
}

/** 大厅 Hero 轮播最多取几张海报（再多玩家也记不住，且首屏图片会拖慢 LCP） */
export const HERO_BANNER_LIMIT = 5;

/**
 * 大厅顶部 Hero 轮播的海报（玩家面）。
 *
 * - 只读**启用中**的活动海报，且必须带图（`imageUrl` 是必填列，这里再 trim 一次
 *   挡掉历史上可能写进去的空白串）；
 * - 先按运营排序（sortOrder 升序），同序时取**最新上传的**，符合「优先取最新几张」；
 * - 数据库不可用 / 还没 db push 时返回空数组：大厅 Hero 会自动退回原本的内置文案
 *   轮播（见 components/lobby/hero-carousel.tsx），玩家看不到报错，也不会白屏。
 */
export async function loadHeroBanners(
  tenantId: string,
): Promise<PromotionBannerView[]> {
  try {
    const rows = await prisma.promotionBanner.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: HERO_BANNER_LIMIT,
      select: BANNER_SELECT,
    });

    return rows
      .filter((row) => Boolean(row.imageUrl.trim()))
      .map((row) => toBannerView(row));
  } catch (error) {
    logDataFallback("读取大厅 Hero 海报失败，回退到内置文案轮播", error);

    return [];
  }
}

/** 商户后台：全量（含停用）+ 分类的启用数量 */
export async function loadTenantPromotionData(
  tenantId: string,
): Promise<PromotionFeed> {
  const [categories, banners] = await Promise.all([
    prisma.promotionCategory.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    }),
    prisma.promotionBanner.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: BANNER_SELECT,
    }),
  ]);

  const totalByCategory = new Map<string, number>();
  const activeByCategory = new Map<string, number>();

  for (const banner of banners) {
    totalByCategory.set(
      banner.categoryId,
      (totalByCategory.get(banner.categoryId) ?? 0) + 1,
    );

    if (banner.isActive) {
      activeByCategory.set(
        banner.categoryId,
        (activeByCategory.get(banner.categoryId) ?? 0) + 1,
      );
    }
  }

  return {
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      bannerCount: totalByCategory.get(category.id) ?? 0,
      activeBannerCount: activeByCategory.get(category.id) ?? 0,
    })),
    banners: banners.map(toBannerView),
  };
}


/** UTC 当天 0 点（与 DailyBonusClaim.claimDate 的取整口径一致） */
function utcStartOfToday() {
  const now = new Date();

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** 下一次重置时间 = UTC 次日 0 点（前端据此倒计时） */
export function nextDailyResetAt(): string {
  const now = new Date();

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

function safeDailyBonusAmount(): string {
  if (!Number.isFinite(DAILY_BONUS_AMOUNT) || DAILY_BONUS_AMOUNT <= 0) {
    return "0.5";
  }

  return DAILY_BONUS_AMOUNT.toFixed(6);
}

export type PromotionBonusSummary = {
  loggedIn: boolean;
  /** 今日签到彩金是否已领 */
  claimedToday: boolean;
  /** 今日签到彩金面额（未登录也返回，用于营销展示） */
  dailyAmount: string;
  /** 彩金总额 = 累计签到彩金 + 累计推荐返佣（同一租户、同一玩家） */
  bonusTotal: string;
  /** 下次重置（UTC 次日 0 点） */
  nextResetAt: string;
};

/**
 * 顶部任务栏要展示的「每日任务 / 彩金总额」。
 *
 * 只读、按会话玩家查库：
 * - 未登录 → loggedIn=false，彩金一律 0（前台显示「登录后查看」，绝不显示别人的数字）；
 * - 已登录 → 三个聚合都带 playerId + tenantId 双条件，
 *   DailyBonusClaim / ReferralReward 都是有 tenantId 的表，换站查不到别人的账。
 */
export async function loadPromotionBonusSummary(
  player: { id: string; tenantId: string } | null,
): Promise<PromotionBonusSummary> {
  const base = {
    claimedToday: false,
    dailyAmount: safeDailyBonusAmount(),
    bonusTotal: "0",
    nextResetAt: nextDailyResetAt(),
  };

  if (!player) {
    return { loggedIn: false, ...base };
  }

  try {
    const [claim, bonusAggregate, referralAggregate] = await Promise.all([
      prisma.dailyBonusClaim.findUnique({
        where: {
          playerId_claimDate: {
            playerId: player.id,
            claimDate: utcStartOfToday(),
          },
        },
        select: { id: true },
      }),
      prisma.dailyBonusClaim.aggregate({
        where: { playerId: player.id, tenantId: player.tenantId },
        _sum: { amount: true },
      }),
      prisma.referralReward.aggregate({
        where: { inviterId: player.id, tenantId: player.tenantId },
        _sum: { rewardAmount: true },
      }),
    ]);

    const bonusTotal = new Prisma.Decimal(
      bonusAggregate._sum.amount ? bonusAggregate._sum.amount.toString() : 0,
    ).plus(
      referralAggregate._sum.rewardAmount
        ? referralAggregate._sum.rewardAmount.toString()
        : 0,
    );

    return {
      loggedIn: true,
      ...base,
      claimedToday: Boolean(claim),
      bonusTotal: bonusTotal.toFixed(6),
    };
  } catch (error) {
    // 查不到就按「未登录」展示：宁可少显示一个数字，也不给玩家看错账。
    logDataFallback("读取彩金总额失败，按未登录状态展示", error);

    return { loggedIn: false, ...base };
  }
}


/**
 * 活动图 / 跳转地址的统一校验（与 Tenant.logoUrl 同一口径）。
 *
 * 只接受两类值，其余一律当作「非法」：
 * 1. http(s) 绝对地址 —— 外站图床 / CDN / 落地页；
 * 2. 以 `/` 开头的站内路径 —— 本地上传的活动图（/api/promotions/banners/...）
 *    与站内落地页（/player/register）。
 *
 * 刻意拒绝 data: / javascript: / 协议相对地址（//evil.com/x）：
 * 这些值会直接进 <img src> 与 <a href>，放开等于给后台表单留注入面。
 */
export function normalizePromotionUrl(raw: unknown): string | null {
  return normalizeTenantLogoUrl(raw);
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampSortOrder(value: unknown, fallback: number): number {
  const raw = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return Math.min(
    PROMOTION_SORT_MAX,
    Math.max(PROMOTION_SORT_MIN, Math.trunc(raw)),
  );
}

export type PromotionInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

export type PromotionCategoryInput = {
  name: string;
  sortOrder: number;
};

export type PromotionBannerInput = {
  categoryId: string;
  title: string | null;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  sortOrder: number;
};

/**
 * 分类新建 / 编辑共用一个解析器：后台表单每次都提交完整对象
 * （名称 + 排序），避免「部分更新」把没传的字段清空。
 */
export function parsePromotionCategoryInput(
  body: unknown,
): PromotionInputResult<PromotionCategoryInput> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "请求体格式错误", status: 400 };
  }

  const record = body as Record<string, unknown>;
  const name = readText(record.name);

  if (!name) {
    return { ok: false, error: "请填写分类名称", status: 400 };
  }

  if (name.length > PROMOTION_CATEGORY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `分类名称不能超过 ${PROMOTION_CATEGORY_NAME_MAX_LENGTH} 个字符`,
      status: 400,
    };
  }

  return {
    ok: true,
    value: { name, sortOrder: clampSortOrder(record.sortOrder, 0) },
  };
}

/** Banner 新建 / 编辑共用的解析器（与分类同一套「整对象提交」口径） */
export function parsePromotionBannerInput(
  body: unknown,
): PromotionInputResult<PromotionBannerInput> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "请求体格式错误", status: 400 };
  }

  const record = body as Record<string, unknown>;
  const categoryId = readText(record.categoryId);

  if (!categoryId) {
    return { ok: false, error: "请选择活动分类", status: 400 };
  }

  const imageUrl = normalizePromotionUrl(record.imageUrl);

  if (!imageUrl) {
    return {
      ok: false,
      error: "请上传活动图片，或填写 http(s) / 站内路径格式的图片地址",
      status: 400,
    };
  }

  const title = readText(record.title);

  if (title.length > PROMOTION_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      error: `活动标题不能超过 ${PROMOTION_TITLE_MAX_LENGTH} 个字符`,
      status: 400,
    };
  }

  const rawLink = readText(record.linkUrl);
  const linkUrl = rawLink ? normalizePromotionUrl(rawLink) : null;

  if (rawLink && !linkUrl) {
    return {
      ok: false,
      error: "跳转地址格式不正确，只支持 http(s) 或站内 / 开头的路径",
      status: 400,
    };
  }

  return {
    ok: true,
    value: {
      categoryId,
      title: title || null,
      imageUrl,
      linkUrl,
      // 只有明确传 false 才停用，避免「少传字段 = 被停用」的意外
      isActive: record.isActive !== false,
      sortOrder: clampSortOrder(record.sortOrder, 0),
    },
  };
}

