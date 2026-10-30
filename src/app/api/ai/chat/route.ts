import type { NextRequest } from "next/server";

import {
  CHAT_HISTORY_LIMIT,
  DEFAULT_AI_AGENT,
  MAX_CHAT_MESSAGE_LENGTH,
  isAiAgentType,
  normalizeFailReason,
} from "@/lib/ai/constants";
import { generateFallbackCompletion } from "@/lib/ai/fallback";
import {
  jsonError,
  jsonNoStore,
  readJsonObject,
  readTrimmedString,
} from "@/lib/ai/http";
import {
  createChatLog,
  getAgentConfigSnapshot,
  loadRecentChatLogs,
  serializeLead,
} from "@/lib/ai/records";
import {
  SAVE_LEAD_FAILURE_REASON_TOOL_NAME,
  toolsForAgent,
} from "@/lib/ai/prompts";
import {
  AiProviderError,
  requestChatCompletion,
  type AiCompletion,
  type AiProviderMessage,
} from "@/lib/ai/provider";
import { prisma } from "@/lib/prisma";
import { guardPermission } from "@/lib/session";

/**
 * POST /api/ai/chat —— 销冠 AI 的真实对话入口（AI 中控台「销售对话」Tab）。
 *
 * 流程：
 * 1. RBAC（aiConsole，默认仅超管）→ 2. upsert 线索 → 3. 用户消息脱敏落库
 * → 4. 读取 System Prompt + 历史 → 5. 调用模型（带 save_lead_failure_reason 工具）
 * → 6. 执行工具（写入 status=failed / failReason）→ 7. 助手回复脱敏落库。
 *
 * 没配置 AI_API_KEY 或模型报错时自动降级为本地规则回复，保证链路可演示。
 */

type ChatTurn = { role: "user" | "assistant"; content: string };

const leadSelect = {
  id: true,
  tgOrEmail: true,
  brandName: true,
  status: true,
  failReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

function readHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const turns: ChatTurn[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const turn = item as Record<string, unknown>;

    if (turn.role !== "user" && turn.role !== "assistant") {
      continue;
    }

    const content = readTrimmedString(turn.content, MAX_CHAT_MESSAGE_LENGTH);

    if (!content) {
      continue;
    }

    turns.push({ role: turn.role, content });
  }

  return turns.slice(-CHAT_HISTORY_LIMIT);
}

function readToolReason(rawArguments: string): string | null {
  try {
    const parsed = JSON.parse(rawArguments || "{}") as { reason?: unknown };
    return normalizeFailReason(parsed.reason);
  } catch {
    return null;
  }
}

async function resolveLead(input: {
  leadId: string;
  tgOrEmail: string;
  brandName: string;
}) {
  // 品牌名 + 联系方式是线索唯一键：同一客户反复咨询只累加日志，不重复建线索。
  if (input.tgOrEmail && input.brandName) {
    return prisma.leadRecord.upsert({
      where: {
        tgOrEmail_brandName: {
          tgOrEmail: input.tgOrEmail,
          brandName: input.brandName,
        },
      },
      update: {},
      create: {
        tgOrEmail: input.tgOrEmail,
        brandName: input.brandName,
        status: "pending",
      },
      select: leadSelect,
    });
  }

  if (input.leadId) {
    return prisma.leadRecord.findUnique({
      where: { id: input.leadId },
      select: leadSelect,
    });
  }

  return null;
}

export async function POST(request: NextRequest) {
  const gate = await guardPermission(request, "aiConsole");

  if (gate.response) {
    return gate.response;
  }

  const body = await readJsonObject(request);

  if (!body) {
    return jsonError("请求体格式错误，需要 JSON 对象", 400);
  }

  const message = readTrimmedString(body.message, MAX_CHAT_MESSAGE_LENGTH);

  if (!message) {
    return jsonError("message 不能为空", 400);
  }

  const agentType = isAiAgentType(body.agentType)
    ? body.agentType
    : DEFAULT_AI_AGENT;
  const inputLeadId = readTrimmedString(body.leadId, 64);
  const tgOrEmail = readTrimmedString(body.tgOrEmail, 120);
  const brandName = readTrimmedString(body.brandName, 80);
  const clientHistory = readHistory(body.history);

  try {
    const lead = await resolveLead({
      leadId: inputLeadId,
      tgOrEmail,
      brandName,
    });

    if (inputLeadId && !lead) {
      return jsonError("leadId 对应的线索不存在", 404);
    }

    await createChatLog({
      role: "user",
      content: message,
      agentType,
      leadId: lead?.id ?? null,
    });

    // 有线索时以数据库里的历史为准（跨会话记忆）；没有线索才使用前端传入的上下文。
    const storedLogs = lead
      ? await loadRecentChatLogs({
          agentType,
          leadId: lead.id,
          take: CHAT_HISTORY_LIMIT,
        })
      : [];

    const history: ChatTurn[] = lead
      ? storedLogs
          .slice()
          .reverse()
          .flatMap((log) =>
            log.role === "user" || log.role === "assistant"
              ? [{ role: log.role, content: log.content } as ChatTurn]
              : [],
          )
      : [...clientHistory, { role: "user", content: message }];

    const config = await getAgentConfigSnapshot(agentType);
    const messages: AiProviderMessage[] = [
      { role: "system", content: config.effectivePrompt },
      ...history,
    ];

    const tools = toolsForAgent(agentType);
    let warning: string | null = null;
    let completion: AiCompletion;

    try {
      completion = await requestChatCompletion(messages, {
        tools,
        temperature: agentType === "sales" ? 0.45 : 0.3,
      });
    } catch (error) {
      if (!(error instanceof AiProviderError)) {
        throw error;
      }

      warning = `${error.message} 已切换本地规则兜底回复。`;
      completion = generateFallbackCompletion({
        agentType,
        messages,
        hasLead: Boolean(lead),
      });
    }

    // ------------------------------------------------------------ 工具执行
    let failReason: string | null = null;
    let failureReasonSaved = false;
    let leadAfter = lead ? serializeLead(lead) : null;

    const toolCall = completion.toolCalls.find(
      (call) => call.function.name === SAVE_LEAD_FAILURE_REASON_TOOL_NAME,
    );

    if (toolCall && agentType === "sales") {
      const reason = readToolReason(toolCall.function.arguments);

      if (!reason) {
        warning = [warning, "AI 返回的战败原因为空或格式不合法，本次未写入线索。"]
          .filter(Boolean)
          .join(" ");
      } else {
        failReason = reason;

        if (!lead) {
          warning = [
            warning,
            "当前对话未绑定线索（缺少品牌名 / 联系方式），战败原因未落库。",
          ]
            .filter(Boolean)
            .join(" ");
        } else if (lead.status === "success") {
          warning = [warning, "该线索已标记为成交，未用战败原因覆盖状态。"]
            .filter(Boolean)
            .join(" ");
        } else {
          const updated = await prisma.leadRecord.update({
            where: { id: lead.id },
            data: { status: "failed", failReason: reason },
            select: leadSelect,
          });

          leadAfter = serializeLead(updated);
          failureReasonSaved = true;
        }
      }

      // 云端模型需要第二轮补全，才能基于工具结果给出最终话术；
      // 本地兜底的 content 已经写好收尾话术，不再重复调用。
      if (!completion.fallback) {
        messages.push({
          role: "assistant",
          content: completion.content || null,
          tool_calls: completion.toolCalls,
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            ok: failureReasonSaved,
            reason: failureReasonSaved ? failReason : null,
          }),
        });

        try {
          completion = await requestChatCompletion(messages, {
            tools,
            temperature: 0.45,
          });
        } catch (error) {
          if (!(error instanceof AiProviderError)) {
            throw error;
          }

          warning = [
            warning,
            `工具已执行，但后续回复生成失败：${error.message}`,
          ]
            .filter(Boolean)
            .join(" ");
        }
      }
    }

    // ------------------------------------------------------------ 助手落库
    const assistantText =
      completion.content.trim() ||
      (failureReasonSaved
        ? `已记录本次战败原因「${failReason}」，我会同步给团队复盘。方便的话留个联系方式，后续有对应扶持政策第一时间发您。`
        : "抱歉，我这边暂时没有生成有效回复，请稍后再试或转人工顾问。");

    const reply = await createChatLog({
      role: "assistant",
      content: assistantText,
      agentType,
      leadId: lead?.id ?? null,
    });

    return jsonNoStore({
      success: true,
      reply,
      agentType,
      model: completion.model,
      fallback: completion.fallback,
      warning,
      lead: leadAfter,
      failReason,
      failureReasonSaved,
    });
  } catch (error) {
    console.error("AI 对话处理失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

