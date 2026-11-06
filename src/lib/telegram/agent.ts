import {
  CHAT_HISTORY_LIMIT,
  MAX_CHAT_MESSAGE_LENGTH,
  type AiAgentTypeValue,
} from "@/lib/ai/constants";
import { generateFallbackCompletion } from "@/lib/ai/fallback";
import { buildFaqSystemPrompt, findRelevantAgentFaqs } from "@/lib/ai/faqs";
import {
  createChatLog,
  getAgentConfigSnapshot,
  loadRecentChatLogs,
} from "@/lib/ai/records";
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
  type AiToolScope,
} from "@/lib/ai/tools";

import { telegramAgentLabel, type TelegramChatScope } from "./constants";
import { buildTelegramScopePrompt } from "./prompt";

/**
 * 群消息 → AI 助手的一次完整回合。
 *
 * 复用后台 AI 对话的**同一套下游**（Agent 配置 / FAQ 召回 / 模型调用 /
 * 只读工具白名单 / 本地兜底 / 日志落库），Webhook 里**不允许**再写一份。
 *
 * 与 `/api/ai/chat` 的三处差异（都是群聊场景必须的）：
 * 1. 租户范围来自 `Tenant.telegramChatId`（由 bindings 解析后传进来），
 *    不接受消息内容里的任何商户标识；
 * 2. 历史按「群 + 助手」隔离（`AiChatLog.telegramChatId`），平台内部群的
 *    /finance 读不到后台控制台的财务对话；
 * 3. 群聊只下发**只读**工具：群消息没有线索上下文，写工具
 *    （save_lead_failure_reason）一律过滤掉，避免群里一句话改掉线索状态。
 */

export type TelegramAgentTurnResult = {
  /** 已经截断到群消息上限内的回复文本。 */
  reply: string;
  agentType: AiAgentTypeValue;
  model: string;
  /** true = 本地规则兜底（模型不可用 / 未配置 Key）。 */
  fallback: boolean;
  /** 降级原因等，只写日志与回包，不发给群里。 */
  warning: string | null;
};

export async function runTelegramAgentTurn(input: {
  chatId: string;
  scope: TelegramChatScope;
  agentType: AiAgentTypeValue;
  /** 商户群的 tenantId；平台内部群为 null。 */
  tenantId: string | null;
  tenantName: string | null;
  currency: string | null;
  chatTitle: string | null;
  /** 该群该助手的上下文起点（/reset 之后的时间）。 */
  contextStartedAt: Date;
  message: string;
  /** 对外站点地址（兜底话术里的链接用）。 */
  baseUrl: string;
}): Promise<TelegramAgentTurnResult> {
  const message = input.message.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);

  if (!message) {
    throw new Error("群消息为空");
  }

  const agentType = input.agentType;
  const config = await getAgentConfigSnapshot(agentType, {
    baseUrl: input.baseUrl,
  });

  if (!config.isEnabled) {
    // 助手在 AI 控制中心被停用：群里要明确说「停用了」，不能假装答不出来。
    return {
      reply: `⚠️「${telegramAgentLabel(
        agentType,
      )}」当前已停用，请稍后再试或转人工。`,
      agentType,
      model: config.model,
      fallback: true,
      warning: "agent_disabled",
    };
  }

  // 轻量 RAG：先按当前问题召回 FAQ（商户群只在本人 scope 内召回）。
  const faqMatches = await findRelevantAgentFaqs({
    agentType,
    query: message,
    tenantId: input.tenantId,
  });

  const scopedPrompt = `${config.effectivePrompt}\n\n${buildTelegramScopePrompt({
    scope: input.scope,
    agentType,
    tenantName: input.tenantName,
    currency: input.currency,
    chatTitle: input.chatTitle,
  })}`;
  const systemPrompt = buildFaqSystemPrompt(scopedPrompt, faqMatches);

  // 先落库再读历史：一次查询就能拿到「含本轮提问」的上下文，不用手工拼接。
  await createChatLog({
    role: "user",
    content: message,
    agentType,
    tenantId: input.tenantId,
    telegramChatId: input.chatId,
  });

  const storedLogs = await loadRecentChatLogs({
    agentType,
    telegramChatId: input.chatId,
    since: input.contextStartedAt,
    take: CHAT_HISTORY_LIMIT,
  });

  const history = storedLogs
    .slice()
    .reverse()
    .flatMap<AiProviderMessage>((log) =>
      log.role === "user" || log.role === "assistant"
        ? [{ role: log.role, content: log.content }]
        : [],
    );

  const messages: AiProviderMessage[] = [
    { role: "system", content: systemPrompt },
    ...(history.length > 0 ? history : [{ role: "user" as const, content: message }]),
  ];


  // 数据工具：租户范围只来自 bindings 解析出的 tenantId（平台群为 null → 不下发）。
  // actor 只用于审计展示，没有任何权限含义；工具内部仍会再校一次 scope。
  const toolScope: AiToolScope | null = input.tenantId
    ? {
        tenantId: input.tenantId,
        actor: { userId: `telegram:${input.chatId}`, role: "telegram_bot" },
        delegated: false,
      }
    : null;

  const tools = buildAiTools(agentType, {
    hasTenantScope: Boolean(toolScope),
  }).filter((tool) => isReadonlyToolName(tool.function.name));

  const connection = await resolveAiConnection(config.model);
  const temperature = agentType === "sales" ? 0.45 : 0.3;
  let warning: string | null = null;
  let completion: AiCompletion;

  try {
    completion = await requestChatCompletion(messages, {
      tools,
      connection,
      temperature,
      maxTokens: config.tokenLimit,
    });
  } catch (error) {
    if (!(error instanceof AiProviderError)) {
      throw error;
    }

    // 模型不可用不能让群里「已读不回」：走与后台一致的本地规则兜底，
    // 并把降级原因记进 warning（只落日志 / 回包，不发给群里）。
    warning = `${error.message} 已切换本地规则兜底回复。`;
    completion = generateFallbackCompletion({
      agentType,
      messages,
      hasLead: false,
      baseUrl: input.baseUrl,
    });
  }

  // 只读工具循环：模型给参数 → 服务端在租户范围内查 → 结果回填 → 再补全一次。
  // 白名单外的工具名一律 403、不查库；最多 AI_TOOL_MAX_ROUNDS 轮，防止烧 token。
  for (
    let round = 0;
    round < AI_TOOL_MAX_ROUNDS && completion.toolCalls.length > 0;
    round += 1
  ) {
    const toolCalls = completion.toolCalls;

    messages.push({
      role: "assistant",
      content: completion.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (!isReadonlyToolName(call.function.name)) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            status: 403,
            error: "群聊只允许只读工具，该工具已拒绝执行",
          }),
        });

        continue;
      }

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
              error: "当前群未绑定商户，无法查询实时数据",
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

    try {
      completion = await requestChatCompletion(messages, {
        tools,
        connection,
        temperature,
        maxTokens: config.tokenLimit,
      });
    } catch (error) {
      if (!(error instanceof AiProviderError)) {
        throw error;
      }

      warning = [warning, `工具已执行，但后续回复生成失败：${error.message}`]
        .filter(Boolean)
        .join(" ");

      break;
    }
  }

  const assistantText =
    completion.content.trim() ||
    "抱歉，我这边暂时没有生成有效回复，请稍后再试或转人工。";

  await createChatLog({
    role: "assistant",
    content: assistantText,
    agentType,
    tenantId: input.tenantId,
    telegramChatId: input.chatId,
  });

  return {
    reply: assistantText,
    agentType,
    model: completion.model,
    fallback: completion.fallback,
    warning,
  };
}
