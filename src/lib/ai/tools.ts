import { normalizeCurrency } from "@/lib/currency";
import { availableBalanceToString } from "@/lib/player-balance";
import { prisma } from "@/lib/prisma";
import { inFlightWithdrawalStatusList } from "@/lib/withdrawal-status";

import type { AiAgentTypeValue } from "./constants";
import { toolsForAgent } from "./prompts";
import type { AiToolDefinition } from "./provider";

/**
 * AI 只读数据工具的「白名单 + 租户隔离」执行层。
 *
 * 红线（见 AGENTS.md 第 5 条）：
 * 1. 实时数据（余额 / 充提 / 注单）一律走 Function Calling，禁止整表塞进 Prompt；
 * 2. 只提供只读工具：不提供改余额、审批出金、改配置的写工具；
 * 3. 每条查询都必须带 tenantId，且 tenantId 只能来自登录会话（AiToolScope），
 *    模型参数里出现的 tenantId 一律不采信；
 * 4. 越权处理分两种情况，都不回显任何一家的数据：
 *    - 模型参数里带了非当前租户的 tenantId / tenant → 直接 403，根本不查库；
 *    - 按 ID 查到的记录归属不是当前租户（理论不可能，双保险）→ 403；
 *    - 在当前租户内查不到 → 404，且不做「是不是别家的」回查，
 *      避免用 403/404 的差异探测别家商户的数据是否存在；
 * 5. 返回值脱敏：不返回 API 密钥、证件号、完整钱包地址、txHash、
 *    平台点差 / GGR 等内部字段。
 *
 * 工具定义放在这里（与 prompts.ts 的「战败原因」写工具并列），
 * 真正的执行只发生在 /api/ai/chat 的服务端循环里，模型只负责给参数。
 */

/** 只读工具白名单：新增工具必须先加进这个元组，否则执行层直接 403。 */
export const READONLY_TOOL_NAMES = [
  "get_player_balance",
  "list_recent_transactions",
  "get_ticket_status",
] as const;

export type ReadonlyToolName = (typeof READONLY_TOOL_NAMES)[number];

/** 单轮对话最多执行几轮工具（防止模型来回刷工具把 token 烧光）。 */
export const AI_TOOL_MAX_ROUNDS = 2;

/** 单次对话最多回填给模型几条流水。 */
const MAX_TRANSACTION_LIMIT = 20;
const DEFAULT_TRANSACTION_LIMIT = 5;

/** 允许查询流水的类型（与 Transaction.type 的取值一致）。 */
const TRANSACTION_TYPES = ["deposit", "withdraw", "bet", "win"] as const;

/**
 * 拥有只读数据工具的助手。
 *
 * 销冠 AI 只做 B 端招商，永远看不到玩家资金 / 注单数据；
 * tech / finance / audit / strategist / support 才需要查实时数据。
 */
const READONLY_TOOL_AGENTS: readonly AiAgentTypeValue[] = [
  "tech",
  "finance",
  "audit",
  "strategist",
  "support",
];

const READONLY_TOOL_DEFINITIONS: readonly AiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_player_balance",
      description:
        "查询当前商户下某个玩家的余额与可用余额。可用余额 = 余额 − 处理中的提现合计（处理中提现不冻结余额）。只能查当前商户的玩家，跨商户会被拒绝。",
      parameters: {
        type: "object",
        properties: {
          player: {
            type: "string",
            description: "玩家账号（username）、玩家 ID 或注册邮箱，任选其一。",
          },
        },
        required: ["player"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_transactions",
      description:
        "列出当前商户最近的资金流水（充值 / 提现 / 下注 / 派彩），可按玩家或类型筛选。只返回当前商户的数据。",
      parameters: {
        type: "object",
        properties: {
          player: {
            type: "string",
            description: "可选：只看某个玩家的流水（账号 / 玩家 ID / 邮箱）。",
          },
          type: {
            type: "string",
            enum: [...TRANSACTION_TYPES],
            description: "可选：只看某一类流水。",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_TRANSACTION_LIMIT,
            description: `可选：返回条数，默认 ${DEFAULT_TRANSACTION_LIMIT}，最多 ${MAX_TRANSACTION_LIMIT}。`,
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ticket_status",
      description:
        "按注单 ID 或上游注单号查询一条注单的结算状态、下注额与派彩额（GGR 等内部字段不返回）。只查当前商户的注单。",
      parameters: {
        type: "object",
        properties: {
          ticket: {
            type: "string",
            description: "注单 ID（BetRecord.id）或上游注单号（externalId）。",
          },
          provider: {
            type: "string",
            description: "可选：游戏商名称，用于同一单号在多个游戏商下重名时消歧。",
          },
        },
        required: ["ticket"],
        additionalProperties: false,
      },
    },
  },
];


type JsonRecord = Record<string, unknown>;

/**
 * 一次工具调用唯一可信的租户边界。
 *
 * 注意：actor / delegated 只用于审计，绝不参与 where 条件；
 * 所有查询的租户过滤只能读 tenantId 这一个字段。
 */
export type AiToolScope = {
  tenantId: string;
  actor: { userId: string; role: string };
  /** true = 平台账号显式指定商户查询；false = 商户账号查自己的数据。 */
  delegated: boolean;
};

export type AiToolScopeResolution =
  /** scope=null：平台账号未指定商户 → 本次对话不下发数据工具（不是越权）。 */
  | { ok: true; scope: AiToolScope | null }
  | { ok: false; status: number; message: string };

/**
 * 从登录会话解析工具可用的租户范围。
 *
 * - 商户账号（tenant_admin）：范围只能是自己的 tenantId；
 *   若请求体传了别的 tenantId，直接 403（跨商户查询）。
 * - 平台账号：必须显式选择商户（body.tenantId），且该商户必须真实存在；
 *   没选商户时不下发工具，模型自然不会产生查询。
 */
export async function resolveAiToolScope(input: {
  user: { id: string; role: string; tenantId: string | null };
  requestedTenantId?: string | null;
}): Promise<AiToolScopeResolution> {
  const requested = (input.requestedTenantId ?? "").trim();

  if (input.user.role === "tenant_admin") {
    if (!input.user.tenantId) {
      return {
        ok: false,
        status: 403,
        message: "当前账号未绑定商户，无法查询商户数据",
      };
    }

    if (requested && requested !== input.user.tenantId) {
      return {
        ok: false,
        status: 403,
        message: "禁止跨商户查询：租户范围必须取自登录会话",
      };
    }

    return {
      ok: true,
      scope: {
        tenantId: input.user.tenantId,
        actor: { userId: input.user.id, role: input.user.role },
        delegated: false,
      },
    };
  }

  // 平台账号：没有选定商户就不给数据范围（tools 不下发，执行层也会 403）。
  if (!requested) {
    return { ok: true, scope: null };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: requested },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, status: 404, message: "tenantId 对应的商户不存在" };
  }

  return {
    ok: true,
    scope: {
      tenantId: tenant.id,
      actor: { userId: input.user.id, role: input.user.role },
      delegated: true,
    },
  };
}

export type AiToolExecution = {
  /** 是否执行成功（等价于 status === 200）。 */
  ok: boolean;
  /** 200 正常 / 400 参数不合法 / 403 越权 / 404 未找到 / 500 内部错误。 */
  status: number;
  /** 回填给模型的脱敏 JSON，模型据此组织自然语言答复。 */
  payload: JsonRecord;
};

function denied(error: string, status: number): AiToolExecution {
  return { ok: false, status, payload: { ok: false, status, error } };
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 模型给的 arguments 是字符串，解析失败时按「没给参数」处理（由工具自己报 400）。 */
function readArguments(raw: string): JsonRecord {
  const text = raw.trim();

  if (!text) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readArgumentString(args: JsonRecord, key: string): string {
  const value = args[key];

  return typeof value === "string" ? value.trim() : "";
}

/**
 * 模型可能「自作主张」把租户号塞进参数里试图跨商户查询。
 * 这些字段一律不采信：与当前会话租户不一致就 403，连库都不查。
 */
const TENANT_ARGUMENT_KEYS = [
  "tenantId",
  "tenant_id",
  "tenant",
  "merchantId",
  "siteId",
] as const;

function findForeignTenantArgument(
  args: JsonRecord,
  tenantId: string,
): string | null {
  for (const key of TENANT_ARGUMENT_KEYS) {
    const value = readArgumentString(args, key);

    if (value && value !== tenantId) {
      return value;
    }
  }

  return null;
}

function readLimit(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return DEFAULT_TRANSACTION_LIMIT;
  }

  return Math.min(Math.floor(number), MAX_TRANSACTION_LIMIT);
}

export function isReadonlyToolName(value: string): value is ReadonlyToolName {
  return (READONLY_TOOL_NAMES as readonly string[]).includes(value);
}

/**
 * 下发给模型的白名单工具。
 *
 * - 销冠永远只有战败原因工具；
 * - 其它助手在没有商户范围时也不下发数据工具，避免模型产生无效调用。
 */
export function buildAiTools(
  agentType: AiAgentTypeValue,
  options: { hasTenantScope: boolean },
): AiToolDefinition[] {
  const base = toolsForAgent(agentType);

  if (!options.hasTenantScope || !READONLY_TOOL_AGENTS.includes(agentType)) {
    return base;
  }

  return [...base, ...READONLY_TOOL_DEFINITIONS];
}

/**
 * 在「当前租户」范围内按 账号 / 玩家 ID / 邮箱 找玩家。
 *
 * 关键点：
 * - OR 条件只在 tenantId 已经生效的前提下求值，别家玩家永远匹配不到；
 * - 找不到一律 404，不做「是不是在别家商户」的回查；
 * - 万一记录归属与租户不一致（where 条件将来被人改坏），这里再拦一次 403。
 */
async function findScopedPlayer(tenantId: string, keyword: string) {
  const key = keyword.trim();

  if (!key) {
    return {
      ok: false as const,
      status: 400,
      error: "缺少 player 参数（玩家账号 / 玩家 ID / 邮箱）",
    };
  }

  const player = await prisma.player.findFirst({
    where: {
      tenantId,
      OR: [
        { id: key },
        { username: key },
        { email: { equals: key, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      tenantId: true,
      username: true,
      status: true,
      balance: true,
      createdAt: true,
      tenant: { select: { currency: true } },
    },
  });

  if (!player) {
    return {
      ok: false as const,
      status: 404,
      error: "当前商户下没有找到该玩家",
    };
  }

  if (player.tenantId !== tenantId) {
    return {
      ok: false as const,
      status: 403,
      error: "禁止跨商户读取玩家数据",
    };
  }

  return { ok: true as const, player };
}

async function getPlayerBalance(
  scope: AiToolScope,
  args: JsonRecord,
): Promise<AiToolExecution> {
  const found = await findScopedPlayer(
    scope.tenantId,
    readArgumentString(args, "player"),
  );

  if (!found.ok) {
    return denied(found.error, found.status);
  }

  const player = found.player;

  // 处理中的提现不冻结余额，必须自己扣，口径与 src/lib/player-balance.ts 一致。
  // in-flight = pending（人工待审）+ processing（自动出款中）。
  const pending = await prisma.withdrawal.aggregate({
    where: {
      tenantId: scope.tenantId,
      playerId: player.id,
      status: { in: inFlightWithdrawalStatusList() },
    },
    _sum: { amount: true },
  });

  const balance = player.balance.toFixed(6);
  const pendingWithdrawalAmount = pending._sum.amount
    ? pending._sum.amount.toFixed(6)
    : "0";

  return {
    ok: true,
    status: 200,
    payload: {
      ok: true,
      tenantId: scope.tenantId,
      currency: normalizeCurrency(player.tenant.currency),
      player: {
        id: player.id,
        username: player.username,
        status: player.status,
        createdAt: player.createdAt.toISOString(),
      },
      balance,
      pendingWithdrawalAmount,
      availableBalance: availableBalanceToString(
        balance,
        pendingWithdrawalAmount,
      ),
    },
  };
}


async function listRecentTransactions(
  scope: AiToolScope,
  args: JsonRecord,
): Promise<AiToolExecution> {
  const typeArg = readArgumentString(args, "type");

  if (typeArg && !(TRANSACTION_TYPES as readonly string[]).includes(typeArg)) {
    return denied(`type 只能是 ${TRANSACTION_TYPES.join(" / ")}`, 400);
  }

  let playerId: string | null = null;
  let playerUsername: string | null = null;
  const playerArg = readArgumentString(args, "player");

  if (playerArg) {
    const found = await findScopedPlayer(scope.tenantId, playerArg);

    if (!found.ok) {
      return denied(found.error, found.status);
    }

    playerId = found.player.id;
    playerUsername = found.player.username;
  }

  const limit = readLimit(args.limit);

  const rows = await prisma.transaction.findMany({
    where: {
      // 租户边界永远是第一条件：前端 / 模型的任何参数都改不动它。
      tenantId: scope.tenantId,
      ...(playerId ? { playerId } : {}),
      ...(typeArg ? { type: typeArg } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      amount: true,
      currency: true,
      status: true,
      createdAt: true,
      player: { select: { username: true } },
    },
  });

  return {
    ok: true,
    status: 200,
    payload: {
      ok: true,
      tenantId: scope.tenantId,
      player: playerUsername,
      type: typeArg || null,
      limit,
      count: rows.length,
      // 不返回 txHash / 网关单号：链上哈希同样属于可追溯的敏感信息。
      items: rows.map((row) => ({
        id: row.id,
        player: row.player?.username ?? null,
        type: row.type,
        amount: row.amount.toFixed(6),
        currency: normalizeCurrency(row.currency),
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    },
  };
}


async function getTicketStatus(
  scope: AiToolScope,
  args: JsonRecord,
): Promise<AiToolExecution> {
  const key = readArgumentString(args, "ticket");

  if (!key) {
    return denied("缺少 ticket 参数（注单 ID 或上游注单号）", 400);
  }

  const providerName = readArgumentString(args, "provider");

  const row = await prisma.betRecord.findFirst({
    where: {
      tenantId: scope.tenantId,
      OR: [{ id: key }, { externalId: key }],
      ...(providerName
        ? { provider: { name: { equals: providerName, mode: "insensitive" } } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tenantId: true,
      externalId: true,
      status: true,
      currency: true,
      betAmount: true,
      payoutAmount: true,
      createdAt: true,
      settledAt: true,
      provider: { select: { name: true } },
      player: { select: { username: true } },
    },
  });

  if (!row) {
    return denied("当前商户下没有找到该注单", 404);
  }

  if (row.tenantId !== scope.tenantId) {
    return denied("禁止跨商户读取注单数据", 403);
  }

  return {
    ok: true,
    status: 200,
    payload: {
      ok: true,
      tenantId: scope.tenantId,
      ticket: {
        id: row.id,
        externalId: row.externalId,
        provider: row.provider.name,
        player: row.player?.username ?? null,
        status: row.status,
        currency: normalizeCurrency(row.currency),
        betAmount: row.betAmount.toFixed(6),
        payoutAmount: row.payoutAmount.toFixed(6),
        // GGR / 上游点数 / 平台点差属于内部毛利字段，不返回给模型。
        createdAt: row.createdAt.toISOString(),
        settledAt: row.settledAt?.toISOString() ?? null,
      },
    },
  };
}

/**
 * 执行一次只读工具调用。
 *
 * 调用顺序即安全顺序：先验范围 → 再验白名单 → 再验参数里的租户字段 → 最后才查库。
 * 任何一步不通过都不会产生数据库查询。
 */
export async function executeReadonlyTool(input: {
  name: string;
  rawArguments: string;
  scope: AiToolScope;
}): Promise<AiToolExecution> {
  if (!input.scope.tenantId) {
    return denied("当前会话没有可用的商户范围，拒绝查询", 403);
  }

  if (!isReadonlyToolName(input.name)) {
    return denied(`工具 ${input.name} 不在只读白名单内`, 403);
  }

  const args = readArguments(input.rawArguments);
  const foreignTenant = findForeignTenantArgument(args, input.scope.tenantId);

  if (foreignTenant) {
    return denied("禁止跨商户查询：租户范围必须取自登录会话", 403);
  }

  try {
    switch (input.name) {
      case "get_player_balance":
        return await getPlayerBalance(input.scope, args);
      case "list_recent_transactions":
        return await listRecentTransactions(input.scope, args);
      case "get_ticket_status":
        return await getTicketStatus(input.scope, args);
      default:
        return denied("该工具不在只读白名单内", 403);
    }
  } catch (error) {
    console.error(`AI 只读工具 ${input.name} 执行失败:`, error);
    return denied("查询失败，请稍后重试或转人工", 500);
  }
}
