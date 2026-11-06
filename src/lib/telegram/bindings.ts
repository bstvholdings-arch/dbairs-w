import type { AiAgentTypeValue } from "@/lib/ai/constants";
import { prisma } from "@/lib/prisma";

import {
  DEFAULT_TELEGRAM_AGENT,
  normalizeTelegramChatAgent,
  type TelegramChatScope,
} from "./constants";
import { readTelegramChatId } from "./types";

/**
 * Webhook 的「数据库鉴权」层：**chat_id → 这个群是谁的**。
 *
 * 红线（与 AGENTS.md 第 6、7 条同一口径）：
 * 1. 租户范围只能来自 `Tenant.telegramChatId` 的命中结果，绝不来自消息内容、
 *    Bot 用户名、群里某个人自报的商户名；
 * 2. 平台内部群必须同时满足 `AdminUser.telegramChatId` 命中 + `tenantId = NULL`
 *    + `role = super_admin`，任何一条不满足都当「未授权群组」；
 * 3. 未授权时**不查任何业务表**、不调用模型、不回显商户信息；
 * 4. 会话状态（当前助手 / 上下文起点 / 幂等水位）读写都走这里的函数，
 *    页面与 Webhook 不得各写一套。
 */

export type TelegramRejectionReason =
  | "unregistered_chat"
  | "tenant_suspended"
  | "platform_chat_not_platform_admin";

export type TelegramChatBinding =
  | {
      scope: "tenant";
      tenantId: string;
      tenantName: string;
      /** 本站记账币种（Tenant.currency），只用于 Prompt 口径提示。 */
      currency: string;
    }
  | {
      scope: "platform";
      adminUserId: string;
      adminUsername: string;
    }
  | { scope: "unknown"; reason: TelegramRejectionReason };

export type BoundTelegramChat = Exclude<
  TelegramChatBinding,
  { scope: "unknown" }
>;

export type TelegramChatSessionState = {
  chatId: string;
  scope: TelegramChatScope;
  agentType: AiAgentTypeValue;
  contextStartedAt: Date;
  lastUpdateId: bigint | null;
};

const sessionSelect = {
  chatId: true,
  scope: true,
  agentType: true,
  tenantId: true,
  contextStartedAt: true,
  lastUpdateId: true,
} as const;

type SessionRow = {
  chatId: string;
  scope: string;
  agentType: string;
  tenantId: string | null;
  contextStartedAt: Date;
  lastUpdateId: bigint | null;
};

function toSessionState(row: SessionRow): TelegramChatSessionState {
  return {
    chatId: row.chatId,
    // scope 只是缓存；脏数据回落 tenant，并在 ensureTelegramChatSession 里被真正的 binding 覆盖写回。
    scope: row.scope === "platform" ? "platform" : "tenant",
    agentType: row.agentType as AiAgentTypeValue,
    contextStartedAt: row.contextStartedAt,
    lastUpdateId: row.lastUpdateId,
  };
}

/**
 * 用 chat_id 解析这个群的归属。
 *
 * 顺序固定：先商户群、再平台内部群、最后未授权。
 * 两个查询都是唯一索引命中（`@unique`），不存在全表扫描。
 */
export async function resolveTelegramChatBinding(
  chatId: string,
): Promise<TelegramChatBinding> {
  const normalized = readTelegramChatId(chatId);

  if (!normalized) {
    return { scope: "unknown", reason: "unregistered_chat" };
  }

  // ① 商户专属群：命中即把上下文锁定为这个 tenantId。
  const tenant = await prisma.tenant.findUnique({
    where: { telegramChatId: normalized },
    select: { id: true, name: true, status: true, currency: true },
  });

  if (tenant) {
    if (tenant.status !== "active") {
      // 停用 / 试用到期的站点一律不给 AI 值班（宁可回「未授权」，也不让停用站继续被服务）。
      return { scope: "unknown", reason: "tenant_suspended" };
    }

    return {
      scope: "tenant",
      tenantId: tenant.id,
      tenantName: tenant.name,
      currency: tenant.currency,
    };
  }

  // ② 平台内部群：只认平台超级管理员名下的 chat_id。
  const admin = await prisma.adminUser.findUnique({
    where: { telegramChatId: normalized },
    select: { id: true, username: true, role: true, tenantId: true },
  });

  if (admin) {
    if (admin.tenantId || admin.role !== "super_admin") {
      // 商户账号 / 非超管账号误绑的群：直接当未授权，绝不降级成「半个平台权限」。
      return { scope: "unknown", reason: "platform_chat_not_platform_admin" };
    }

    return {
      scope: "platform",
      adminUserId: admin.id,
      adminUsername: admin.username,
    };
  }

  return { scope: "unknown", reason: "unregistered_chat" };
}

/**
 * 读取（必要时创建）群会话状态。
 *
 * - 刚登记的群：自动建一行，默认助手 = 综合客服；
 * - 群归属被改动过（平台群 ↔ 商户群）：把 scope / tenantId 修正回来，
 *   并把越权的 agentType 归一化成本群允许的助手（防止 `sales` 残留到商户群）；
 * - 用 upsert 而不是「先查再建」：同一条消息并发重投时不会撞主键。
 */
export async function ensureTelegramChatSession(input: {
  chatId: string;
  binding: BoundTelegramChat;
}): Promise<TelegramChatSessionState> {
  const scope: TelegramChatScope = input.binding.scope;
  const tenantId =
    input.binding.scope === "tenant" ? input.binding.tenantId : null;

  const row = await prisma.telegramChatSession.upsert({
    where: { chatId: input.chatId },
    update: {},
    create: {
      chatId: input.chatId,
      scope,
      tenantId,
      agentType: DEFAULT_TELEGRAM_AGENT,
    },
    select: sessionSelect,
  });

  const agentType = normalizeTelegramChatAgent(scope, row.agentType);

  if (
    row.scope !== scope ||
    row.tenantId !== tenantId ||
    row.agentType !== agentType
  ) {
    // 状态与当前归属不一致：立刻修正，绝不让上一套 scope 的助手继续答题。
    const updated = await prisma.telegramChatSession.update({
      where: { chatId: input.chatId },
      data: { scope, tenantId, agentType },
      select: sessionSelect,
    });

    return toSessionState(updated);
  }

  return toSessionState(row);
}

/**
 * 幂等闸门：Telegram 没收到 200 会重投同一个 update_id。
 *
 * 用 `updateMany` 做数据库层 CAS（`lastUpdateId IS NULL OR < 本次`）：
 * 抢到的那条请求才继续调模型，其余直接 200 回「duplicate」，一条群消息只会被回答一次。
 * `update_id` 是 int64，用 BigInt 比较；不要改回字符串比较（位数一变就排错序）。
 */
export async function claimTelegramUpdate(input: {
  chatId: string;
  updateId: bigint;
}): Promise<boolean> {
  const result = await prisma.telegramChatSession.updateMany({
    where: {
      chatId: input.chatId,
      OR: [{ lastUpdateId: null }, { lastUpdateId: { lt: input.updateId } }],
    },
    data: {
      lastUpdateId: input.updateId,
      lastMessageAt: new Date(),
    },
  });

  return result.count > 0;
}

/** 群内切换助手：只改状态，不碰任何业务配置。 */
export async function setTelegramChatAgent(input: {
  chatId: string;
  scope: TelegramChatScope;
  agentType: AiAgentTypeValue;
}): Promise<void> {
  await prisma.telegramChatSession.update({
    where: { chatId: input.chatId },
    data: {
      scope: input.scope,
      agentType: normalizeTelegramChatAgent(input.scope, input.agentType),
    },
  });
}

/** /reset：把上下文起点推到此刻；历史不删（审计仍可回溯）。 */
export async function resetTelegramChatContext(chatId: string): Promise<void> {
  await prisma.telegramChatSession.update({
    where: { chatId },
    data: { contextStartedAt: new Date() },
  });
}
