import { Prisma } from "@prisma/client";

import { buildSettlementSnapshot, calculateGgr } from "./ggr-settlement";
import { prisma } from "./prisma";

export type CreateBetRecordInput = {
  tenantId: string;
  providerId: string;
  playerId?: string | null;
  externalId?: string | null;
  currency?: string;
  betAmount: Prisma.Decimal.Value;
  payoutAmount: Prisma.Decimal.Value;
  settledAt?: Date | null;
};

/**
 * 写入注单并在同一事务内冻结点数快照。
 *
 * 这是未来 BetRecord 接入口必须调用的函数：玩家下注时刻的全局点数 / 租户专属点数
 * 会写入 snapshotPoint、snapshotUpstreamPoint、snapshotPlatformMarkup。
 * 之后后台再改点数，历史账单仍按注单快照结算。
 */
export async function createBetRecordWithSnapshot(
  input: CreateBetRecordInput,
) {
  return prisma.$transaction(async (tx) => {
    const [tenant, provider] = await Promise.all([
      tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { id: true },
      }),
      tx.gameProvider.findUnique({
        where: { id: input.providerId },
        select: {
          id: true,
          status: true,
          upstreamPoint: true,
          platformMarkup: true,
        },
      }),
    ]);

    if (!tenant) {
      throw new Error("租户不存在");
    }

    if (!provider) {
      throw new Error("游戏商不存在");
    }

    if (provider.status !== "active") {
      throw new Error("该游戏商已暂停，不能写入新注单");
    }

    if (input.playerId) {
      const player = await tx.player.findFirst({
        where: { id: input.playerId, tenantId: input.tenantId },
        select: { id: true },
      });

      if (!player) {
        throw new Error("玩家不存在或不属于该租户");
      }
    }

    const override = await tx.tenantProviderPoint.findUnique({
      where: {
        tenantId_providerId: {
          tenantId: input.tenantId,
          providerId: input.providerId,
        },
      },
      select: { customPoint: true },
    });

    const snapshot = buildSettlementSnapshot({
      upstreamPoint: provider.upstreamPoint,
      platformMarkup: provider.platformMarkup,
      customPoint: override?.customPoint ?? null,
    });

    const betAmount = new Prisma.Decimal(input.betAmount).toDecimalPlaces(6);
    const payoutAmount = new Prisma.Decimal(input.payoutAmount).toDecimalPlaces(
      6,
    );
    const ggrAmount = calculateGgr(betAmount, payoutAmount);

    return tx.betRecord.create({
      data: {
        tenantId: input.tenantId,
        providerId: input.providerId,
        playerId: input.playerId ?? null,
        externalId: input.externalId?.trim() || null,
        currency: input.currency ?? "USDT",
        betAmount,
        payoutAmount,
        ggrAmount,
        snapshotPoint: snapshot.snapshotPoint,
        snapshotUpstreamPoint: snapshot.snapshotUpstreamPoint,
        snapshotPlatformMarkup: snapshot.snapshotPlatformMarkup,
        status: "settled",
        settledAt: input.settledAt ?? new Date(),
      },
    });
  });
}
