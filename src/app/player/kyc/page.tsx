import { redirect } from "next/navigation";
import { connection } from "next/server";

import { playerKycFileUrl } from "@/lib/kyc-storage";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";

import { PlayerKycClient } from "./player-kyc-client";

export const metadata = {
  title: "Identity Verification | DBAIRS",
  description:
    "Submit identity documents to unlock withdrawals on this site.",
};

export const instant = false;

/**
 * 玩家实名认证页。
 *
 * 会话里的玩家才能进来；查询同时带 playerId 与 tenantId，
 * 换站 / 换账号都读不到别人的记录。
 */
export default async function PlayerKycPage() {
  await connection();

  const session = await getPlayerSessionFromCookies();

  if (!session) {
    redirect(`/player/login?next=${encodeURIComponent("/player/kyc")}`);
  }

  const record = await prisma.playerKyc.findFirst({
    where: { playerId: session.id, tenantId: session.tenantId },
    select: {
      status: true,
      realName: true,
      idNumber: true,
      idCardFrontUrl: true,
      idCardBackUrl: true,
      rejectReason: true,
      createdAt: true,
      reviewedAt: true,
    },
  });

  return (
    <PlayerKycClient
      themeColor={session.tenant.themeColor}
      tenantName={session.tenant.name}
      playerName={session.username}
      kyc={
        record
          ? {
              status: record.status,
              realName: record.realName,
              idNumber: record.idNumber,
              // 图片走受控接口，只有本人能读
              idCardFrontUrl: playerKycFileUrl(record.idCardFrontUrl),
              idCardBackUrl: playerKycFileUrl(record.idCardBackUrl),
              rejectReason: record.rejectReason,
              submittedAt: record.createdAt.toISOString(),
              reviewedAt: record.reviewedAt?.toISOString() ?? null,
            }
          : null
      }
    />
  );
}
