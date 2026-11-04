import { Prisma } from "@prisma/client";

import { accrueBonusTurnover } from "./bonus-campaigns";
import { buildSettlementSnapshot } from "./ggr-settlement";
import { prisma } from "./prisma";
import { isRebateCategoryId } from "./rebate-config";

/**
 * 游戏商回调的入账逻辑（扣钱 / 加钱 / 退款）。
 *
 * 幂等设计（与支付回调同一思路，但游戏商回调量大、重试更频繁）：
 * - 每个上游事件号（transactionId）在 Transaction.txHash 里留下唯一引用
 *   `game:<providerId>:<eventId>`，同一事件重复推送只会命中一次；
 * - 整个判定 + 扣钱 + 写流水放在 Serializable 事务里，
 *   两个并发的重复回调不会出现「都查不到、都加钱」的双花；
 * - 扣钱用条件更新 `balance >= amount`，余额不足直接回滚，不会写出负余额。
 *
 * 注单表 BetRecord 以 [providerId, roundId] 为唯一键：
 * 同局的 bet / win / refund 事件都会累加到同一行，
 * ggrAmount = betAmount - payoutAmount，始终与注单口径一致。
 */

export type GameCallbackEventType = "bet" | "win" | "refund";

export class GameCallbackError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GameCallbackError";
    this.status = status;
  }
}

export class InsufficientGameBalanceError extends GameCallbackError {
  constructor() {
    super("玩家余额不足，本次下注已被拒绝", 409);
    this.name = "InsufficientGameBalanceError";
  }
}

/** 上游事件名的常见别名，全部归一化成 bet / win / refund 三种资金动作。 */
const EVENT_TYPE_ALIASES: Record<string, GameCallbackEventType> = {
  bet: "bet",
  debit: "bet",
  deduct: "bet",
  stake: "bet",
  wager: "bet",
  lose: "bet",
  win: "win",
  credit: "win",
  payout: "win",
  pay: "win",
  settle: "win",
  settlement: "win",
  reward: "win",
  refund: "refund",
  cancel: "refund",
  rollback: "refund",
  revert: "refund",
  void: "refund",
};

export function readGameEventType(value: unknown): GameCallbackEventType | null {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.trim().toLowerCase();

  return key ? (EVENT_TYPE_ALIASES[key] ?? null) : null;
}

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

/** 单笔上限：与支付回调同量级，防止上游传错单位把余额打穿。 */
const MAX_GAME_AMOUNT = new Prisma.Decimal("10000000");

const ZERO = new Prisma.Decimal(0);

/**
 * 读取回调金额：必须是正数、最多 6 位小数。
 * 返回 null 表示格式非法（由接口给出 400），不接受 NaN / 科学计数法 / 负号。
 */
export function readGameAmount(value: unknown): Prisma.Decimal | null {
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";

  if (!AMOUNT_PATTERN.test(text)) {
    return null;
  }

  const amount = new Prisma.Decimal(text);

  // 注意：decimal.js 的 isPositive() 对 0 返回 true，这里必须显式挡掉 0 与负数。
  if (amount.lte(0) || amount.greaterThan(MAX_GAME_AMOUNT)) {
    return null;
  }

  return amount.toDecimalPlaces(6, Prisma.Decimal.ROUND_DOWN);
}

export type GameSettlementProvider = {
  id: string;
  upstreamPoint: Prisma.Decimal;
  platformMarkup: Prisma.Decimal;
};

export type GameSettlementInput = {
  provider: GameSettlementProvider;
  tenantId: string;
  playerId: string;
  type: GameCallbackEventType;
  /** 上游事件号（幂等键） */
  eventId: string;
  /** 上游注单 / 局号，同局事件落到同一条 BetRecord */
  roundId: string;
  amount: Prisma.Decimal;
  currency: string;
  gameCode: string | null;
};

export type GameSettlementResult = {
  replayed: boolean;
  transactionId: string;
  betRecordId: string;
  balance: string;
};

function ledgerRef(providerId: string, eventId: string) {
  return `game:${providerId}:${eventId}`;
}

/**
 * 写注单快照并返回 BetRecord.id。
 * 同一局已有记录时按事件类型累加，保证 betAmount / payoutAmount / ggrAmount 三者恒等。
 */
/**
 * 回查注单所属品类：`Game.category`（按 [providerId, externalId=gameCode]）。
 *
 * 查不到 / 回调没带 gameCode / 值不在洗码品类白名单里 → 一律回落 "slot"
 * （与 BetRecord.gameCategory 的默认值一致，结算逻辑永远拿到一个合法品类）。
 *
 * 只在**新建**注单时调用一次：品类一旦落库就是历史账，游戏事后改品类不重算。
 */
async function resolveBetRecordCategory(
  tx: Prisma.TransactionClient,
  input: GameSettlementInput,
): Promise<string> {
  const gameCode = input.gameCode?.trim();

  if (!gameCode) {
    return "slot";
  }

  const game = await tx.game.findFirst({
    where: { providerId: input.provider.id, externalId: gameCode },
    select: { category: true },
  });

  return isRebateCategoryId(game?.category) ? game.category : "slot";
}

async function applyBetRecord(
  tx: Prisma.TransactionClient,
  input: GameSettlementInput,
): Promise<string> {
  const deltaBet = input.type === "bet" ? input.amount : ZERO;
  const deltaPayout = input.type === "bet" ? ZERO : input.amount;
  const ggrDelta = deltaBet.minus(deltaPayout);

  const existing = await tx.betRecord.findUnique({
    where: {
      providerId_externalId: {
        providerId: input.provider.id,
        externalId: input.roundId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await tx.betRecord.update({
      where: { id: existing.id },
      data: {
        betAmount: { increment: deltaBet },
        payoutAmount: { increment: deltaPayout },
        ggrAmount: { increment: ggrDelta },
        ...(input.type === "refund"
          ? { status: "void", settledAt: new Date() }
          : {}),
      },
    });

    return existing.id;
  }

  // 新注单：把当时生效的点数写死，后续后台改点数不会重算历史账单。
  const override = await tx.tenantProviderPoint.findUnique({
    where: {
      tenantId_providerId: {
        tenantId: input.tenantId,
        providerId: input.provider.id,
      },
    },
    select: { customPoint: true },
  });

  const snapshot = buildSettlementSnapshot({
    upstreamPoint: input.provider.upstreamPoint,
    platformMarkup: input.provider.platformMarkup,
    customPoint: override?.customPoint ?? null,
  });

  const created = await tx.betRecord.create({
    data: {
      tenantId: input.tenantId,
      providerId: input.provider.id,
      playerId: input.playerId,
      externalId: input.roundId,
      // 品类只在**新建**注单时写一次：每日洗码结算只认这一列，
      // 历史账单不因游戏事后改品类而被重算。
      gameCategory: await resolveBetRecordCategory(tx, input),
      currency: input.currency,
      betAmount: deltaBet,
      payoutAmount: deltaPayout,
      ggrAmount: ggrDelta,
      snapshotPoint: snapshot.snapshotPoint,
      snapshotUpstreamPoint: snapshot.snapshotUpstreamPoint,
      snapshotPlatformMarkup: snapshot.snapshotPlatformMarkup,
      status: input.type === "refund" ? "void" : "settled",
      settledAt: input.type === "bet" ? null : new Date(),
    },
    select: { id: true },
  });

  return created.id;
}

/** 执行一次游戏商回调的入账（余额 + 注单 + 流水，同一事务）。 */
export async function applyGameCallback(
  input: GameSettlementInput,
): Promise<GameSettlementResult> {
  const ref = ledgerRef(input.provider.id, input.eventId);

  return prisma.$transaction(
    async (tx) => {
      const seen = await tx.transaction.findFirst({
        where: { txHash: ref },
        select: { id: true },
      });

      if (seen) {
        // 上游重试：直接返回当前余额，不再动账。
        const [player, record] = await Promise.all([
          tx.player.findUnique({
            where: { id: input.playerId },
            select: { balance: true },
          }),
          tx.betRecord.findUnique({
            where: {
              providerId_externalId: {
                providerId: input.provider.id,
                externalId: input.roundId,
              },
            },
            select: { id: true },
          }),
        ]);

        return {
          replayed: true,
          transactionId: seen.id,
          betRecordId: record?.id ?? "",
          balance: (player?.balance ?? ZERO).toFixed(6),
        };
      }

      if (input.type === "bet") {
        const debited = await tx.player.updateMany({
          where: { id: input.playerId, balance: { gte: input.amount } },
          data: { balance: { decrement: input.amount } },
        });

        if (debited.count === 0) {
          throw new InsufficientGameBalanceError();
        }
      } else {
        const credited = await tx.player.updateMany({
          where: { id: input.playerId },
          data: { balance: { increment: input.amount } },
        });

        if (credited.count === 0) {
          throw new GameCallbackError("玩家不存在，无法入账", 404);
        }
      }

      const betRecordId = await applyBetRecord(tx, input);

      const transaction = await tx.transaction.create({
        data: {
          tenantId: input.tenantId,
          playerId: input.playerId,
          // bet / win 与玩家钱包流水文案一致；refund 单独留痕，方便财务核对冲正。
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          status: "success",
          txHash: ref,
        },
        select: { id: true },
      });

      // 红利流水要求：只有「下注」累计流水，派彩 / 退款不重复计。
      // 放在扣款同一事务里 —— 钱扣了流水一定记上；打满的那条当场转 COMPLETED，
      // 提现闸门随之放行（见 /api/withdrawal/create 的 loadBonusTurnoverLock）。
      if (input.type === "bet") {
        await accrueBonusTurnover(tx, {
          tenantId: input.tenantId,
          playerId: input.playerId,
          amount: input.amount,
        });
      }

      const player = await tx.player.findUnique({
        where: { id: input.playerId },
        select: { balance: true },
      });

      return {
        replayed: false,
        transactionId: transaction.id,
        betRecordId,
        balance: (player?.balance ?? ZERO).toFixed(6),
      };
    },
    {
      // Serializable：两个并发的重复回调只会有一个人账成功。
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10_000,
    },
  );
}
