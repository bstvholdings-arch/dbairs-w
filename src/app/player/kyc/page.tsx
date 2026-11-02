import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { resolveBrandName } from "@/lib/brand";
import { playerKycFileUrl } from "@/lib/kyc-storage";
import { getPlayerSessionFromCookies } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";
import { loadStorefront } from "@/lib/storefront-data";

import { PlayerKycClient } from "./player-kyc-client";

/**
 * 标签页标题跟着当前商户走（白标站不能写死平台名）。
 * loadStorefront 已用 React cache 包过，与页面主体共用同一次查询。
 */
export async function generateMetadata(): Promise<Metadata> {
  // cacheComponents 下 headers() 属于请求期数据：显式 connection() 后再取，构建期不会误预渲染
  await connection();

  const storefront = await loadStorefront();
  const brand = resolveBrandName(storefront.tenantName);

  return {
    title: `Identity Verification | ${brand}`,
    description: `Submit identity documents to unlock withdrawals on ${brand}.`,
  };
}

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
      tenantLogoUrl={session.tenant.logoUrl}
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
