import type { NextRequest } from "next/server";

import {
  CHAT_HISTORY_LIMIT,
  DEFAULT_AI_AGENT,
  MAX_CHAT_MESSAGE_LENGTH,
  isAiAgentType,
  normalizeFailReason,
} from "@/lib/ai/constants";
import { generateFallbackCompletion } from "@/lib/ai/fallback";
import type { AgentFaqSnapshot } from "@/lib/ai/faq-types";
import {
  agentFaqTenantExists,
  buildFaqSystemPrompt,
  findRelevantAgentFaqs,
} from "@/lib/ai/faqs";
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
import { SAVE_LEAD_FAILURE_REASON_TOOL_NAME } from "@/lib/ai/prompts";
import {
  AiProviderError,
  requestChatCompletion,
  type AiCompletion,
  type AiProviderMessage,
} from "@/lib/ai/provider";
import { resolveAiConnection } from "@/lib/ai/settings";
import {
  AI_TOOL_MAX_ROUNDS,
  buildAiTools,
  executeReadonlyTool,
  isReadonlyToolName,
  resolveAiToolScope,
} from "@/lib/ai/tools";
import { baseUrlFromRequestHeaders } from "@/lib/integrations";
import { appBaseUrl } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { guardPermission } from "@/lib/session";

/**
 * POST /api/ai/chat —— 5 大 AI 助手的统一真实对话入口。
 *
 * 流程：
 * 1. RBAC（aiConsole，默认仅超管）→ 2. 校验 agentType 并读取该助手的
 *    AgentConfig（System Prompt / 模型 / Token 上限 / 启停状态）
 * → 3. upsert 线索（仅销售场景）→ 4. 用户消息脱敏落库
 * → 5. 按 agentType 读取历史 → 6. 调用模型（白名单工具：销冠战败原因 +
 *    只读数据工具）→ 7. 服务端执行工具并把结果回填给模型再补全一次
 *    → 8. 助手回复脱敏落库。
 *
 * 工具隔离（见 AGENTS.md 第 5 条）：
 * - 知识库走 RAG（FAQ 检索 ≤3 条拼进 System Prompt），实时数据只走工具；
 * - 工具执行前先解析会话租户范围（resolveAiToolScope），跨租户一律 403；
 * - 白名单之外的工具名不执行，也不会向用户暴露工具名与 System Prompt。
 *
 * 上下文隔离：
 * - 正式对话的历史始终按 agentType 查询；有 leadId 时再叠加 leadId 过滤。
 * - 前端传入的 history 只在数据库还没有历史时作为兼容兜底，不能跨助手串线。
 * - resetContext=true 时忽略历史并返回新的 contextStartedAt；
 *   后续请求按 contextStartedAt 过滤，实现「新对话」而不删除历史日志。
 *
 * 运行时连接优先使用 AiSettings 中保存的 Key / Base URL / 模型；
 * 未配置（且环境变量也没有 Key）或模型报错时自动降级为本地规则回复，保证链路可演示。
 * testMode=true 时只做一轮真实模型调用，不写线索 / 日志，未配置 Key 会明确报错。
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

function serializeFaqMatches(faqs: readonly AgentFaqSnapshot[]) {
  return faqs.map((faq) => ({ id: faq.id, question: faq.question }));
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

  const requestedAgent = body.agentType ?? body.agentName;

  // 显式传了 agentType 就必须合法，避免拼写错误时静默落到销冠、串用销售上下文。
  if (requestedAgent !== undefined && !isAiAgentType(requestedAgent)) {
    return jsonError("agentType 不是受支持的 AI 助手", 400);
  }

  const agentType = isAiAgentType(requestedAgent)
    ? requestedAgent
    : DEFAULT_AI_AGENT;
  const testMode = body.testMode === true;
  const resetContext = body.resetContext === true;
  const contextStartedAtRaw = readTrimmedString(body.contextStartedAt, 64);
  const contextStartedAt = contextStartedAtRaw
    ? new Date(contextStartedAtRaw)
    : null;

  if (
    contextStartedAt &&
    Number.isNaN(contextStartedAt.getTime())
  ) {
    return jsonError("contextStartedAt 不是合法时间", 400);
  }

  const inputLeadId = readTrimmedString(body.leadId, 64);
  const tgOrEmail = readTrimmedString(body.tgOrEmail, 120);
  const brandName = readTrimmedString(body.brandName, 80);
  const requestedTenantId = readTrimmedString(body.tenantId, 64) || null;
  const clientHistory = readHistory(body.history);

  try {
    // 销冠 AI 的「封面风格预览链接」必须是对外可点开的绝对地址：
    // 优先用本次请求的域名（staging / 正式域名自动跟随），拿不到才回退 APP_BASE_URL。
    const publicBaseUrl = baseUrlFromRequestHeaders(
      request.headers,
      appBaseUrl(),
    );
    const config = await getAgentConfigSnapshot(agentType, {
      baseUrl: publicBaseUrl,
    });

    if (!config.isEnabled) {
      return jsonError(
        `助手「${agentType}」已停用，请先在 AI 控制中心启用后再试`,
        400,
      );
    }

    if (
      requestedTenantId &&
      !(await agentFaqTenantExists(requestedTenantId))
    ) {
      return jsonError("tenantId 对应的商户不存在", 404);
    }

    // 工具可用的租户范围：只能来自登录会话（超管再叠加显式选择的商户）。
    // 越权（跨商户查询）在这里就 403，后面所有工具执行都只用这一个 scope。
    const scopeResult = await resolveAiToolScope({
      user: gate.user,
      requestedTenantId,
    });

    if (!scopeResult.ok) {
      return jsonError(scopeResult.message, scopeResult.status);
    }

    const toolScope = scopeResult.scope;

    // 轻量 RAG：先按当前问题召回该助手的 FAQ，再拼进 System Prompt。
    // 未命中或检索异常时 buildFaqSystemPrompt 会原样返回基础 Prompt。
    const faqMatches = await findRelevantAgentFaqs({
      agentType,
      query: message,
      tenantId: requestedTenantId,
    });
    const systemPrompt = buildFaqSystemPrompt(
      config.effectivePrompt,
      faqMatches,
    );

    const connection = await resolveAiConnection(config.model);

    // AI 控制中心「测试窗口」：只做一轮真实模型调用，不写线索、不落聊天日志。
    // 未配置 Key 时明确报错，不静默走本地规则，避免误以为已接通 DeepSeek。
    if (testMode) {
      if (!connection.configured) {
        return jsonError(
          connection.source === "disabled"
            ? "AI 接入已停用，请先在 AI 控制中心启用并保存 API Key"
            : "尚未配置可用的 API Key，请先在 AI 控制中心完成模型接入",
          503,
        );
      }

      const messages: AiProviderMessage[] = [
        { role: "system", content: systemPrompt },
        ...clientHistory,
        { role: "user", content: message },
      ];

      try {
        const completion = await requestChatCompletion(messages, {
          connection,
          temperature: agentType === "sales" ? 0.45 : 0.3,
          maxTokens: config.tokenLimit,
        });

        return jsonNoStore({
          success: true,
          testMode: true,
          reply: {
            id: `test-${Date.now()}`,
            role: "assistant",
            content:
              completion.content ||
              "模型返回了空回复，请检查模型名称或稍后重试。",
            agentType,
            leadId: null,
            createdAt: new Date().toISOString(),
          },
          agentType,
          model: completion.model,
          fallback: false,
          warning: null,
          faqMatches: serializeFaqMatches(faqMatches),
        });
      } catch (error) {
        if (!(error instanceof AiProviderError)) {
          throw error;
        }

        return jsonError(error.message, error.status);
      }
    }

    const lead = await resolveLead({
      leadId: inputLeadId,
      tgOrEmail,
      brandName,
    });

    if (inputLeadId && !lead) {
      return jsonError("leadId 对应的线索不存在", 404);
    }

    const userLog = await createChatLog({
      role: "user",
      content: message,
      agentType,
      leadId: lead?.id ?? null,
    });

    // 历史始终按 agentType 隔离；有线索时再叠加 leadId，避免 5 个助手互相串上下文。
    const storedLogs = resetContext
      ? []
      : await loadRecentChatLogs({
          agentType,
          ...(lead?.id ? { leadId: lead.id } : {}),
          ...(contextStartedAt ? { since: contextStartedAt } : {}),
          take: CHAT_HISTORY_LIMIT,
        });

    const persistedHistory: ChatTurn[] = storedLogs
      .slice()
      .reverse()
      .flatMap((log) =>
        log.role === "user" || log.role === "assistant"
          ? [{ role: log.role, content: log.content } as ChatTurn]
          : [],
      );

    // storedLogs 已包含刚落库的本轮用户消息。若数据库还没有更早的助手记录，
    // 才使用前端 history 兼容外部调用方；否则一律以数据库的 agentType 历史为准。
    const history: ChatTurn[] = resetContext
      ? [{ role: "user", content: message }]
      : contextStartedAt ||
          persistedHistory.length > 1 ||
          clientHistory.length === 0
        ? persistedHistory
        : [...clientHistory, { role: "user", content: message }];

    const messages: AiProviderMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
    ];

    // 工具白名单：销冠只有战败原因工具；其它助手在没有商户范围时不发数据工具。
    const tools = buildAiTools(agentType, {
      hasTenantScope: Boolean(toolScope),
    });
    let warning: string | null = null;
    let completion: AiCompletion;

    try {
      completion = await requestChatCompletion(messages, {
        tools,
        connection,
        temperature: agentType === "sales" ? 0.45 : 0.3,
        maxTokens: config.tokenLimit,
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
        // 兜底回复同样要能给出封面风格预览链接（绝对地址）
        baseUrl: publicBaseUrl,
      });
    }

    // ------------------------------------------------------------ 工具执行
    // 通用工具循环：模型给参数 → 服务端执行 → 结果回填 → 再补全一次。
    // 1. 只有白名单工具会被执行，模型编造的工具名一律 403；
    // 2. 只读数据工具的 tenantId 永远取自会话（toolScope），不采信模型参数；
    // 3. 最多 AI_TOOL_MAX_ROUNDS 轮，避免模型无限调用把 token 烧光。
    let failReason: string | null = null;
    let failureReasonSaved = false;
    let leadAfter = lead ? serializeLead(lead) : null;

    for (
      let round = 0;
      round < AI_TOOL_MAX_ROUNDS && completion.toolCalls.length > 0;
      round += 1
    ) {
      const toolCalls = completion.toolCalls;

      // 先把「带工具调用的 assistant 消息」补进上下文，再逐条回填 tool 结果。
      messages.push({
        role: "assistant",
        content: completion.content || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        // 写工具：记录战败原因，仅销冠可用（其它助手拿到这个工具名也不执行）。
        if (call.function.name === SAVE_LEAD_FAILURE_REASON_TOOL_NAME) {
          const reason =
            agentType === "sales"
              ? readToolReason(call.function.arguments)
              : null;

          if (!reason) {
            warning = [
              warning,
              "AI 返回的战败原因为空、格式不合法或当前助手无权使用该工具，本次未写入线索。",
            ]
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

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: failureReasonSaved,
              reason: failureReasonSaved ? failReason : null,
            }),
          });

          continue;
        }

        // 只读数据工具：白名单之外的工具名一律拒绝，连库都不查。
        if (!isReadonlyToolName(call.function.name)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              status: 403,
              error: "该工具不在白名单内，已拒绝执行",
            }),
          });

          continue;
        }

        // 会话没有商户范围时同样 403：模型不得凭空拿到任何一家的实时数据。
        const outcome = toolScope
          ? await executeReadonlyTool({
              name: call.function.name,
              rawArguments: call.function.arguments,
              scope: toolScope,
            })
          : {
              payload: {
                ok: false,
                status: 403,
                error: "当前对话未绑定商户，无法查询实时数据",
              },
            };

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(outcome.payload),
        });
      }

      // 本地兜底回复已经写好了收尾话术，不再多花一次模型调用。
      if (completion.fallback) {
        break;
      }

      if (round + 1 >= AI_TOOL_MAX_ROUNDS) {
        warning = [
          warning,
          `工具调用已达 ${AI_TOOL_MAX_ROUNDS} 轮上限，本次回答基于已有工具结果。`,
        ]
          .filter(Boolean)
          .join(" ");

        break;
      }

      // 基于工具结果再补全一次，让模型把结构化数据说成人话。
      try {
        completion = await requestChatCompletion(messages, {
          tools,
          connection,
          temperature: agentType === "sales" ? 0.45 : 0.3,
          maxTokens: config.tokenLimit,
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

        break;
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
      // 本地规则兜底没有使用 FAQ，避免前端展示「已参考知识库」造成误解。
      faqMatches: completion.fallback
        ? []
        : serializeFaqMatches(faqMatches),
      // 新对话首轮用真实用户消息时间作为后续上下文起点，避免服务端时间误差。
      contextStartedAt: resetContext ? userLog.createdAt : null,
    });
  } catch (error) {
    console.error("AI 对话处理失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

