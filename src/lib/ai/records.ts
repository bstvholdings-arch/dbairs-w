import { prisma } from "@/lib/prisma";

import {
  AI_CONSOLE_AGENT_TYPES,
  DEFAULT_AI_MODEL,
  countFailReasons,
  isAiAgentType,
  isAiChatRole,
  isLeadStatus,
  type AiAgentTypeValue,
  type AiConsoleAgentName,
  type LeadStatusValue,
  type ReasonCount,
} from "./constants";
import { buildAgentSystemPrompt, buildEffectiveSystemPrompt } from "./prompts";
import { redactSensitiveContent } from "./redact";

/**
 * AI 控制台的数据库读写与序列化。
 *
 * Server Component 直接调用这里的函数取初始数据；Route Handler 复用同一套
 * 序列化格式，保证「首屏 SSR 数据」与「接口刷新数据」字段完全一致。
 */

export type SerializedAiChatLog = {
  id: string;
  role: string;
  content: string;
  agentType: string;
  leadId: string | null;
  createdAt: string;
};

export type SerializedLeadRecord = {
  id: string;
  tgOrEmail: string;
  brandName: string;
  status: LeadStatusValue;
  failReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiAgentConfigSnapshot = {
  agentName: AiAgentTypeValue;
  /** 兼容旧组件：与 agentName 相同。 */
  agentType: AiAgentTypeValue;
  systemPrompt: string;
  tactics: string;
  effectivePrompt: string;
  model: string;
  isEnabled: boolean;
  tokenLimit: number;
  updatedAt: string;
};

type AgentConfigSource = {
  agentName: string;
  systemPrompt: string;
  tactics: string;
  model: string;
  isEnabled: boolean;
  tokenLimit: number;
  updatedAt: Date;
};

export function serializeAgentConfig(
  config: AgentConfigSource,
  options?: { baseUrl?: string | null },
): AiAgentConfigSnapshot {
  const agentName = isAiAgentType(config.agentName)
    ? config.agentName
    : "sales";

  return {
    agentName,
    agentType: agentName,
    systemPrompt: config.systemPrompt,
    tactics: config.tactics,
    // 销冠 AI 的「封面风格预览链接」要带当前域名，所以这里透传 baseUrl。
    effectivePrompt: buildEffectiveSystemPrompt(agentName, config, options),
    model: config.model,
    isEnabled: config.isEnabled,
    tokenLimit: config.tokenLimit,
    updatedAt: config.updatedAt.toISOString(),
  };
}

type ChatLogSource = {
  id: string;
  role: string;
  content: string;
  agentType: string;
  leadId: string | null;
  createdAt: Date;
};

type LeadSource = {
  id: string;
  tgOrEmail: string;
  brandName: string;
  status: string;
  failReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeChatLog(log: ChatLogSource): SerializedAiChatLog {
  return {
    id: log.id,
    role: log.role,
    content: log.content,
    agentType: log.agentType,
    leadId: log.leadId,
    createdAt: log.createdAt.toISOString(),
  };
}

export function serializeLead(lead: LeadSource): SerializedLeadRecord {
  return {
    id: lead.id,
    tgOrEmail: lead.tgOrEmail,
    brandName: lead.brandName,
    status: isLeadStatus(lead.status) ? lead.status : "pending",
    failReason: lead.failReason,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

/**
 * 读取（或首次创建）智能体配置。
 * 基础人设始终来自代码里的 Prompt；数据库只覆盖/追加，便于版本升级。
 */
export async function ensureAgentConfig(agentType: AiAgentTypeValue) {
  const basePrompt = buildAgentSystemPrompt(agentType);

  return prisma.agentConfig.upsert({
    where: { agentName: agentType },
    update: {},
    create: {
      agentName: agentType,
      systemPrompt: basePrompt,
      tactics: "",
      model: DEFAULT_AI_MODEL,
      isEnabled: true,
      tokenLimit: 2000,
    },
  });
}

export async function getAgentConfigSnapshot(
  agentType: AiAgentTypeValue,
  options?: { baseUrl?: string | null },
): Promise<AiAgentConfigSnapshot> {
  const config = await ensureAgentConfig(agentType);
  return serializeAgentConfig(config, options);
}

/** AI 控制中心：读取 5 个平台助手，缺失时自动补基础配置。 */
export async function listAgentConfigs(): Promise<AiAgentConfigSnapshot[]> {
  const configs = await Promise.all(
    AI_CONSOLE_AGENT_TYPES.map((agentName) => ensureAgentConfig(agentName)),
  );

  return configs.map((config) => serializeAgentConfig(config));
}

/** AI 控制中心：保存单个 Agent 的开关、模型、Token 上限与提示词。 */
export async function saveAgentConfig(input: {
  agentName: AiAgentTypeValue;
  systemPrompt?: string;
  model?: string;
  isEnabled?: boolean;
  tokenLimit?: number;
}): Promise<AiAgentConfigSnapshot> {
  const basePrompt = buildAgentSystemPrompt(input.agentName);
  const updated = await prisma.agentConfig.upsert({
    where: { agentName: input.agentName },
    update: {
      ...(input.systemPrompt !== undefined
        ? { systemPrompt: input.systemPrompt }
        : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.isEnabled !== undefined
        ? { isEnabled: input.isEnabled }
        : {}),
      ...(input.tokenLimit !== undefined
        ? { tokenLimit: input.tokenLimit }
        : {}),
    },
    create: {
      agentName: input.agentName,
      systemPrompt: input.systemPrompt ?? basePrompt,
      tactics: "",
      model: input.model ?? DEFAULT_AI_MODEL,
      isEnabled: input.isEnabled ?? true,
      tokenLimit: input.tokenLimit ?? 2000,
    },
  });

  return serializeAgentConfig(updated);
}

export type AppendTacticResult = {
  config: AiAgentConfigSnapshot;
  alreadyPresent: boolean;
};

/** 手动覆盖基础 System Prompt（保留已沉淀的 tactics）。 */
export async function saveSystemPrompt(
  agentType: AiAgentTypeValue,
  systemPrompt: string,
): Promise<AiAgentConfigSnapshot> {
  const trimmed = systemPrompt.trim();

  if (!trimmed) {
    throw new Error("System Prompt 不能为空");
  }

  const updated = await prisma.agentConfig.upsert({
    where: { agentName: agentType },
    update: { systemPrompt: trimmed },
    create: {
      agentName: agentType,
      systemPrompt: trimmed,
      tactics: "",
      model: DEFAULT_AI_MODEL,
      isEnabled: true,
      tokenLimit: 2000,
    },
  });

  return serializeAgentConfig(updated);
}

/**
 * 「一键保存到销冠 AI 的 System Prompt」：
 * 话术按条追加到 tactics，再由 buildEffectiveSystemPrompt 拼成真正的 System Prompt。
 * 重复点击同一段话术不会重复写入。
 */
export async function appendTactic(
  agentType: AiAgentTypeValue,
  tactic: string,
): Promise<AppendTacticResult> {
  const config = await ensureAgentConfig(agentType);
  const nextTactic = tactic.trim();

  if (!nextTactic) {
    throw new Error("话术不能为空");
  }

  if (config.tactics.includes(nextTactic)) {
    return {
      config: serializeAgentConfig(config),
      alreadyPresent: true,
    };
  }

  const tactics = config.tactics.trim()
    ? `${config.tactics.trim()}\n\n- ${nextTactic}`
    : `- ${nextTactic}`;

  const updated = await prisma.agentConfig.update({
    where: { agentName: agentType },
    data: { tactics },
  });

  return {
    config: serializeAgentConfig(updated),
    alreadyPresent: false,
  };
}

export function isConfiguredAgent(value: unknown): value is AiAgentTypeValue {
  return isAiAgentType(value);
}

export async function loadFailureReasonCounts(): Promise<ReasonCount[]> {
  const rows = await prisma.leadRecord.groupBy({
    by: ["failReason"],
    where: { status: "failed", failReason: { not: null } },
    _count: { _all: true },
  });

  return countFailReasons(
    rows.flatMap((row) =>
      row.failReason
        ? Array.from({ length: row._count._all }, () => row.failReason)
        : [],
    ),
  );
}

export type WarRoomLeadFilter = LeadStatusValue | "open" | "all";

export type WarRoomSnapshot = {
  leads: SerializedLeadRecord[];
  statusCounts: Record<LeadStatusValue, number>;
  reasonCounts: ReasonCount[];
};

/**
 * 战败分析看板数据。
 * - leadFilter：open（默认，未成交）/ pending / failed / success / all；
 * - 线索列表最多 500 条，避免一次拉爆页面；
 * - 战败原因统计基于全部 failed 线索（groupBy），不受列表上限与筛选影响。
 */
export async function loadWarRoomSnapshot(
  leadFilter: WarRoomLeadFilter = "open",
): Promise<WarRoomSnapshot> {
  const leadWhere =
    leadFilter === "all"
      ? {}
      : leadFilter === "open"
        ? { status: { not: "success" } }
        : { status: leadFilter };

  const [leads, statusGroups, reasonCounts] = await Promise.all([
    prisma.leadRecord.findMany({
      where: leadWhere,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 500,
      select: {
        id: true,
        tgOrEmail: true,
        brandName: true,
        status: true,
        failReason: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.leadRecord.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    loadFailureReasonCounts(),
  ]);

  const statusCounts: Record<LeadStatusValue, number> = {
    pending: 0,
    success: 0,
    failed: 0,
  };

  for (const group of statusGroups) {
    if (isLeadStatus(group.status)) {
      statusCounts[group.status] = group._count._all;
    }
  }

  return {
    leads: leads.map(serializeLead),
    statusCounts,
    reasonCounts,
  };
}

/**
 * 唯一写日志入口：先脱敏再落库，避免调用方忘记。
 * 联系方式的原始值只写在 LeadRecord.tgOrEmail，不进入 AiChatLog。
 */
export async function createChatLog(input: {
  role: string;
  content: string;
  agentType: AiAgentTypeValue;
  leadId?: string | null;
  /** 租户侧对话（玩家与 AI 客服）必须带上，平台侧对话留空 */
  tenantId?: string | null;
  /** 已登录玩家 id；访客为 null（仍然归属 tenantId） */
  playerId?: string | null;
  /**
   * Telegram 群会话的 chat_id。
   * 群聊历史按「同一个群 + 同一位助手」隔离（见 src/lib/telegram/agent.ts）：
   * 平台内部群的 /finance 不能读到后台 AI 控制台的财务对话，反过来也一样。
   */
  telegramChatId?: string | null;
}): Promise<SerializedAiChatLog> {
  const content = redactSensitiveContent(input.content);

  if (!content) {
    throw new Error("日志内容为空");
  }

  const log = await prisma.aiChatLog.create({
    data: {
      role: isAiChatRole(input.role) ? input.role : "user",
      content,
      agentType: input.agentType,
      leadId: input.leadId ?? null,
      tenantId: input.tenantId ?? null,
      playerId: input.playerId ?? null,
      telegramChatId: input.telegramChatId ?? null,
    },
    select: {
      id: true,
      role: true,
      content: true,
      agentType: true,
      leadId: true,
      createdAt: true,
    },
  });

  return serializeChatLog(log);
}

export async function loadRecentChatLogs(
  input: {
    agentType?: AiAgentTypeValue;
    leadId?: string;
    take?: number;
    /** 只读取该时间之后的消息，用于「新对话」而不删除历史日志。 */
    since?: Date;
    /**
     * 只读取某个 Telegram 群的消息。
     * 传了就天然排除了后台 AI 控制台的历史（那边的 telegramChatId 为空），
     * 群聊上下文因此严格按「同一个群 + 同一位助手」隔离。
     */
    telegramChatId?: string;
  } = {},
): Promise<SerializedAiChatLog[]> {
  const logs = await prisma.aiChatLog.findMany({
    where: {
      ...(input.agentType ? { agentType: input.agentType } : {}),
      ...(input.leadId ? { leadId: input.leadId } : {}),
      ...(input.since ? { createdAt: { gte: input.since } } : {}),
      ...(input.telegramChatId
        ? { telegramChatId: input.telegramChatId }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input.take ?? 30, 1), 200),
    select: {
      id: true,
      role: true,
      content: true,
      agentType: true,
      leadId: true,
      createdAt: true,
    },
  });

  return logs.map(serializeChatLog);
}

export type AgentChatLogMap = Record<
  AiConsoleAgentName,
  SerializedAiChatLog[]
>;

/**
 * 5 个助手各自读取最近日志。
 *
 * 不能先读全量再在前端按 agentType 过滤：那样很容易把其他助手的上下文
 * 带进当前请求。这里每个 agentType 单独查询，首屏数据也天然隔离。
 */
export async function loadRecentChatLogsByAgent(
  input: { take?: number } = {},
): Promise<AgentChatLogMap> {
  const entries = await Promise.all(
    AI_CONSOLE_AGENT_TYPES.map(async (agentName) => {
      const logs = await loadRecentChatLogs({
        agentType: agentName,
        take: input.take,
      });

      return [agentName, logs] as const;
    }),
  );

  return Object.fromEntries(entries) as AgentChatLogMap;
}
