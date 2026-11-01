import { Prisma, type KycStatus } from "@prisma/client";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { toNumber } from "./format";
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationTicket,
} from "./impersonation";
import { isKycStatus, maskIdNumber, normalizeRejectReason } from "./kyc";
import { tenantKycFileUrl } from "./kyc-storage";
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
      where: { tenantId, status: "pending" },
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
export async function loadTenantFinance(input: {
  tenantId: string;
  kind?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): Promise<TenantFinancePage> {
  const kind = isTenantFinanceKind(input.kind) ? input.kind : "deposit";
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


/** 站点设置：商户只能改自己站的皮肤 / 大厅模块开关。 */
export type TenantSiteSettings = {
  tenantId: string;
  tenantName: string;
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
 * 保存站点设置。
 *
 * - themeColor：严格校验（readThemeSettingInput），非法直接 400，
 *   不静默改成默认金色；未传则保留数据库原值；
 * - layout：只覆盖请求里出现的字段（modules / showTopbarChat /
 *   showSidebarCasinoAnim），其余沿用原值，避免把没传的开关重置成默认；
 * - where 固定用会话里的 tenantId，商户无法改别人的站。
 */
export async function saveTenantSiteSettings(input: {
  tenantId: string;
  themeColor?: unknown;
  layout?: unknown;
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
    const patch =
      input.layout && typeof input.layout === "object" && !Array.isArray(input.layout)
        ? (input.layout as Record<string, unknown>)
        : {};

    data.layoutConfig = serializeLayoutConfig(
      normalizeStorefrontLayout({ ...current.layout, ...patch }),
    );
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

