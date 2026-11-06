import type { AiAgentTypeValue } from "@/lib/ai/constants";

import {
  DEFAULT_TELEGRAM_AGENT,
  TELEGRAM_AGENT_COMMANDS,
  isTelegramAgentAllowed,
  normalizeTelegramChatAgent,
  telegramAgentLabel,
  telegramAgentsForScope,
  type TelegramChatScope,
} from "./constants";

/**
 * 群内指令解析与路由决策（纯函数，不碰数据库、不碰网络）。
 *
 * 之所以单独抽出来：群里「这条消息该谁答」这件事必须只有一份判定，
 * Webhook 路由只负责按决策执行（切换 / 重置 / 调模型），回归脚本
 * （scripts/check-telegram-routing.ts）直接断言这里的输出。
 *
 * 关键口径：
 * - 指令大小写不敏感，群里 `@BotName` 后缀（/tech@DbaBot）会被剥掉；
 * - 群里发普通文本 → 交给「当前激活的助手」，没切过就是综合客服；
 * - 商户群发 /sales、/audit、/strategist → 拒绝（这些只给平台内部群），
 *   绝不允许「先发个 /sales 就越权拿到平台助手」；
 * - 未知 /xxx → 回帮助，不静默丢弃（否则运营会以为 Bot 挂了）。
 */

export type TelegramParsedCommand = {
  /** 小写命令名，不含前导斜杠与 @bot 后缀。 */
  name: string;
  argument: string;
};

export function parseTelegramCommand(
  text: string,
): TelegramParsedCommand | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const firstToken = trimmed.slice(1).split(/\s+/, 1)[0] ?? "";
  // 群里形如 /tech@MyBot：@ 之后是 Bot 用户名，与指令无关。
  const name = firstToken.split("@")[0]?.toLowerCase() ?? "";

  if (!name) {
    return null;
  }

  return {
    name,
    argument: trimmed.slice(1 + firstToken.length).trim(),
  };
}

export function buildTelegramHelpText(input: {
  scope: TelegramChatScope;
  currentAgent: AiAgentTypeValue;
}): string {
  const currentAgent = normalizeTelegramChatAgent(
    input.scope,
    input.currentAgent,
  );
  const agentLines = telegramAgentsForScope(input.scope)
    .map((agentType) => {
      const mark = agentType === DEFAULT_TELEGRAM_AGENT ? "（默认）" : "";
      return `/${agentType} —— ${telegramAgentLabel(agentType)}${mark}`;
    })
    .join("\n");

  return [
    `🤖 当前接待：${telegramAgentLabel(currentAgent)}`,
    "",
    "可用指令：",
    agentLines,
    "/agent —— 查看当前接待的助手",
    "/reset —— 清空当前助手的群聊上下文",
    "/help —— 再看一次这份说明",
    "",
    "普通消息不用加指令，直接发就会被当前助手接住。",
  ].join("\n");
}

export function buildTelegramStatusText(input: {
  scope: TelegramChatScope;
  currentAgent: AiAgentTypeValue;
  tenantName?: string | null;
}): string {
  const currentAgent = normalizeTelegramChatAgent(
    input.scope,
    input.currentAgent,
  );
  const scopeLabel =
    input.scope === "platform"
      ? "平台内部群"
      : `商户群${input.tenantName ? `（${input.tenantName}）` : ""}`;

  return [
    `📍 群类型：${scopeLabel}`,
    `🤖 当前接待：${telegramAgentLabel(currentAgent)}（/${currentAgent}）`,
    `🧩 本群可用：${telegramAgentsForScope(input.scope)
      .map((agentType) => `/${agentType}`)
      .join(" ")}`,
    "",
    "发送 /help 查看完整指令。",
  ].join("\n");
}

export type TelegramRouteDecision =
  /** 切到另一个助手（调用方写库 + 回一句确认）。 */
  | { kind: "switch_agent"; agentType: AiAgentTypeValue; reply: string }
  /** /reset：只重置该群该助手的上下文起点。 */
  | { kind: "reset"; reply: string }
  /** 固定话术（帮助 / 状态 / 拒绝 / 未知指令）。 */
  | { kind: "reply"; reply: string }
  /** 普通消息：交给该助手生成回复。 */
  | { kind: "agent_message"; agentType: AiAgentTypeValue }
  /** 不回复（空消息等）。 */
  | { kind: "ignore"; reason: string };

export function resolveTelegramRoute(input: {
  scope: TelegramChatScope;
  text: string;
  currentAgent: AiAgentTypeValue;
  tenantName?: string | null;
}): TelegramRouteDecision {
  const text = input.text.trim();
  const currentAgent = normalizeTelegramChatAgent(
    input.scope,
    input.currentAgent,
  );

  if (!text) {
    return { kind: "ignore", reason: "empty_message" };
  }

  const command = parseTelegramCommand(text);

  // 普通聊天：交给当前助手（默认综合客服）。
  if (!command) {
    return { kind: "agent_message", agentType: currentAgent };
  }

  switch (command.name) {
    case "start":
    case "help":
      return {
        kind: "reply",
        reply: buildTelegramHelpText({ scope: input.scope, currentAgent }),
      };
    case "agent":
    case "status":
    case "whoami":
      return {
        kind: "reply",
        reply: buildTelegramStatusText({
          scope: input.scope,
          currentAgent,
          tenantName: input.tenantName ?? null,
        }),
      };
    case "reset":
    case "new":
      return {
        kind: "reset",
        reply: `🧹 已清空「${telegramAgentLabel(
          currentAgent,
        )}」在本群的上下文，接下来从新话题开始。`,
      };
    default:
      break;
  }

  const targetAgent = TELEGRAM_AGENT_COMMANDS[command.name];

  if (!targetAgent) {
    return {
      kind: "reply",
      reply: [
        `❓ 未知指令 /${command.name}`,
        "",
        buildTelegramHelpText({ scope: input.scope, currentAgent }),
      ].join("\n"),
    };
  }

  if (!isTelegramAgentAllowed(input.scope, targetAgent)) {
    return {
      kind: "reply",
      reply: [
        `⛔「${telegramAgentLabel(targetAgent)}」仅平台内部群可用。`,
        `本群可用：${telegramAgentsForScope(input.scope)
          .map((agentType) => `/${agentType}`)
          .join(" ")}`,
      ].join("\n"),
    };
  }

  if (targetAgent === currentAgent) {
    return {
      kind: "reply",
      reply: `✅ 当前已经是「${telegramAgentLabel(
        targetAgent,
      )}」，直接发问题就行。`,
    };
  }

  return {
    kind: "switch_agent",
    agentType: targetAgent,
    reply: [
      `✅ 已切换到「${telegramAgentLabel(targetAgent)}」。`,
      // 上下文按「群 + 助手」各自独立，切换不丢历史，也不会串到别的助手。
      "这个群里的后续问题由它接着答；需要换回来随时发 /support。",
    ].join("\n"),
  };
}
