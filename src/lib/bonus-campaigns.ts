import { Prisma } from "@prisma/client";

import {
  BONUS_CAMPAIGN_TYPES,
  type BonusCampaignTypeId,
} from "./bonus-campaign-types";
import { prisma } from "./prisma";

/**
 * 红利活动（BonusCampaign）的读写口径。
 *
 * 防套利三道闸门（与 prisma/schema.prisma 的注释一一对应）：
 * 1. `isActive` 总开关默认 false，建完不会自动上线；
 * 2. 时间窗 `startAt` / `endAt` 在**领取时**实时校验（过期即自动下线，不需要定时任务）；
 * 3. `@@unique([playerId, campaignId])` 保证同一玩家同一活动只能领一次。
 *
 * 奖励发放后的流水要求写在 PlayerBonusClaim：
 * - PENDING 状态 = 没打满流水 → 提现接口直接 403（见 /api/withdrawal/create）；
 * - 下注回调里按注单金额累计 wageredTurnover（见 game-callback.ts）。
 */

export const BONUS_NAME_MAX_LENGTH = 60;

/** 单个商户最多维护多少个活动（防止脏脚本灌爆玩家面活动列表） */
export const BONUS_MAX_CAMPAIGNS = 50;

/** 单笔奖励上限（本站记账币种）：填错小数位不会一次送出天价奖金 */
export const BONUS_MAX_REWARD = new Prisma.Decimal("100000");

/** 流水倍数上限：超过 50 倍基本等于让玩家打不完，属于配置事故 */
export const BONUS_MAX_TURNOVER_MULTIPLIER = new Prisma.Decimal("50");

/** 红利类型白名单（客户端安全模块 bonus-campaign-types.ts，与 Prisma enum 同名） */
export { BONUS_CAMPAIGN_TYPES };
export type { BonusCampaignTypeId };

/**
 * 活动对外状态（由 isActive + 时间窗**实时推导**，不落库）：
 * - disabled 已停用（isActive=false，无论时间窗在哪）
 * - upcoming 未开始（now < startAt）
 * - active   进行中（startAt ≤ now ≤ endAt，且 isActive）
 * - expired  已结束（now > endAt，即使 isActive 还是 true 也不可领）
 */
export type BonusCampaignStatus =
  | "disabled"
  | "upcoming"
  | "active"
  | "expired";

export type BonusCampaignView = {
  id: string;
  name: string;
  type: BonusCampaignTypeId;
  /** 奖励金额（字符串，避免 Server -> Client 精度丢失） */
  rewardAmount: string;
  turnoverMultiplier: string;
  currency: string;
  startAt: string;
  endAt: string;
  isActive: boolean;
  status: BonusCampaignStatus;
  /** 已领取人数（商户后台展示用） */
  claimCount: number;
  createdAt: string;
};

export const BONUS_CAMPAIGN_SELECT = {
  id: true,
  name: true,
  type: true,
  rewardAmount: true,
  turnoverMultiplier: true,
  currency: true,
  startAt: true,
  endAt: true,
  isActive: true,
  createdAt: true,
  _count: { select: { claims: true } },
} as const;

export type BonusCampaignRow = {
  id: string;
  name: string;
  type: BonusCampaignTypeId;
  rewardAmount: Prisma.Decimal;
  turnoverMultiplier: Prisma.Decimal;
  currency: string;
  startAt: Date;
  endAt: Date;
  isActive: boolean;
  createdAt: Date;
  _count: { claims: number };
};

/** 实时推导活动状态（后台列表、玩家面、领取校验共用同一份判定） */
export function deriveBonusCampaignStatus(
  campaign: { isActive: boolean; startAt: Date; endAt: Date },
  now: Date = new Date(),
): BonusCampaignStatus {
  if (!campaign.isActive) {
    return "disabled";
  }

  if (now < campaign.startAt) {
    return "upcoming";
  }

  if (now > campaign.endAt) {
    return "expired";
  }

  return "active";
}

/** 只有 active 的活动能领：停用 / 未开始 / 已结束一律拒绝 */
export function isBonusCampaignClaimable(
  campaign: { isActive: boolean; startAt: Date; endAt: Date },
  now: Date = new Date(),
): boolean {
  return deriveBonusCampaignStatus(campaign, now) === "active";
}

export function mapBonusCampaignView(
  row: BonusCampaignRow,
  now: Date = new Date(),
): BonusCampaignView {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    rewardAmount: row.rewardAmount.toFixed(2),
    turnoverMultiplier: row.turnoverMultiplier.toFixed(2),
    currency: row.currency,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    isActive: row.isActive,
    status: deriveBonusCampaignStatus(row, now),
    claimCount: row._count.claims,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 商户后台：全量活动（含停用 / 过期），新的在前 */
export async function loadTenantBonusCampaigns(
  tenantId: string,
): Promise<BonusCampaignView[]> {
  const rows = await prisma.bonusCampaign.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: "desc" }],
    select: BONUS_CAMPAIGN_SELECT,
    take: BONUS_MAX_CAMPAIGNS,
  });

  const now = new Date();

  return rows.map((row) => mapBonusCampaignView(row, now));
}


const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isBonusCampaignType(value: unknown): value is BonusCampaignTypeId {
  return (
    typeof value === "string" &&
    (BONUS_CAMPAIGN_TYPES as readonly string[]).includes(value)
  );
}

/**
 * 读金额 / 倍数：只认十进制数字串（挡掉 1e5 / 0x10 / 负号 / 千分位）。
 * 返回 null 表示格式非法，由调用方给出 400 文案。
 */
function readDecimal(value: unknown): Prisma.Decimal | null {
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";

  if (!AMOUNT_PATTERN.test(text)) {
    return null;
  }

  return new Prisma.Decimal(text);
}

/**
 * 读时间：前端 <input type="datetime-local"> 提交的是「本地时间」字符串
 * （2026-11-04T14:30），这里按服务器本地时区解释成 Date 再入库。
 * 时间只精确到分钟，不需要秒；非法 / 空值返回 null。
 */
function readDateTime(value: unknown): Date | null {
  const text = readText(value);

  if (!text) {
    return null;
  }

  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export type BonusCampaignInput = {
  name: string;
  type: BonusCampaignTypeId;
  rewardAmount: Prisma.Decimal;
  turnoverMultiplier: Prisma.Decimal;
  startAt: Date;
  endAt: Date;
  isActive: boolean;
};

export type BonusCampaignInputResult =
  | { ok: true; value: BonusCampaignInput }
  | { ok: false; error: string; status: number };

/**
 * 新建 / 编辑共用同一个解析器（整对象覆盖口径）：
 * 后台表单每次都提交全部字段，避免「PATCH 少传字段 = 把活动清空」。
 *
 * `isActive` 刻意要求**显式传 true** 才启用（缺省 = 停用），
 * 与「新建活动默认不上线」的闸门保持一致。
 */
export function parseBonusCampaignInput(
  body: unknown,
): BonusCampaignInputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "请求体格式错误", status: 400 };
  }

  const record = body as Record<string, unknown>;
  const name = readText(record.name);

  if (!name) {
    return { ok: false, error: "请填写活动名称", status: 400 };
  }

  if (name.length > BONUS_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `活动名称不能超过 ${BONUS_NAME_MAX_LENGTH} 个字符`,
      status: 400,
    };
  }

  const type = record.type === undefined ? "register" : record.type;

  if (!isBonusCampaignType(type)) {
    return { ok: false, error: "红利类型不正确", status: 400 };
  }

  const rewardAmount = readDecimal(record.rewardAmount);

  if (!rewardAmount || rewardAmount.lte(0)) {
    return { ok: false, error: "奖励金额必须大于 0", status: 400 };
  }

  if (rewardAmount.greaterThan(BONUS_MAX_REWARD)) {
    return {
      ok: false,
      error: `单笔奖励不能超过 ${BONUS_MAX_REWARD.toFixed(0)}`,
      status: 400,
    };
  }

  const turnoverMultiplier = readDecimal(record.turnoverMultiplier);

  if (!turnoverMultiplier || turnoverMultiplier.lt(0)) {
    return { ok: false, error: "流水倍数不能为负数", status: 400 };
  }

  if (turnoverMultiplier.greaterThan(BONUS_MAX_TURNOVER_MULTIPLIER)) {
    return {
      ok: false,
      error: `流水倍数不能超过 ${BONUS_MAX_TURNOVER_MULTIPLIER.toFixed(0)} 倍`,
      status: 400,
    };
  }

  const startAt = readDateTime(record.startAt);
  const endAt = readDateTime(record.endAt);

  if (!startAt || !endAt) {
    return { ok: false, error: "请填写活动开始与结束时间", status: 400 };
  }

  if (endAt.getTime() <= startAt.getTime()) {
    return {
      ok: false,
      error: "结束时间必须晚于开始时间",
      status: 400,
    };
  }

  return {
    ok: true,
    value: {
      name,
      type,
      rewardAmount: rewardAmount.toDecimalPlaces(6),
      turnoverMultiplier: turnoverMultiplier.toDecimalPlaces(2),
      startAt,
      endAt,
      // 只有明确传 true 才上线：少传字段 = 停用，不会意外把活动推给玩家
      isActive: record.isActive === true,
    },
  };
}

export type BonusClaimCode =
  | "campaign_not_found"
  | "campaign_inactive"
  | "campaign_not_started"
  | "campaign_ended"
  | "already_claimed"
  | "not_eligible"
  | "bonus_failed";

export type BonusClaimResult =
  | {
      ok: true;
      claimId: string;
      amount: string;
      requiredTurnover: string;
      /** PENDING = 流水没打满，提现会被拦；COMPLETED = 已经可以直接提 */
      status: "PENDING" | "COMPLETED";
      balance: string;
    }
  | { ok: false; code: BonusClaimCode; message: string; status: number };

type PlayerDepositHistory = {
  /** 玩家的**第一笔**成功充值时间（没有充值记录时为 null） */
  firstDepositAt: Date | null;
  /** 活动时间窗内的成功充值笔数 */
  depositsInWindow: number;
};

/**
 * 按活动类型检查玩家是否符合领取条件。
 *
 * - register      玩家注册时间必须落在活动时间窗内；
 * - deposit       活动时间窗内至少有一笔成功充值；
 * - first_deposit 玩家的第一笔成功充值必须发生在活动时间窗内。
 *
 * 「成功充值」只认 Transaction(type="deposit", status="success")：
 * DepositOrder 只是支付网关侧的订单，最终能否算充值以资金流水为准。
 */
async function readDepositHistory(input: {
  tenantId: string;
  playerId: string;
  startAt: Date;
  endAt: Date;
}): Promise<PlayerDepositHistory> {
  const [firstDeposit, depositsInWindow] = await Promise.all([
    prisma.transaction.findFirst({
      where: {
        tenantId: input.tenantId,
        playerId: input.playerId,
        type: "deposit",
        status: "success",
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.transaction.count({
      where: {
        tenantId: input.tenantId,
        playerId: input.playerId,
        type: "deposit",
        status: "success",
        createdAt: { gte: input.startAt, lte: input.endAt },
      },
    }),
  ]);

  return {
    firstDepositAt: firstDeposit?.createdAt ?? null,
    depositsInWindow,
  };
}

async function checkClaimEligibility(input: {
  tenantId: string;
  playerId: string;
  type: BonusCampaignTypeId;
  playerCreatedAt: Date;
  startAt: Date;
  endAt: Date;
}): Promise<boolean> {
  if (input.type === "register") {
    const createdAt = input.playerCreatedAt.getTime();
    const start = input.startAt.getTime();

    return createdAt >= start && createdAt <= input.endAt.getTime();
  }

  const history = await readDepositHistory(input);

  if (input.type === "deposit") {
    return history.depositsInWindow > 0;
  }

  // first_deposit：第一笔充值必须落在时间窗内（窗口内后续的充值不改变结论）
  const first = history.firstDepositAt?.getTime() ?? null;

  if (first === null) {
    return false;
  }

  return first >= input.startAt.getTime() && first <= input.endAt.getTime();
}


/**
 * 玩家领取红利。
 *
 * 一个事务内完成：写领取记录（唯一约束兜住并发）→ 写资金流水 → 加余额。
 * 任何一步失败整体回滚，绝不会出现「记录有了钱没到」或「钱到了没流水」。
 */
export async function claimPlayerBonus(input: {
  tenantId: string;
  playerId: string;
  campaignId: string;
  now?: Date;
}): Promise<BonusClaimResult> {
  const now = input.now ?? new Date();

  const player = await prisma.player.findFirst({
    where: { id: input.playerId, tenantId: input.tenantId },
    select: {
      id: true,
      createdAt: true,
      status: true,
      tenant: { select: { currency: true } },
    },
  });

  if (!player || player.status !== "active") {
    return {
      ok: false,
      code: "not_eligible",
      message: "账号当前不可领取红利",
      status: 403,
    };
  }

  const campaign = await prisma.bonusCampaign.findFirst({
    where: { id: input.campaignId, tenantId: input.tenantId },
    select: {
      id: true,
      type: true,
      rewardAmount: true,
      turnoverMultiplier: true,
      currency: true,
      startAt: true,
      endAt: true,
      isActive: true,
    },
  });

  if (!campaign) {
    return {
      ok: false,
      code: "campaign_not_found",
      message: "活动不存在",
      status: 404,
    };
  }

  const status = deriveBonusCampaignStatus(campaign, now);

  if (status === "disabled") {
    return {
      ok: false,
      code: "campaign_inactive",
      message: "活动未开启",
      status: 403,
    };
  }

  if (status === "upcoming") {
    return {
      ok: false,
      code: "campaign_not_started",
      message: "活动还没开始",
      status: 403,
    };
  }

  if (status === "expired") {
    return {
      ok: false,
      code: "campaign_ended",
      message: "活动已结束",
      status: 403,
    };
  }

  const eligible = await checkClaimEligibility({
    tenantId: input.tenantId,
    playerId: player.id,
    type: campaign.type,
    playerCreatedAt: player.createdAt,
    startAt: campaign.startAt,
    endAt: campaign.endAt,
  });

  if (!eligible) {
    return {
      ok: false,
      code: "not_eligible",
      message: "暂不满足该活动的领取条件",
      status: 403,
    };
  }

  const already = await prisma.playerBonusClaim.findFirst({
    where: { playerId: player.id, campaignId: campaign.id },
    select: { id: true },
  });

  if (already) {
    return {
      ok: false,
      code: "already_claimed",
      message: "该活动已经领取过了",
      status: 409,
    };
  }

  const rewardAmount = campaign.rewardAmount.toDecimalPlaces(6);
  const requiredTurnover = rewardAmount
    .mul(campaign.turnoverMultiplier)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  // 流水倍数填 0 = 领了就能提（营销活动的常见玩法），此时直接记 COMPLETED
  const completed = requiredTurnover.lte(0);
  const currency = campaign.currency || player.tenant.currency;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.playerBonusClaim.create({
        data: {
          tenantId: input.tenantId,
          campaignId: campaign.id,
          playerId: player.id,
          rewardAmount,
          requiredTurnover,
          wageredTurnover: 0,
          currency,
          status: completed ? "COMPLETED" : "PENDING",
          completedAt: completed ? new Date() : null,
        },
        select: { id: true },
      });

      const transaction = await tx.transaction.create({
        data: {
          tenantId: input.tenantId,
          playerId: player.id,
          type: "bonus",
          amount: rewardAmount,
          currency,
          status: "success",
          txHash: `bonus-claim:${claim.id}`,
        },
        select: { id: true },
      });

      await tx.playerBonusClaim.update({
        where: { id: claim.id },
        data: { transactionId: transaction.id },
      });

      const updated = await tx.player.update({
        where: { id: player.id },
        data: { balance: { increment: rewardAmount } },
        select: { balance: true },
      });

      return { claimId: claim.id, balance: updated.balance };
    });

    return {
      ok: true,
      claimId: result.claimId,
      amount: rewardAmount.toFixed(2),
      requiredTurnover: requiredTurnover.toFixed(2),
      status: completed ? "COMPLETED" : "PENDING",
      balance: result.balance.toFixed(2),
    };
  } catch (error) {
    // @@unique([playerId, campaignId])：并发重复点击只会成功一次
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: false,
        code: "already_claimed",
        message: "该活动已经领取过了",
        status: 409,
      };
    }

    console.error("领取红利失败:", error);

    return {
      ok: false,
      code: "bonus_failed",
      message: "领取失败，请稍后重试",
      status: 500,
    };
  }
}


/**
 * 下注回调里累计红利流水要求。
 *
 * 必须在**下注的同事务**里调用（game-callback.ts 的 Serializable 事务），
 * 这样「扣钱成功但流水没累计」不会发生。
 * 打满的那一条立即转 COMPLETED，提现闸门随之放行。
 */
export async function accrueBonusTurnover(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; playerId: string; amount: Prisma.Decimal },
): Promise<number> {
  if (input.amount.lte(0)) {
    return 0;
  }

  const pending = await tx.playerBonusClaim.findMany({
    where: {
      tenantId: input.tenantId,
      playerId: input.playerId,
      status: "PENDING",
    },
    select: { id: true, requiredTurnover: true, wageredTurnover: true },
  });

  if (pending.length === 0) {
    return 0;
  }

  const now = new Date();
  let completed = 0;

  for (const claim of pending) {
    const wagered = claim.wageredTurnover.plus(input.amount);
    const done = wagered.gte(claim.requiredTurnover);

    await tx.playerBonusClaim.update({
      where: { id: claim.id },
      data: {
        wageredTurnover: wagered,
        status: done ? "COMPLETED" : "PENDING",
        completedAt: done ? now : null,
      },
    });

    if (done) {
      completed += 1;
    }
  }

  return completed;
}

export type BonusTurnoverLock = {
  /** 还没打满流水的要求条数（>0 就禁止提现） */
  pendingCount: number;
  /** 要求流水合计 */
  requiredTotal: string;
  /** 已打流水合计 */
  wageredTotal: string;
  /** 还差多少流水才能提现（已四舍五入到分） */
  outstanding: string;
  currency: string;
};

const ZERO = new Prisma.Decimal(0);

/**
 * 提现前置校验用：读取玩家当前所有「未打满流水」的红利要求。
 *
 * 只读 + 租户隔离：所有查询都带 tenantId，跨租户的数据一律看不到。
 */
export async function loadBonusTurnoverLock(input: {
  tenantId: string;
  playerId: string;
  currency: string;
}): Promise<BonusTurnoverLock> {
  const pending = await prisma.playerBonusClaim.findMany({
    where: {
      tenantId: input.tenantId,
      playerId: input.playerId,
      status: "PENDING",
    },
    select: { requiredTurnover: true, wageredTurnover: true, currency: true },
  });

  let required = ZERO;
  let wagered = ZERO;
  let outstanding = ZERO;
  let currency = input.currency;

  for (const claim of pending) {
    required = required.plus(claim.requiredTurnover);
    wagered = wagered.plus(claim.wageredTurnover);

    const gap = claim.requiredTurnover.minus(claim.wageredTurnover);

    if (gap.gt(0)) {
      outstanding = outstanding.plus(gap);
    }

    currency = claim.currency || currency;
  }

  return {
    pendingCount: pending.length,
    requiredTotal: required.toFixed(2),
    wageredTotal: wagered.toFixed(2),
    outstanding: outstanding.toDecimalPlaces(2).toFixed(2),
    currency,
  };
}

export type PlayerBonusCampaignView = BonusCampaignView & {
  claimed: boolean;
  claimStatus: "PENDING" | "COMPLETED" | null;
  claimedAt: string | null;
  /**
   * 领取后需要打满的流水（未领取时为 "0.00"）。
   * 玩家面卡片上的进度条读的就是这三个字段：卡片必须能显示
   * 「当前流水 X / 所需流水 Y」，只给汇总的 lock 无法做到逐张卡展示。
   */
  requiredTurnover: string;
  /** 已经累计的流水（未领取时为 "0.00"） */
  wageredTurnover: string;
  /** 还差多少流水（已打满 / 未领取时为 "0.00"） */
  remainingTurnover: string;
};

/**
 * 玩家面：只返回「开启中且正在时间窗内」的活动 + 自己领没领。
 *
 * 停用 / 未开始 / 已结束的活动在玩家面完全不存在，
 * 与「过期即自动下线」的口径一致（不需要定时任务改 isActive）。
 */
export async function loadPlayerBonusCampaigns(
  tenantId: string,
  playerId: string,
): Promise<PlayerBonusCampaignView[]> {
  const now = new Date();
  const rows = await prisma.bonusCampaign.findMany({
    where: {
      tenantId,
      isActive: true,
      startAt: { lte: now },
      endAt: { gte: now },
    },
    orderBy: [{ endAt: "asc" }],
    select: BONUS_CAMPAIGN_SELECT,
  });

  if (rows.length === 0) {
    return [];
  }

  const claims = await prisma.playerBonusClaim.findMany({
    where: {
      playerId,
      tenantId,
      campaignId: { in: rows.map((row) => row.id) },
    },
    select: {
      campaignId: true,
      status: true,
      claimedAt: true,
      requiredTurnover: true,
      wageredTurnover: true,
    },
  });

  const claimByCampaign = new Map(
    claims.map((claim) => [claim.campaignId, claim]),
  );

  return rows.map((row) => {
    const claim = claimByCampaign.get(row.id);
    const required = claim?.requiredTurnover ?? new Prisma.Decimal(0);
    const wagered = claim?.wageredTurnover ?? new Prisma.Decimal(0);
    // 只展示正数缺口：超额打流水（wagered > required）时倒推成负数会让玩家困惑
    const remaining = required.minus(wagered);

    return {
      ...mapBonusCampaignView(row, now),
      claimed: Boolean(claim),
      claimStatus: claim?.status ?? null,
      claimedAt: claim?.claimedAt.toISOString() ?? null,
      requiredTurnover: required.toFixed(2),
      wageredTurnover: wagered.toFixed(2),
      remainingTurnover: remaining.gt(0) ? remaining.toFixed(2) : "0.00",
    };
  });
}

