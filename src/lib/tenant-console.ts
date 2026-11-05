import { Prisma, type KycStatus } from "@prisma/client";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { normalizeCurrency } from "./currency";
import { failDepositOrder, settleDepositOrder } from "./deposit-settlement";
import { toNumber } from "./format";
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationTicket,
} from "./impersonation";
import { isKycStatus, maskIdNumber, normalizeRejectReason } from "./kyc";
import { tenantKycFileUrl } from "./kyc-storage";
import {
  DEPOSIT_MANUAL_REVIEW_PENDING,
  MANUAL_REVIEW_GATEWAY_TYPES,
  gatewayRequiresManualReview,
  type GatewayTypeValue,
} from "./payment-gateway-constants";
import { prisma } from "./prisma";
import {
  getSessionUserFromCookies,
  getSessionUserFromRequest,
  type SessionUser,
  type TenantSessionInfo,
} from "./session";
import {
  normalizeStorefrontLayout,
  parseThemeSetting,
  readThemeSettingInput,
  serializeLayoutConfig,
  serializeThemeSetting,
  type StorefrontLayout,
  type StorefrontThemeSetting,
} from "./storefront";
import {
  formatBackupDomainConflict,
  findBackupDomainConflict,
} from "./tenant-domain-service";
import { readBackupDomainsInput } from "./tenant-domains";
import { maskWithdrawalDestination } from "./withdrawal-accounts";
import {
  markWithdrawalFailed,
  settleWithdrawalSuccess,
} from "./withdrawal-settlement";
import {
  WITHDRAWAL_STATUS_PENDING,
  WITHDRAWAL_STATUS_PROCESSING,
  inFlightWithdrawalStatusList,
} from "./withdrawal-status";

/**
 * 商户后台（Tenant Dashboard）的数据访问层。
 *
 * 安全约定（整个文件唯一的硬规则）：
 * 每一个查询都必须带 `where: { tenantId }`，且 tenantId 只能来自登录会话
 * （AdminUser.tenantId），绝不接受前端传入的 tenantId / tenant、也绝不省略。
 * 客户端的参数只允许影响「筛选条件」（q / status / kind / page），
 * 不允许影响数据归属。这样即使有人改了接口参数，也读不到别家的数据。
 */

export type TenantScope = {
  user: SessionUser;
  tenantId: string;
  /** 当前生效的租户（商户账号用自己的；超管代登录时为被代登录的租户）。 */
  tenant: TenantSessionInfo;
  /** 非空表示这是超管代登录，页面需要显示醒目的安全提示。 */
  impersonation: { adminId: string; username: string } | null;
};

export type TenantGuard =
  | { scope: TenantScope; response: null }
  | { scope: null; response: Response };

export const TENANT_PAGE_SIZE = 20;

function noStoreJson(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** 从会话里取出「当前租户」：只有 tenant_admin 且绑定有效租户才算数。 */
export function tenantScopeOf(user: SessionUser | null): TenantScope | null {
  if (!user || user.role !== "tenant_admin" || !user.tenantId || !user.tenant) {
    return null;
  }

  return {
    user,
    tenantId: user.tenantId,
    tenant: user.tenant,
    impersonation: null,
  };
}

/**
 * 把「超管 + 代登录票据」解析成租户范围。
 *
 * 这是平台账号唯一能进 /tenant 的方式：必须同时满足
 * 1) 当前账号是 super_admin；
 * 2) 票据签名有效、未过期，且 adminId 与当前账号一致；
 * 3) 票据里的租户真实存在。
 */
async function resolveImpersonatedScope(
  user: SessionUser | null,
  tenantId: string,
): Promise<TenantScope | null> {
  if (!user || user.role !== "super_admin") {
    return null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      domain: true,
      subdomain: true,
      status: true,
    },
  });

  if (!tenant) {
    return null;
  }

  return {
    user,
    tenantId: tenant.id,
    tenant,
    impersonation: { adminId: user.id, username: user.username },
  };
}

/** Server Component 使用：读代登录票据（httpOnly cookie）。 */
async function readImpersonationTicket(adminId: string) {
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  return verifyImpersonationTicket(token, adminId);
}

/** 用已解析的会话换取租户范围（避免 layout + page 重复查会话）。 */
export async function getTenantScopeForUser(
  user: SessionUser | null,
): Promise<TenantScope | null> {
  const direct = tenantScopeOf(user);

  if (direct) {
    return direct;
  }

  if (!user || user.role !== "super_admin") {
    return null;
  }

  const ticket = await readImpersonationTicket(user.id);

  return ticket ? resolveImpersonatedScope(user, ticket.tenantId) : null;
}

/** Server Component 使用：拿不到租户返回 null，由页面自行 redirect。 */
export async function getTenantScopeFromCookies(): Promise<TenantScope | null> {
  return getTenantScopeForUser(await getSessionUserFromCookies());
}

/**
 * API 路由使用：未登录 401、无租户范围 403。
 * proxy 已按 /api/tenant 前缀拦过一道，这里再查一次数据库，
 * 防止「JWT 未过期但账号已被降级 / 解绑租户」的越权。
 */
export async function guardTenantApi(
  request: NextRequest,
): Promise<TenantGuard> {
  const user = await getSessionUserFromRequest(request);

  if (!user) {
    return {
      scope: null,
      response: noStoreJson("未登录或登录已过期，请重新登录", 401),
    };
  }

  let scope = tenantScopeOf(user);

  if (!scope && user.role === "super_admin") {
    const ticket = verifyImpersonationTicket(
      request.cookies.get(IMPERSONATION_COOKIE)?.value,
      user.id,
    );

    if (ticket) {
      scope = await resolveImpersonatedScope(user, ticket.tenantId);
    }
  }

  if (!scope) {
    return {
      scope: null,
      response: noStoreJson(
        "仅商户账号可访问该接口（平台账号请先从租户管理进入商户后台）",
        403,
      ),
    };
  }

  return { scope, response: null };
}

/** 分页参数归一化：页码最小 1，页大小夹在 1-100。 */
export function normalizePaging(input: {
  page?: unknown;
  pageSize?: unknown;
}) {
  const page = Math.max(1, Math.trunc(toNumber(input.page)) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Math.trunc(toNumber(input.pageSize)) || TENANT_PAGE_SIZE),
  );

  return { page, pageSize, skip: (page - 1) * pageSize };
}

function decimal(value: Prisma.Decimal | null | undefined) {
  return toNumber(value);
}

/** 搜索词最长 64 字符，避免把超长串直接塞进 ILIKE。 */
export function normalizeSearchTerm(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

export type TenantOverviewPlayer = {
  id: string;
  username: string;
  balance: number;
  status: string;
  createdAt: string;
};

export type TenantOverviewTransaction = {
  id: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  playerName: string | null;
};

export type TenantOverviewAiLog = {
  id: string;
  role: string;
  content: string;
  playerName: string | null;
  createdAt: string;
};

export type TenantOverview = {
  playerCount: number;
  activePlayerCount: number;
  bannedPlayerCount: number;
  depositTotal: number;
  withdrawTotal: number;
  betTotal: number;
  payoutTotal: number;
  ggr: number;
  platformFee: number;
  pendingWithdrawCount: number;
  pendingWithdrawTotal: number;
  aiMessageCount: number;
  aiPlayerCount: number;
  recentPlayers: TenantOverviewPlayer[];
  recentTransactions: TenantOverviewTransaction[];
  recentAiLogs: TenantOverviewAiLog[];
};

/**
 * 数据概览：全部聚合都以 tenantId 收口。
 *
 * - 充值 / 提现：Transaction 中 status=success 的 deposit / withdraw（真实资金变动）；
 * - GGR：BetRecord.status=settled 的下注 − 派彩；
 * - 平台应扣服务费：逐条注单 Σ(ggrAmount × snapshotPlatformMarkup)，
 *   与 /finance 对账口径一致（用下注瞬间快照，后台改点数不影响历史）。
 */
export async function loadTenantOverview(
  tenantId: string,
): Promise<TenantOverview> {
  const [
    statusGroups,
    depositAggregate,
    withdrawAggregate,
    betAggregate,
    pendingWithdraw,
    platformFeeRows,
    aiMessageCount,
    aiPlayerGroups,
    recentPlayers,
    recentTransactions,
    recentAiLogs,
  ] = await Promise.all([
    prisma.player.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    }),
    prisma.transaction.aggregate({
      where: { tenantId, type: "deposit", status: "success" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { tenantId, type: "withdraw", status: "success" },
      _sum: { amount: true },
    }),
    prisma.betRecord.aggregate({
      where: { tenantId, status: "settled" },
      _sum: { betAmount: true, payoutAmount: true, ggrAmount: true },
    }),
    prisma.withdrawal.aggregate({
      // 在途口径：pending（人工待审）+ processing（自动出款中），两种都还没扣余额
      where: { tenantId, status: { in: inFlightWithdrawalStatusList() } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ platformFee: Prisma.Decimal | string | null }[]>`
      SELECT COALESCE(SUM("ggrAmount" * "snapshotPlatformMarkup"), 0) AS "platformFee"
      FROM "BetRecord"
      WHERE "tenantId" = ${tenantId} AND "status" = 'settled'
    `,
    prisma.aiChatLog.count({ where: { tenantId, agentType: "support" } }),
    prisma.aiChatLog.groupBy({
      by: ["playerId"],
      where: { tenantId, agentType: "support" },
    }),
    prisma.player.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        username: true,
        balance: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.transaction.findMany({
      where: {
        tenantId,
        status: "success",
        type: { in: ["deposit", "withdraw"] },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
        player: { select: { username: true } },
      },
    }),
    prisma.aiChatLog.findMany({
      where: { tenantId, agentType: "support" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        player: { select: { username: true } },
      },
    }),
  ]);

  let playerCount = 0;
  let activePlayerCount = 0;
  let bannedPlayerCount = 0;

  for (const group of statusGroups) {
    playerCount += group._count._all;

    if (group.status === "active") {
      activePlayerCount += group._count._all;
    } else {
      bannedPlayerCount += group._count._all;
    }
  }

  return {
    playerCount,
    activePlayerCount,
    bannedPlayerCount,
    depositTotal: decimal(depositAggregate._sum.amount),
    withdrawTotal: decimal(withdrawAggregate._sum.amount),
    betTotal: decimal(betAggregate._sum.betAmount),
    payoutTotal: decimal(betAggregate._sum.payoutAmount),
    ggr: decimal(betAggregate._sum.ggrAmount),
    platformFee: toNumber(platformFeeRows[0]?.platformFee),
    pendingWithdrawCount: pendingWithdraw._count._all,
    pendingWithdrawTotal: decimal(pendingWithdraw._sum.amount),
    aiMessageCount,
    aiPlayerCount: aiPlayerGroups.length,
    recentPlayers: recentPlayers.map((player) => ({
      id: player.id,
      username: player.username,
      balance: decimal(player.balance),
      status: player.status,
      createdAt: player.createdAt.toISOString(),
    })),
    recentTransactions: recentTransactions.map((item) => ({
      id: item.id,
      type: item.type,
      amount: decimal(item.amount),
      currency: item.currency,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      playerName: item.player?.username ?? null,
    })),
    recentAiLogs: recentAiLogs.map((log) => ({
      id: log.id,
      role: log.role,
      content: log.content,
      createdAt: log.createdAt.toISOString(),
      playerName: log.player?.username ?? null,
    })),
  };
}

/** 商户可以设置的玩家状态：active（正常）/ banned（封号）。 */
export const TENANT_PLAYER_STATUSES = ["active", "banned"] as const;
export type TenantPlayerStatus = (typeof TENANT_PLAYER_STATUSES)[number];

export function isTenantPlayerStatus(
  value: unknown,
): value is TenantPlayerStatus {
  return (
    typeof value === "string" &&
    (TENANT_PLAYER_STATUSES as readonly string[]).includes(value)
  );
}

export type TenantPlayerRow = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  balance: number;
  status: string;
  betCount: number;
  createdAt: string;
  lastLoginAt: string | null;
};

export type TenantPlayerPage = {
  items: TenantPlayerRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** 玩家搜索：昵称 / 邮箱 / 玩家 ID 模糊查询，始终叠加 tenantId。 */
export async function searchTenantPlayers(input: {
  tenantId: string;
  q?: unknown;
  status?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): Promise<TenantPlayerPage> {
  const q = normalizeSearchTerm(input.q);
  const status = isTenantPlayerStatus(input.status) ? input.status : "";
  const { page, pageSize, skip } = normalizePaging(input);

  const where: Prisma.PlayerWhereInput = {
    tenantId: input.tenantId,
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { username: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { id: q },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.player.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        balance: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { betRecords: true } },
      },
    }),
    prisma.player.count({ where }),
  ]);

  return {
    items: items.map((player) => ({
      id: player.id,
      username: player.username,
      email: player.email,
      phone: player.phone,
      balance: decimal(player.balance),
      status: player.status,
      betCount: player._count.betRecords,
      createdAt: player.createdAt.toISOString(),
      lastLoginAt: player.lastLoginAt?.toISOString() ?? null,
    })),
    total,
    page,
    pageSize,
  };
}

export type TenantPlayerDetail = TenantPlayerRow & {
  walletAddress: string | null;
  referralCode: string;
  depositTotal: number;
  withdrawTotal: number;
  pendingWithdrawCount: number;
  recentTransactions: TenantOverviewTransaction[];
  recentAiLogs: TenantOverviewAiLog[];
};

/**
 * 玩家详情：先按 { id, tenantId } 找到玩家（找不到 = 不属于本商户），
 * 再用 tenantId + playerId 双条件读子表，避免任何一条 SQL 只靠 playerId。
 */
export async function loadTenantPlayerDetail(input: {
  tenantId: string;
  playerId: string;
}): Promise<TenantPlayerDetail | null> {
  const player = await prisma.player.findFirst({
    where: { id: input.playerId, tenantId: input.tenantId },
    select: {
      id: true,
      username: true,
      email: true,
      phone: true,
      balance: true,
      status: true,
      walletAddress: true,
      referralCode: true,
      createdAt: true,
      lastLoginAt: true,
      _count: { select: { betRecords: true } },
    },
  });

  if (!player) {
    return null;
  }

  const scope = { tenantId: input.tenantId, playerId: player.id };

  const [
    depositAggregate,
    withdrawAggregate,
    pendingWithdraw,
    recentTransactions,
    recentAiLogs,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: { ...scope, type: "deposit", status: "success" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...scope, type: "withdraw", status: "success" },
      _sum: { amount: true },
    }),
    prisma.withdrawal.count({ where: { ...scope, status: "pending" } }),
    prisma.transaction.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.aiChatLog.findMany({
      where: { ...scope, agentType: "support" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, role: true, content: true, createdAt: true },
    }),
  ]);

  return {
    id: player.id,
    username: player.username,
    email: player.email,
    phone: player.phone,
    balance: decimal(player.balance),
    status: player.status,
    betCount: player._count.betRecords,
    createdAt: player.createdAt.toISOString(),
    lastLoginAt: player.lastLoginAt?.toISOString() ?? null,
    walletAddress: player.walletAddress,
    referralCode: player.referralCode,
    depositTotal: decimal(depositAggregate._sum.amount),
    withdrawTotal: decimal(withdrawAggregate._sum.amount),
    pendingWithdrawCount: pendingWithdraw,
    recentTransactions: recentTransactions.map((item) => ({
      id: item.id,
      type: item.type,
      amount: decimal(item.amount),
      currency: item.currency,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      playerName: player.username,
    })),
    recentAiLogs: recentAiLogs.map((log) => ({
      id: log.id,
      role: log.role,
      content: log.content,
      createdAt: log.createdAt.toISOString(),
      playerName: player.username,
    })),
  };
}

/**
 * 封号 / 解封：updateMany 的 where 同时带 id 与 tenantId。
 * count = 0 说明玩家不存在或不属于当前商户，接口统一返回 404（不区分两者，避免探测）。
 */
export async function setTenantPlayerStatus(input: {
  tenantId: string;
  playerId: string;
  status: TenantPlayerStatus;
}): Promise<TenantPlayerRow | null> {
  const result = await prisma.player.updateMany({
    where: { id: input.playerId, tenantId: input.tenantId },
    data: { status: input.status },
  });

  if (result.count === 0) {
    return null;
  }

  const player = await prisma.player.findFirst({
    where: { id: input.playerId, tenantId: input.tenantId },
    select: {
      id: true,
      username: true,
      email: true,
      phone: true,
      balance: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      _count: { select: { betRecords: true } },
    },
  });

  if (!player) {
    return null;
  }

  return {
    id: player.id,
    username: player.username,
    email: player.email,
    phone: player.phone,
    balance: decimal(player.balance),
    status: player.status,
    betCount: player._count.betRecords,
    createdAt: player.createdAt.toISOString(),
    lastLoginAt: player.lastLoginAt?.toISOString() ?? null,
  };
}

/** 商户财务流水：入金（DepositOrder）/ 出金（Withdrawal），只读。 */
export const TENANT_FINANCE_KINDS = ["deposit", "withdraw"] as const;
export type TenantFinanceKind = (typeof TENANT_FINANCE_KINDS)[number];

export function isTenantFinanceKind(
  value: unknown,
): value is TenantFinanceKind {
  return (
    typeof value === "string" &&
    (TENANT_FINANCE_KINDS as readonly string[]).includes(value)
  );
}

export type TenantFinanceRow = {
  id: string;
  kind: TenantFinanceKind;
  playerName: string | null;
  amount: number;
  currency: string;
  status: string;
  /** 入金显示支付商单号 / 哈希，出金显示收款钱包地址（商户只读） */
  reference: string | null;
  gatewayName: string | null;
  createdAt: string;
};

export type TenantFinancePage = {
  /** 本站记账币种（`Tenant.currency`），金额展示一律用它走 formatDisplayAmount */
  currency: string;
  kind: TenantFinanceKind;
  items: TenantFinanceRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    successTotal: number;
    pendingTotal: number;
    failedTotal: number;
  };
};

async function summarizeMoneyGroups(
  groups: readonly { status: string; _sum: { amount: Prisma.Decimal | null } }[],
) {
  const summary = { successTotal: 0, pendingTotal: 0, failedTotal: 0 };

  for (const group of groups) {
    const amount = decimal(group._sum.amount);

    if (group.status === "success") {
      summary.successTotal += amount;
    } else if (group.status === "pending") {
      summary.pendingTotal += amount;
    } else {
      summary.failedTotal += amount;
    }
  }

  return summary;
}

/**
 * 财务流水查询。
 *
 * 入金读 DepositOrder、出金读 Withdrawal，两者都有 tenantId 字段，
 * 因此同一条 where 既用于列表、计数，也用于汇总，不会出现「列表隔离了、
 * 汇总却统计了全平台」这类漏洞。
 */
/** 后台金额展示用的记账币种（脏数据 / 缺租户一律回落 DEFAULT_CURRENCY，绝不返回空串）。 */
async function loadTenantCurrency(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { currency: true },
  });

  return normalizeCurrency(tenant?.currency);
}

export async function loadTenantFinance(input: {
  tenantId: string;
  kind?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): Promise<TenantFinancePage> {
  const kind = isTenantFinanceKind(input.kind) ? input.kind : "deposit";
  // 金额符号只能来自本站记账币种，禁止在组件里写死 $
  const currency = await loadTenantCurrency(input.tenantId);
  const { page, pageSize, skip } = normalizePaging(input);
  const tenantId = input.tenantId;

  if (kind === "deposit") {
    const where: Prisma.DepositOrderWhereInput = { tenantId };
    const [items, total, groups] = await Promise.all([
      prisma.depositOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          txHash: true,
          createdAt: true,
          player: { select: { username: true } },
          gateway: { select: { name: true } },
        },
      }),
      prisma.depositOrder.count({ where }),
      prisma.depositOrder.groupBy({
        by: ["status"],
        where,
        _sum: { amount: true },
      }),
    ]);

    return {
      currency,
      kind,
      items: items.map((item) => ({
        id: item.id,
        kind,
        playerName: item.player.username,
        amount: decimal(item.amount),
        currency: item.currency,
        status: item.status,
        reference: item.txHash,
        gatewayName: item.gateway.name,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      summary: await summarizeMoneyGroups(groups),
    };
  }

  const where: Prisma.WithdrawalWhereInput = { tenantId };
  const [items, total, groups] = await Promise.all([
    prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        walletAddress: true,
        createdAt: true,
        player: { select: { username: true } },
        gateway: { select: { name: true } },
      },
    }),
    prisma.withdrawal.count({ where }),
    prisma.withdrawal.groupBy({
      by: ["status"],
      where,
      _sum: { amount: true },
    }),
  ]);

  return {
    currency,
    kind,
    items: items.map((item) => ({
      id: item.id,
      kind,
      playerName: item.player?.username ?? null,
      amount: decimal(item.amount),
      currency: item.currency,
      status: item.status,
      reference: item.walletAddress,
      gatewayName: item.gateway?.name ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    summary: await summarizeMoneyGroups(groups),
  };
}


/* ------------------------------------------------------------------ *
 * 提现审批（商户端）
 *
 * 商户就是出款方，所以审批必须落在商户后台；口径与代付商回调完全一致，
 * 两条路径共用同一套 CAS 状态迁移，绝不会把同一笔钱扣两次。
 * ------------------------------------------------------------------ */

/** 待审批列表一次最多取多少条（正常不会过百，留个上限防止极端数据把页面撑爆） */
const PENDING_WITHDRAWAL_LIMIT = 200;
/** 审批台下方「最近已处理」条数 */
const RECENT_WITHDRAWAL_LIMIT = 10;

const WITHDRAWAL_SELECT = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  /** 智能路由原因快照（为什么这单自动 / 为什么转人工） */
  riskStatus: true,
  /** 是否走过自动出款 */
  isAuto: true,
  walletAddress: true,
  createdAt: true,
  processedAt: true,
  player: { select: { username: true } },
  gateway: { select: { name: true } },
} satisfies Prisma.WithdrawalSelect;

type WithdrawalRowPayload = Prisma.WithdrawalGetPayload<{
  select: typeof WITHDRAWAL_SELECT;
}>;

export type TenantWithdrawalRow = {
  id: string;
  playerName: string | null;
  amount: number;
  currency: string;
  status: string;
  /** 路由原因：auto_queued / auto_paid / auto_payout_failed / manual_* */
  riskStatus: string | null;
  /** 是否走了自动出款通道 */
  isAuto: boolean;
  /** 收款账号（已掩码：银行账号只留后 4 位） */
  account: string;
  gatewayName: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type TenantWithdrawalBoard = {
  /** 本站记账币种，前端金额符号只能用它 */
  currency: string;
  /** 待人工审批（pending），老单在前（积压最久的先处理） */
  pending: TenantWithdrawalRow[];
  pendingTotalAmount: number;
  /**
   * 自动出款中（processing）：已经提交给商户的代付 API，正在等结果。
   * 不出审批按钮（自动流程还没终结，人工介入会重复出款），但要看得见。
   */
  processing: TenantWithdrawalRow[];
  processingTotalAmount: number;
  /** 最近已处理（success / failed），只用于对账查看 */
  recent: TenantWithdrawalRow[];
};

function mapWithdrawalRow(row: WithdrawalRowPayload): TenantWithdrawalRow {
  return {
    id: row.id,
    playerName: row.player?.username ?? null,
    amount: decimal(row.amount),
    currency: row.currency,
    status: row.status,
    riskStatus: row.riskStatus,
    isAuto: row.isAuto,
    account: maskWithdrawalDestination(row.walletAddress),
    gatewayName: row.gateway?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

/**
 * 审批台数据：待审批全量 + 最近已处理，全部按 tenantId 过滤。
 *
 * 待审批不翻页：列表第一屏就是「还有多少笔钱等着出款」，
 * 让商户翻页才能看全是导致积压的直接原因。
 */
export async function loadTenantWithdrawalBoard(input: {
  tenantId: string;
}): Promise<TenantWithdrawalBoard> {
  const tenantId = input.tenantId;

  const [tenant, inFlight, recent] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    }),
    prisma.withdrawal.findMany({
      // pending（人工待审）与 processing（自动出款中）都是「还没结账的钱」，
      // 一次查回来再按状态拆开：商户要能同时看到「等我点」和「系统在打」。
      where: { tenantId, status: { in: inFlightWithdrawalStatusList() } },
      orderBy: { createdAt: "asc" },
      take: PENDING_WITHDRAWAL_LIMIT,
      select: WITHDRAWAL_SELECT,
    }),
    prisma.withdrawal.findMany({
      where: { tenantId, status: { in: ["success", "failed"] } },
      orderBy: [
        { processedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: RECENT_WITHDRAWAL_LIMIT,
      select: WITHDRAWAL_SELECT,
    }),
  ]);

  const pendingRows = inFlight.filter(
    (row) => row.status === WITHDRAWAL_STATUS_PENDING,
  );
  const processingRows = inFlight.filter(
    (row) => row.status === WITHDRAWAL_STATUS_PROCESSING,
  );

  return {
    currency: normalizeCurrency(tenant?.currency),
    pending: pendingRows.map(mapWithdrawalRow),
    pendingTotalAmount: pendingRows.reduce(
      (sum, item) => sum + decimal(item.amount),
      0,
    ),
    processing: processingRows.map(mapWithdrawalRow),
    processingTotalAmount: processingRows.reduce(
      (sum, item) => sum + decimal(item.amount),
      0,
    ),
    recent: recent.map(mapWithdrawalRow),
  };
}

/**
 * 侧边栏角标用的待审批笔数。
 *
 * 每个后台页面都会渲染导航栏，所以这里只允许一条走索引的 count；
 * 出错时返回 0 —— 一个角标不该把整个控制台打挂。
 */
export async function countTenantPendingWithdrawals(
  tenantId: string,
): Promise<number> {
  try {
    return await prisma.withdrawal.count({
      where: { tenantId, status: "pending" },
    });
  } catch (error) {
    console.error("统计待审批提现失败:", error);
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * 充值人工审核（静态码 / 银行转账）
 *
 * 资金安全红线：这两类通道的钱直接进商户自己的银行账户，系统拿不到
 * 「支付商已收款」的机器凭证，因此**永不自动上分**。
 * 回调 / 玩家点「我已完成支付」只把订单挂进这里的待审队列
 * （status 仍是 pending + manualReviewStatus=pending），
 * 商户核对银行流水后点【确认到账】才真正写余额与流水。
 * ------------------------------------------------------------------ */

/** 待审队列一次最多返回多少条（积压时先看最早的，不给翻页）。 */
const PENDING_DEPOSIT_LIMIT = 200;
const RECENT_DEPOSIT_REVIEW_LIMIT = 30;

const DEPOSIT_REVIEW_SELECT = {
  id: true,
  orderNo: true,
  amount: true,
  currency: true,
  status: true,
  manualReviewStatus: true,
  callbackAmount: true,
  callbackTxHash: true,
  callbackReceivedAt: true,
  createdAt: true,
  player: { select: { username: true } },
  gateway: { select: { name: true, gatewayType: true } },
} satisfies Prisma.DepositOrderSelect;

type DepositReviewRecord = Prisma.DepositOrderGetPayload<{
  select: typeof DEPOSIT_REVIEW_SELECT;
}>;

export type TenantDepositReviewRow = {
  id: string;
  orderNo: string | null;
  playerName: string | null;
  /** 订单金额（= 数据库权威金额，上分只认它） */
  amount: number;
  currency: string;
  gatewayName: string;
  gatewayType: GatewayTypeValue;
  /** 支付商回调带回的金额（静态码常常没有，null = 未收到数值） */
  callbackAmount: number | null;
  callbackTxHash: string | null;
  callbackReceivedAt: string | null;
  createdAt: string;
  /** pending（等商户确认）/ approved（已到账）/ rejected（已驳回） */
  manualReviewStatus: string;
  /**
   * 玩家侧「已付款」信号是否已收到。
   * false = 玩家扫码付了钱却关掉页面 / 银行转账看不出备注：
   * 商户仍可核对银行流水后主动确认，但界面要标出来「无信号，请自行核对」。
   */
  signalReceived: boolean;
};

export type TenantDepositReviewBoard = {
  /** 本站记账币种（`Tenant.currency`），金额展示一律走 formatDisplayAmount */
  currency: string;
  /** 等人工确认的充值单（最早提交的排最前） */
  pending: TenantDepositReviewRow[];
  pendingTotalAmount: number;
  /** 最近已处理的单（只读，留痕用） */
  recent: TenantDepositReviewRow[];
};

function mapDepositReviewRow(
  item: DepositReviewRecord,
): TenantDepositReviewRow {
  return {
    id: item.id,
    orderNo: item.orderNo,
    playerName: item.player.username,
    amount: decimal(item.amount),
    currency: normalizeCurrency(item.currency),
    gatewayName: item.gateway.name,
    gatewayType: item.gateway.gatewayType,
    callbackAmount:
      item.callbackAmount === null ? null : decimal(item.callbackAmount),
    callbackTxHash: item.callbackTxHash,
    callbackReceivedAt: item.callbackReceivedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    manualReviewStatus: item.manualReviewStatus ?? "",
    signalReceived: item.manualReviewStatus === DEPOSIT_MANUAL_REVIEW_PENDING,
  };
}

/**
 * 待审队列。
 *
 * where 同时带 tenantId 与 gatewayType 白名单：别家的单在这里等价于「不存在」，
 * 且只捞「人工审核通道」（静态码 / 银行转账）的 pending 单。
 *
 * 为什么「没收到付款信号」的单也要列出来：
 * 玩家扫码付了钱却把弹窗关掉（没点「我已付款」），订单就永远不会自己冒出来 ——
 * 商户只能对着银行流水一笔笔找。这类单排在队列里但标 `signalReceived=false`，
 * 由商户自己核对流水后决定确认还是驳回。
 */
export async function loadTenantDepositReviewBoard(input: {
  tenantId: string;
}): Promise<TenantDepositReviewBoard> {
  const [tenant, pendingRows, recentRows] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { currency: true },
    }),
    prisma.depositOrder.findMany({
      where: {
        tenantId: input.tenantId,
        status: "pending",
        gateway: {
          gatewayType: { in: [...MANUAL_REVIEW_GATEWAY_TYPES] },
        },
      },
      // 有信号的排前面（那是玩家在等钱），无信号的按时间排在后面
      orderBy: [
        { manualReviewStatus: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      take: PENDING_DEPOSIT_LIMIT,
      select: DEPOSIT_REVIEW_SELECT,
    }),
    prisma.depositOrder.findMany({
      where: {
        tenantId: input.tenantId,
        manualReviewStatus: { in: ["approved", "rejected"] },
      },
      orderBy: { callbackReceivedAt: { sort: "desc", nulls: "last" } },
      take: RECENT_DEPOSIT_REVIEW_LIMIT,
      select: DEPOSIT_REVIEW_SELECT,
    }),
  ]);

  return {
    currency: normalizeCurrency(tenant?.currency),
    pending: pendingRows.map(mapDepositReviewRow),
    pendingTotalAmount: pendingRows.reduce(
      (sum, item) => sum + decimal(item.amount),
      0,
    ),
    recent: recentRows.map(mapDepositReviewRow),
  };
}

/**
 * 侧边栏「充值审核」角标用的待审笔数。
 *
 * 口径必须与 loadTenantDepositReviewBoard 完全一致（同一组 where），
 * 否则角标写着 3、点进去只有 1 —— 商户会以为系统丢了单。
 * 与提现角标同一纪律：只允许一条走索引的 count，出错返回 0。
 */
export async function countTenantPendingDepositReviews(
  tenantId: string,
): Promise<number> {
  try {
    return await prisma.depositOrder.count({
      where: {
        tenantId,
        status: "pending",
        gateway: {
          gatewayType: { in: [...MANUAL_REVIEW_GATEWAY_TYPES] },
        },
      },
    });
  } catch (error) {
    console.error("统计待审核充值失败:", error);
    return 0;
  }
}

export type TenantDepositReviewAction = "approve" | "reject";

export type TenantDepositReviewResult =
  | {
      ok: true;
      action: TenantDepositReviewAction;
      status: "success" | "failed";
      playerName: string | null;
      amount: number;
      currency: string;
      balance?: string;
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "not_awaiting_review"
        | "already_credited"
        | "duplicate_reference"
        | "not_manual_review_channel";
      message: string;
    };

/**
 * 商户确认 / 驳回一笔待人工审核的充值。
 *
 * 这是静态码 / 银行转账**唯一**的上分入口，因此口径必须比回调更严：
 * - approve = `pending → success`，加 `Player.balance` 并写 `Transaction(type=deposit)`，
 *   三步复用同一个事务里的 settleDepositOrder（与自动上分完全同一份实现），
 *   CAS 条件额外带 `manualReviewStatus=pending`：商户连点两次、
 *   或两个人同时点，都只会加一次钱。
 * - reject = `pending → failed`，不动余额、不写流水。
 * - tenantId 只来自会话；别家商户的单号在这里等价于「不存在」，统一 404。
 * - 上分用的 txHash 优先取支付商回调带回来的交易号（人工核对时能看到），
 *   没有就用 `manual-<订单id>`；两者都要过 `@@unique([gatewayId, txHash])`，
 *   同一张银行流水被登记到第二笔订单时直接失败（duplicate_reference），
 *   绝不「两笔单共用一张流水」。
 */
export async function reviewTenantDeposit(input: {
  tenantId: string;
  orderId: string;
  action: TenantDepositReviewAction;
}): Promise<TenantDepositReviewResult> {
  const order = await prisma.depositOrder.findFirst({
    where: { id: input.orderId, tenantId: input.tenantId },
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      manualReviewStatus: true,
      callbackTxHash: true,
      player: { select: { username: true } },
      gateway: { select: { gatewayType: true } },
    },
  });

  if (!order) {
    return { ok: false, code: "not_found", message: "充值订单不存在" };
  }

  // 自动上分通道（跳转网银 / 动态二维码）不在这条人工链路上：
  // 它们的钱由支付商回调确认，人工改单会绕开对账，属于另一种工单，这里一律拒绝。
  if (!gatewayRequiresManualReview(order.gateway.gatewayType)) {
    return {
      ok: false,
      code: "not_manual_review_channel",
      message: "该通道由支付商自动确认到账，不能人工改单",
    };
  }

  if (order.status === "success") {
    return {
      ok: false,
      code: "already_credited",
      message: "该订单已上分，不能重复确认",
    };
  }

  if (order.status !== "pending") {
    return {
      ok: false,
      code: "not_awaiting_review",
      message: "该订单已关闭，请让玩家重新下单",
    };
  }

  /**
   * CAS 期望值：
   * - `"pending"` = 已收到玩家 / 支付商的付款信号；
   * - `null`      = 还没有任何信号（玩家付完就关页面、银行转账看不出备注），
   *                 商户核对银行流水后主动确认。
   * 两者都允许，但都必须精确匹配 —— 否则就是「已经处理过了」，不能动钱。
   */
  const expectedManualReviewStatus: "pending" | null =
    order.manualReviewStatus === DEPOSIT_MANUAL_REVIEW_PENDING ? "pending" : null;

  if (
    order.manualReviewStatus !== null &&
    order.manualReviewStatus !== DEPOSIT_MANUAL_REVIEW_PENDING
  ) {
    return {
      ok: false,
      code: "not_awaiting_review",
      message: "该订单已被处理，请刷新后重试",
    };
  }

  const playerName = order.player.username;
  const currency = normalizeCurrency(order.currency);
  const amount = decimal(order.amount);

  if (input.action === "reject") {
    const failed = await failDepositOrder({
      orderId: order.id,
      txHash: null,
      tenantId: input.tenantId,
      expectManualReviewStatus: expectedManualReviewStatus,
    });

    switch (failed.kind) {
      case "failed":
        return {
          ok: true,
          action: input.action,
          status: "failed",
          playerName,
          amount,
          currency,
        };
      case "not-found":
        return { ok: false, code: "not_found", message: "充值订单不存在" };
      case "already-success":
        return {
          ok: false,
          code: "already_credited",
          message: "该订单已上分，不能驳回",
        };
      case "already-failed":
      case "not-awaiting-review":
        return {
          ok: false,
          code: "not_awaiting_review",
          message: "该订单已被处理，请刷新后重试",
        };
      default:
        return {
          ok: false,
          code: "not_awaiting_review",
          message: "订单状态异常，无法驳回",
        };
    }
  }

  const callbackTxHash = (order.callbackTxHash ?? "").trim();
  const txHash = callbackTxHash || `manual-${order.id}`;

  try {
    const settled = await settleDepositOrder({
      orderId: order.id,
      txHash,
      tenantId: input.tenantId,
      expectManualReviewStatus: expectedManualReviewStatus,
    });

    switch (settled.kind) {
      case "credited":
        return {
          ok: true,
          action: input.action,
          status: "success",
          playerName,
          amount,
          currency,
          balance: settled.balance,
        };
      case "already-success":
        return {
          ok: false,
          code: "already_credited",
          message: "该订单已上分，不能重复确认",
        };
      case "not-found":
        return { ok: false, code: "not_found", message: "充值订单不存在" };
      case "already-failed":
      case "not-awaiting-review":
        return {
          ok: false,
          code: "not_awaiting_review",
          message: "该订单已被处理，请刷新后重试",
        };
      default:
        return {
          ok: false,
          code: "not_awaiting_review",
          message: "订单状态异常，无法确认到账",
        };
    }
  } catch (error) {
    // @@unique([gatewayId, txHash])：同一个支付商交易号想入账到第二笔订单，
    // 典型场景是商户把同一张银行流水确认了两次（两笔单）。
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      console.error("[ALARM][tenant-deposit-review] 交易号重复使用", {
        orderId: order.id,
        tenantId: input.tenantId,
        error: error.message,
      });

      return {
        ok: false,
        code: "duplicate_reference",
        message: "该支付商交易号已被其他充值订单使用，请核对银行流水后重试",
      };
    }

    throw error;
  }
}

export type TenantWithdrawalReviewAction = "approve" | "reject";

export type TenantWithdrawalReviewResult =
  | {
      ok: true;
      action: TenantWithdrawalReviewAction;
      status: "success" | "failed";
      playerName: string | null;
      amount: number;
      currency: string;
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "not_pending"
        | "in_progress"
        | "no_player"
        | "insufficient_balance"
        | "duplicate_reference";
      message: string;
    };

/**
 * 商户审批提现。
 *
 * 口径与代付商回调 `/api/withdrawal/callback`、自动出款引擎完全一致 ——
 * 三者是同一笔出款的三种触发方式，共用 src/lib/withdrawal-settlement.ts：
 *
 * - approve：`pending → success`，扣 `Player.balance` 并写一条
 *   `Transaction(type=withdraw)`，三步在同一事务内。
 *   状态迁移用 `updateMany({ where: { status: "pending" } })` 做 compare-and-swap，
 *   所以「商户点了通过 + 代付商又回调成功」不会扣两次，只有抢到迁移的请求才动余额。
 * - reject：`pending → failed`，不动余额、不写流水（玩家可以重新提单）。
 * - `processing`（自动出款在途）**不接受**人工审批：自动流程还没终结，
 *   人工再点一次会变成重复出款，所以直接返回 409 in_progress。
 * - 不创建、不扣减任何平台内部资金账户；tenantId 只来自会话，
 *   别家商户的单号在这里等价于「不存在」。
 * - `Withdrawal.approvals` 在通过时 +1 作为留痕；`requiredApprovals > 1` 的
 *   多人复核流程尚未启用（当前一律单人审批即终审），不做半吊子计数。
 */
export async function reviewTenantWithdrawal(input: {
  tenantId: string;
  withdrawalId: string;
  action: TenantWithdrawalReviewAction;
  /** 人工打款的银行流水号 / 代付单号（可选） */
  reference?: string;
}): Promise<TenantWithdrawalReviewResult> {
  const current = await prisma.withdrawal.findFirst({
    where: { id: input.withdrawalId, tenantId: input.tenantId },
    select: {
      id: true,
      playerId: true,
      amount: true,
      currency: true,
      status: true,
      player: { select: { username: true } },
    },
  });

  if (!current) {
    return { ok: false, code: "not_found", message: "提现单不存在" };
  }

  // 自动出款在途（processing）不允许人工介入：代付 API 已经在打款，
  // 这时点 Approve 会「自动打一次 + 人工再打一次」，点 Reject 更糟
  // （钱可能已经出去了，单据却被置失败）。只能等代付结果回来。
  if (current.status === WITHDRAWAL_STATUS_PROCESSING) {
    return {
      ok: false,
      code: "in_progress",
      message: "该提现单正在自动出款中，请等代付结果返回后再操作",
    };
  }

  if (current.status !== WITHDRAWAL_STATUS_PENDING) {
    return {
      ok: false,
      code: "not_pending",
      message: "该提现单已处理完成，无需重复操作",
    };
  }

  const reference =
    typeof input.reference === "string" && input.reference.trim()
      ? input.reference.trim().slice(0, 200)
      : null;
  const playerName = current.player?.username ?? null;

  if (input.action === "reject") {
    const rejected = await markWithdrawalFailed({
      withdrawalId: current.id,
      tenantId: input.tenantId,
      fromStatuses: [WITHDRAWAL_STATUS_PENDING],
    });

    if (!rejected.changed) {
      return {
        ok: false,
        code: "not_pending",
        message: "该提现单已被处理，请刷新后重试",
      };
    }

    return {
      ok: true,
      action: "reject",
      status: "failed",
      playerName,
      amount: decimal(current.amount),
      currency: current.currency,
    };
  }

  if (!current.playerId) {
    return {
      ok: false,
      code: "no_player",
      message: "提现单未绑定玩家，无法扣减余额",
    };
  }

  // 与代付回调 / 自动出款走同一份结算实现（pending → success + 扣余额 + 写流水）。
  const settled = await settleWithdrawalSuccess({
    withdrawalId: current.id,
    tenantId: input.tenantId,
    fromStatuses: [WITHDRAWAL_STATUS_PENDING],
    txHash: reference,
    incrementApprovals: true,
  });

  if (!settled.settled) {
    if (settled.reason === "insufficient_balance") {
      return {
        ok: false,
        code: "insufficient_balance",
        message: "玩家当前余额不足以扣减这笔提现，请先核对余额",
      };
    }

    if (settled.reason === "duplicate_reference") {
      return {
        ok: false,
        code: "duplicate_reference",
        message: "该流水号已被其它提现单使用",
      };
    }

    return {
      ok: false,
      code: "not_pending",
      message: "该提现单已被处理，请刷新后重试",
    };
  }

  return {
    ok: true,
    action: "approve",
    status: "success",
    playerName,
    amount: decimal(current.amount),
    currency: current.currency,
  };
}

/** AI 客服监控：只读玩家与 AI 客服（agentType=support）的对话。 */
export type TenantAiLogRow = {
  id: string;
  role: string;
  content: string;
  playerId: string | null;
  playerName: string | null;
  createdAt: string;
};

export type TenantAiPlayerOption = {
  id: string;
  username: string;
};

export type TenantAiLogPage = {
  items: TenantAiLogRow[];
  total: number;
  page: number;
  pageSize: number;
  /** 下拉筛选用的玩家列表（只列当前租户在客服窗口里出现过的玩家） */
  players: TenantAiPlayerOption[];
};

/**
 * AI 客服对话查询。
 *
 * 三个条件缺一不可：agentType=support（玩家侧客服）、tenantId（当前商户）、
 * 可选的 playerId（且先用 { id, tenantId } 校验该玩家确实属于本商户）。
 * 平台侧的销冠 AI 日志（tenantId 为空）永远不会出现在这里。
 */
export async function loadTenantAiLogs(input: {
  tenantId: string;
  q?: unknown;
  playerId?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): Promise<TenantAiLogPage> {
  const tenantId = input.tenantId;
  const q = normalizeSearchTerm(input.q);
  const { page, pageSize, skip } = normalizePaging(input);
  const rawPlayerId =
    typeof input.playerId === "string" ? input.playerId.trim() : "";

  let playerId = "";

  if (rawPlayerId) {
    const owned = await prisma.player.findFirst({
      where: { id: rawPlayerId, tenantId },
      select: { id: true },
    });

    playerId = owned?.id ?? "";
  }

  const where: Prisma.AiChatLogWhereInput = {
    tenantId,
    agentType: "support",
    ...(playerId ? { playerId } : {}),
    ...(q ? { content: { contains: q, mode: "insensitive" } } : {}),
  };

  const [items, total, playerGroups] = await Promise.all([
    prisma.aiChatLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        role: true,
        content: true,
        playerId: true,
        createdAt: true,
        player: { select: { username: true } },
      },
    }),
    prisma.aiChatLog.count({ where }),
    prisma.aiChatLog.groupBy({
      by: ["playerId"],
      where: { tenantId, agentType: "support" },
    }),
  ]);

  const playerIds = playerGroups
    .map((group) => group.playerId)
    .filter((id): id is string => Boolean(id));

  const players = playerIds.length
    ? await prisma.player.findMany({
        where: { tenantId, id: { in: playerIds } },
        orderBy: { username: "asc" },
        select: { id: true, username: true },
      })
    : [];

  return {
    items: items.map((log) => ({
      id: log.id,
      role: log.role,
      content: log.content,
      playerId: log.playerId,
      playerName: log.player?.username ?? null,
      createdAt: log.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    players,
  };
}


/**
 * 站点设置：商户只能改自己站的皮肤 / 大厅模块开关 / 备用域名池。
 *
 * 刻意不含 logoUrl（品牌 Logo）：它是平台配置项，只能由超管在
 * 【租户管理 → 新建 / 编辑租户】里上传或清空，商户后台既不展示也不可改。
 * 玩家面渲染统一读 storefront / player session 里的 tenantLogoUrl。
 */
export type TenantSiteSettings = {
  tenantId: string;
  tenantName: string;
  /** 备用域名池（多域名防封自动切换，1-5 条；空数组 = 未配置，不自动跳转） */
  backupDomains: string[];
  domain: string;
  subdomain: string;
  status: string;
  themeColor: StorefrontThemeSetting;
  layout: StorefrontLayout;
  updatedAt: string;
};

export type TenantSettingsResult =
  | { ok: true; settings: TenantSiteSettings }
  | { ok: false; error: string };

async function readTenantSettings(
  tenantId: string,
): Promise<TenantSiteSettings | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      domain: true,
      subdomain: true,
      backupDomains: true,
      status: true,
      themeColor: true,
      layoutConfig: true,
      updatedAt: true,
    },
  });

  if (!tenant) {
    return null;
  }

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    backupDomains: tenant.backupDomains.map((item) => item.toLowerCase()),
    domain: tenant.domain,
    subdomain: tenant.subdomain,
    status: tenant.status,
    themeColor: parseThemeSetting(tenant.themeColor),
    layout: normalizeStorefrontLayout(tenant.layoutConfig),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

export async function loadTenantSiteSettings(
  tenantId: string,
): Promise<TenantSiteSettings | null> {
  return readTenantSettings(tenantId);
}

/**
 * 保存站点设置（商户自助范围）。
 *
 * - themeColor：严格校验（readThemeSettingInput），非法直接 400，
 *   不静默改成默认金色；未传则保留数据库原值；
 * - layout：只覆盖请求里出现的字段（modules / showTopbarChat /
 *   showSidebarCasinoAnim），其余沿用原值，避免把没传的开关重置成默认；
 *   其中的 themeBackground / gameCardStyle 会被强制忽略（平台配置项）；
 * - **不接受 logoUrl**：品牌 Logo 的唯一写入口是超管的
 *   PUT /api/tenants/[id] + POST /api/admin/tenant-logos/upload，
 *   商户即使构造请求带上这个字段也改不动（函数签名里根本没有它）；
 * - where 固定用会话里的 tenantId，商户无法改别人的站。
 */
export async function saveTenantSiteSettings(input: {
  tenantId: string;
  themeColor?: unknown;
  layout?: unknown;
  /** 备用域名池：支持数组或逗号 / 换行分隔的文本，`[]` = 清空 */
  backupDomains?: unknown;
}): Promise<TenantSettingsResult> {
  const current = await readTenantSettings(input.tenantId);

  if (!current) {
    return { ok: false, error: "站点不存在或已被停用" };
  }

  const data: Prisma.TenantUpdateInput = {};

  if (input.themeColor !== undefined) {
    const theme = readThemeSettingInput(input.themeColor);

    if (!theme) {
      return {
        ok: false,
        error: "主色必须是 #d4af37 这样的十六进制颜色，深浅调节必须是 0-100 的数字",
      };
    }

    data.themeColor = serializeThemeSetting(theme);
  }

  if (input.layout !== undefined) {
    const patch: Record<string, unknown> =
      input.layout && typeof input.layout === "object" && !Array.isArray(input.layout)
        ? { ...(input.layout as Record<string, unknown>) }
        : {};

    // 主题背景色是平台配置项（合规决策，见 AGENTS.md 4.1）：
    // 只能由超管在【租户管理 → 新增 / 编辑租户】时写入。
    // 商户后台即使构造请求带上这个字段也必须忽略，否则等于开了后门。
    // 老的 gameCardStyle（3 种封面风格）同样必须忽略。
    delete patch.themeBackground;
    delete patch.gameCardStyle;

    data.layoutConfig = serializeLayoutConfig(
      normalizeStorefrontLayout({ ...current.layout, ...patch }),
    );
  }

  // 品牌 Logo（logoUrl）刻意不处理：函数签名里没有这个字段，
  // 老调用方即使传进来也落不到 data 上（唯一写入口是超管的 PUT /api/tenants/[id]）。

  /**
   * 备用域名池（多域名防封自动切换）。
   *
   * 商户可以自助维护自己的线路：这里写的是「跳过去还是同一个站」的域名，
   * 所以必须做跨租户唯一性校验（findBackupDomainConflict）——
   * 否则 A 商户把 B 商户的域名填进池子，解析顺序一变就把玩家送到别家站。
   * 自己的主域名 / 子域名会被 reserved 静默剔除。
   */
  if (input.backupDomains !== undefined) {
    const parsed = readBackupDomainsInput(input.backupDomains, {
      reserved: [current.domain, current.subdomain],
    });

    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    const conflict = await findBackupDomainConflict(
      parsed.domains,
      input.tenantId,
    );

    if (conflict) {
      return { ok: false, error: formatBackupDomainConflict(conflict) };
    }

    data.backupDomains = { set: parsed.domains };
  }

  if (Object.keys(data).length === 0) {
    return { ok: true, settings: current };
  }

  await prisma.tenant.update({
    where: { id: input.tenantId },
    data,
    select: { id: true },
  });

  const settings = await readTenantSettings(input.tenantId);

  return settings
    ? { ok: true, settings }
    : { ok: false, error: "保存后读取站点配置失败" };
}

/* ------------------------------------------------------------------ KYC 审核 */

/**
 * 商户实名认证审核（列表 / 详情 / 通过·驳回）。
 *
 * 隔离规则与其它商户接口一致：所有 where 都带会话里的 tenantId，
 * 别家商户的申请 id 在这里等价于「不存在」，统一 404。
 * 列表里的证件号只给掩码，完整号码仅在详情接口（点开才请求）返回。
 */

export type TenantKycRow = {
  id: string;
  playerId: string;
  playerName: string;
  playerEmail: string | null;
  realName: string;
  /** 列表脱敏用：AB12****5678 */
  idNumberMasked: string;
  status: KycStatus;
  rejectReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
};

export type TenantKycCounts = {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
};

export type TenantKycPage = {
  items: TenantKycRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: TenantKycCounts;
};

export type TenantKycDetail = TenantKycRow & {
  idNumber: string;
  /** 受控访问路径，只有本商户会话能读 */
  idCardFrontUrl: string | null;
  idCardBackUrl: string | null;
  reviewedBy: string | null;
  createdAt: string;
  player: {
    id: string;
    username: string;
    email: string | null;
    balance: number;
    status: string;
    createdAt: string;
    lastLoginAt: string | null;
  };
};

const TENANT_KYC_SELECT = {
  id: true,
  realName: true,
  idNumber: true,
  status: true,
  rejectReason: true,
  createdAt: true,
  reviewedAt: true,
  player: { select: { id: true, username: true, email: true } },
} as const;

function mapTenantKycRow(record: {
  id: string;
  realName: string;
  idNumber: string;
  status: KycStatus;
  rejectReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  player: { id: string; username: string; email: string | null };
}): TenantKycRow {
  return {
    id: record.id,
    playerId: record.player.id,
    playerName: record.player.username,
    playerEmail: record.player.email,
    realName: record.realName,
    idNumberMasked: maskIdNumber(record.idNumber),
    status: record.status,
    rejectReason: record.rejectReason,
    submittedAt: record.createdAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
  };
}

/** 列表：按状态 / 关键词筛选，关键词命中玩家账号、邮箱、姓名、证件号。 */
export async function loadTenantKycPage(input: {
  tenantId: string;
  status?: unknown;
  q?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): Promise<TenantKycPage> {
  const tenantId = input.tenantId;
  const status = isKycStatus(input.status) ? input.status : "";
  const q = normalizeSearchTerm(input.q);
  const { page, pageSize, skip } = normalizePaging(input);

  const where: Prisma.PlayerKycWhereInput = {
    tenantId,
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { realName: { contains: q, mode: "insensitive" } },
            { idNumber: { contains: q.toUpperCase() } },
            {
              player: {
                is: { username: { contains: q, mode: "insensitive" } },
              },
            },
            {
              player: {
                is: { email: { contains: q, mode: "insensitive" } },
              },
            },
          ],
        }
      : {}),
  };

  const [items, total, statusGroups, allCount] = await Promise.all([
    prisma.playerKyc.findMany({
      where,
      // 待审核优先，其次按提交时间倒序
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
      select: TENANT_KYC_SELECT,
    }),
    prisma.playerKyc.count({ where }),
    prisma.playerKyc.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    }),
    prisma.playerKyc.count({ where: { tenantId } }),
  ]);

  const counts: TenantKycCounts = {
    all: allCount,
    pending: 0,
    approved: 0,
    rejected: 0,
  };

  for (const group of statusGroups) {
    counts[group.status.toLowerCase() as "pending" | "approved" | "rejected"] =
      group._count._all;
  }

  return {
    items: items.map(mapTenantKycRow),
    total,
    page,
    pageSize,
    counts,
  };
}

/** 详情：只有点开「查看详情」时才返回完整证件号与图片路径。 */
export async function loadTenantKycDetail(input: {
  tenantId: string;
  kycId: string;
}): Promise<TenantKycDetail | null> {
  const record = await prisma.playerKyc.findFirst({
    where: { id: input.kycId, tenantId: input.tenantId },
    select: {
      ...TENANT_KYC_SELECT,
      idCardFrontUrl: true,
      idCardBackUrl: true,
      reviewedBy: { select: { username: true } },
      player: {
        select: {
          id: true,
          username: true,
          email: true,
          balance: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
        },
      },
    },
  });

  if (!record) {
    return null;
  }

  return {
    ...mapTenantKycRow(record),
    idNumber: record.idNumber,
    // 库里存的是玩家侧路径，这里换成商户侧前缀（仍受会话校验保护）
    idCardFrontUrl: tenantKycFileUrl(record.idCardFrontUrl),
    idCardBackUrl: tenantKycFileUrl(record.idCardBackUrl),
    reviewedBy: record.reviewedBy?.username ?? null,
    createdAt: record.createdAt.toISOString(),
    player: {
      id: record.player.id,
      username: record.player.username,
      email: record.player.email,
      balance: decimal(record.player.balance),
      status: record.player.status,
      createdAt: record.player.createdAt.toISOString(),
      lastLoginAt: record.player.lastLoginAt?.toISOString() ?? null,
    },
  };
}

export type TenantKycReviewAction = "approve" | "reject";

export type TenantKycReviewResult =
  | { ok: true; kyc: TenantKycRow }
  | {
      ok: false;
      code: "not_found" | "not_pending" | "reason_required";
      message: string;
    };

/**
 * 审核：APPROVED / REJECTED。
 *
 * - 只处理 PENDING 的申请（updateMany 的 where 带 status，并发重复点击只有一个成功）；
 * - 驳回必须填原因，最长 200 字；
 * - 通过后玩家提现接口才放行（见 /api/withdrawal/create 的 KYC 前置校验）。
 */
export async function reviewTenantKyc(input: {
  tenantId: string;
  kycId: string;
  reviewerId: string;
  action: TenantKycReviewAction;
  rejectReason?: unknown;
}): Promise<TenantKycReviewResult> {
  const current = await prisma.playerKyc.findFirst({
    where: { id: input.kycId, tenantId: input.tenantId },
    select: { id: true, status: true },
  });

  if (!current) {
    return { ok: false, code: "not_found", message: "认证申请不存在" };
  }

  if (current.status !== "PENDING") {
    return {
      ok: false,
      code: "not_pending",
      message: "该申请已审核完成，无需重复操作",
    };
  }

  let rejectReason: string | null = null;

  if (input.action === "reject") {
    rejectReason = normalizeRejectReason(input.rejectReason);

    if (!rejectReason) {
      return {
        ok: false,
        code: "reason_required",
        message: "驳回时必须填写原因（1-200 字）",
      };
    }
  }

  const result = await prisma.playerKyc.updateMany({
    where: { id: input.kycId, tenantId: input.tenantId, status: "PENDING" },
    data: {
      status: input.action === "approve" ? "APPROVED" : "REJECTED",
      rejectReason,
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return {
      ok: false,
      code: "not_pending",
      message: "该申请已审核完成，无需重复操作",
    };
  }

  const updated = await prisma.playerKyc.findFirst({
    where: { id: input.kycId, tenantId: input.tenantId },
    select: TENANT_KYC_SELECT,
  });

  if (!updated) {
    return { ok: false, code: "not_found", message: "认证申请不存在" };
  }

  return { ok: true, kyc: mapTenantKycRow(updated) };
}

