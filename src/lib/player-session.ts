import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { normalizeCurrency } from "./currency";
import { normalizeTenantLogoUrl } from "./storefront";
import { PLAYER_TOKEN_COOKIE, verifyPlayerToken } from "./player-auth";
import { availableBalanceToString } from "./player-balance";
import { prisma } from "./prisma";

export type PlayerSessionInfo = {
  id: string;
  tenantId: string;
  username: string;
  email: string | null;
  phone: string | null;
  balance: string;
  /**
   * 处理中的提现单金额合计（pending 阶段不扣 Player.balance，
   * 扣款发生在代付成功回调，所以可用余额要单独减掉这一笔）。
   */
  pendingWithdrawalAmount: string;
  /** 可用余额 = balance - pendingWithdrawalAmount（大厅顶栏 BALANCE 展示的就是它） */
  availableBalance: string;
  status: string;
  walletAddress: string | null;
  referralCode: string;
  createdAt: string;
  lastLoginAt: string | null;
  tenant: {
    id: string;
    name: string;
    status: string;
    themeColor: string;
    /** 租户记账货币（MYR / USD / USDT…），金额符号统一走 src/lib/currency.ts */
    currency: string;
    /** 商户品牌 Logo：玩家中心 / 实名认证顶栏渲染它，没配则用商户名首字母 */
    logoUrl: string | null;
  };
};

/**
 * 解析玩家 JWT 后再查库：
 * - token 里的 tenantId 必须与数据库一致（不能靠改 token 跨租户）；
 * - 玩家状态非 active 或租户被停用时，会话立即失效；
 * - Decimal 统一转成字符串，方便 Server -> Client 传递，避免精度丢失；
 * - 顺带算好「处理中提现合计 / 可用余额」，大厅顶栏与玩家中心共用同一份口径。
 */
async function resolvePlayerSession(
  token: string | undefined,
): Promise<PlayerSessionInfo | null> {
  if (!token) {
    return null;
  }

  const payload = verifyPlayerToken(token);

  if (!payload) {
    return null;
  }

  // 余额与在途提现单并行查：pending 不冻结资金，必须自己扣，见 src/lib/player-balance.ts
  const [player, pendingWithdrawalAggregate] = await Promise.all([
    prisma.player.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        tenantId: true,
        username: true,
        email: true,
        phone: true,
        balance: true,
        status: true,
        walletAddress: true,
        referralCode: true,
        createdAt: true,
        lastLoginAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            status: true,
            themeColor: true,
            currency: true,
            logoUrl: true,
          },
        },
      },
    }),
    prisma.withdrawal.aggregate({
      where: { playerId: payload.userId, status: "pending" },
      _sum: { amount: true },
    }),
  ]);

  if (
    !player ||
    player.tenantId !== payload.tenantId ||
    player.status !== "active" ||
    player.tenant.status !== "active"
  ) {
    return null;
  }

  const pendingAmount = pendingWithdrawalAggregate._sum.amount;
  const balance = player.balance.toFixed(6);
  const pendingWithdrawalAmount = pendingAmount ? pendingAmount.toFixed(6) : "0";

  return {
    id: player.id,
    tenantId: player.tenantId,
    username: player.username,
    email: player.email,
    phone: player.phone,
    balance,
    pendingWithdrawalAmount,
    availableBalance: availableBalanceToString(balance, pendingWithdrawalAmount),
    status: player.status,
    walletAddress: player.walletAddress,
    referralCode: player.referralCode,
    createdAt: player.createdAt.toISOString(),
    lastLoginAt: player.lastLoginAt?.toISOString() ?? null,
    tenant: {
      id: player.tenant.id,
      name: player.tenant.name,
      status: player.tenant.status,
      themeColor: player.tenant.themeColor,
      currency: normalizeCurrency(player.tenant.currency),
      // 白标品牌：后台填了非法地址（javascript: 等）一律当未配置，退回首字母占位
      logoUrl: normalizeTenantLogoUrl(player.tenant.logoUrl),
    },
  };
}

/** Server Component 使用。 */
export function getPlayerSessionFromCookies(): Promise<PlayerSessionInfo | null> {
  return cookies().then((store) =>
    resolvePlayerSession(store.get(PLAYER_TOKEN_COOKIE)?.value),
  );
}

/** Route Handler 使用。 */
export function getPlayerSessionFromRequest(
  request: NextRequest,
): Promise<PlayerSessionInfo | null> {
  return resolvePlayerSession(request.cookies.get(PLAYER_TOKEN_COOKIE)?.value);
}
