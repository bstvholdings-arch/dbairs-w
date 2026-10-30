import { prisma } from "@/lib/prisma";

import {
  countFailReasons,
  isAiAgentType,
  isAiChatRole,
  isLeadStatus,
  type AiAgentTypeValue,
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
  agentType: AiAgentTypeValue;
  systemPrompt: string;
  tactics: string;
  effectivePrompt: string;
  updatedAt: string;
};

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

  return prisma.aiAgentConfig.upsert({
    where: { agentType },
    update: {},
    create: {
      agentType,
      systemPrompt: basePrompt,
      tactics: "",
    },
  });
}

export async function getAgentConfigSnapshot(
  agentType: AiAgentTypeValue,
): Promise<AiAgentConfigSnapshot> {
  const config = await ensureAgentConfig(agentType);

  return {
    agentType,
    systemPrompt: config.systemPrompt,
    tactics: config.tactics,
    effectivePrompt: buildEffectiveSystemPrompt(agentType, config),
    updatedAt: config.updatedAt.toISOString(),
  };
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

  const updated = await prisma.aiAgentConfig.upsert({
    where: { agentType },
    update: { systemPrompt: trimmed },
    create: { agentType, systemPrompt: trimmed, tactics: "" },
  });

  return {
    agentType,
    systemPrompt: updated.systemPrompt,
    tactics: updated.tactics,
    effectivePrompt: buildEffectiveSystemPrompt(agentType, updated),
    updatedAt: updated.updatedAt.toISOString(),
  };
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
      config: {
        agentType,
        systemPrompt: config.systemPrompt,
        tactics: config.tactics,
        effectivePrompt: buildEffectiveSystemPrompt(agentType, config),
        updatedAt: config.updatedAt.toISOString(),
      },
      alreadyPresent: true,
    };
  }

  const tactics = config.tactics.trim()
    ? `${config.tactics.trim()}\n\n- ${nextTactic}`
    : `- ${nextTactic}`;

  const updated = await prisma.aiAgentConfig.update({
    where: { agentType },
    data: { tactics },
  });

  return {
    config: {
      agentType,
      systemPrompt: updated.systemPrompt,
      tactics: updated.tactics,
      effectivePrompt: buildEffectiveSystemPrompt(agentType, updated),
      updatedAt: updated.updatedAt.toISOString(),
    },
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
  } = {},
): Promise<SerializedAiChatLog[]> {
  const logs = await prisma.aiChatLog.findMany({
    where: {
      ...(input.agentType ? { agentType: input.agentType } : {}),
      ...(input.leadId ? { leadId: input.leadId } : {}),
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
