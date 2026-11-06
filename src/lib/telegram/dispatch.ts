import { timingSafeEqual } from "node:crypto";

import { MAX_CHAT_MESSAGE_LENGTH } from "@/lib/ai/constants";

import { runTelegramAgentTurn } from "./agent";
import {
  claimTelegramUpdate,
  ensureTelegramChatSession,
  resetTelegramChatContext,
  resolveTelegramChatBinding,
  setTelegramChatAgent,
} from "./bindings";
import { sendTelegramMessage, telegramWebhookSecret } from "./bot-api";
import { TELEGRAM_UNAUTHORIZED_REPLY } from "./constants";
import { resolveTelegramRoute } from "./routing";
import { parseTelegramUpdate } from "./types";

/**
 * Webhook 编排层：鉴权 → 解析 → 认群 → 幂等 → 路由 → 回复。
 *
 * 这一层**只做流程**，判定全部委托给：
 * - `verifyTelegramWebhookSecret()` 鉴权（fail-closed）
 * - `resolveTelegramChatBinding()` 认群（chat_id → tenantId / 平台）
 * - `resolveTelegramRoute()` 决定这条消息该谁答（纯函数，脚本可断言）
 * - `runTelegramAgentTurn()` 真正调模型（复用后台 AI 管线）
 *
 * 顺序不能调换：
 * 1. **先验签再解析 JSON**：未授权的请求连解析都不做；
 * 2. **先认群再查会话**：未授权群不落任何会话 / 日志，也不查业务表；
 * 3. **先占 update_id 再调模型**：Telegram 重投同一条消息时不会回答两次。
 */

export type TelegramWebhookOutcome = {
  status: number;
  body: Record<string, unknown>;
};

export type TelegramSecretCheck =
  | { ok: true }
  | { ok: false; status: number; message: string };

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  // timingSafeEqual 要求等长，长度不同直接判否（长度本身不是秘密）。
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function verifyTelegramWebhookSecret(
  header: string | null,
): TelegramSecretCheck {
  const expected = telegramWebhookSecret();

  if (!expected) {
    // fail-closed：没配 secret 就一条回调都不接。
    // 否则任何知道 URL 的人都能伪造群消息，把模型额度烧光。
    return {
      ok: false,
      status: 503,
      message: "服务端未配置 TELEGRAM_WEBHOOK_SECRET，已拒绝处理",
    };
  }

  const received = (header ?? "").trim();

  if (!received || !safeEquals(expected, received)) {
    // 不回显收到的值，只说「不匹配」。
    return { ok: false, status: 401, message: "secret token 不匹配" };
  }

  return { ok: true };
}

export async function handleTelegramWebhook(input: {
  rawBody: string;
  secretHeader: string | null;
  baseUrl: string;
}): Promise<TelegramWebhookOutcome> {
  const secret = verifyTelegramWebhookSecret(input.secretHeader);

  if (!secret.ok) {
    console.warn(`[telegram] 拒绝回调：${secret.message}`);

    return { status: secret.status, body: { ok: false, error: secret.message } };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "请求体不是合法 JSON" } };
  }

  const update = parseTelegramUpdate(payload);

  if (!update) {
    // 编辑消息 / 贴纸 / 入群事件 / 结构损坏：直接 200，避免 Telegram 反复重投。
    return { status: 200, body: { ok: true, ignored: "unsupported_update" } };
  }

  const { message, updateId } = update;

  if (!message.text) {
    // 图片 / 语音 / 贴纸：群里不回复（回一句「看不懂」只会刷屏）。
    return { status: 200, body: { ok: true, ignored: "non_text_message" } };
  }

  // ------------------------------------------------------------ 认群
  // 群的身份**只由 chat_id 决定**：命中 Tenant.telegramChatId = 商户群，
  // 命中平台超管 AdminUser.telegramChatId = 平台内部群，其余一律未授权。
  const binding = await resolveTelegramChatBinding(message.chatId);

  if (binding.scope === "unknown") {
    // 未授权：只回一句固定话术，不查任何业务表、不调用模型、不落会话。
    console.warn(
      `[telegram] 未授权群组 chat=${message.chatId} reason=${binding.reason}`,
    );
    await sendTelegramMessage({
      chatId: message.chatId,
      text: TELEGRAM_UNAUTHORIZED_REPLY,
    });

    return { status: 200, body: { ok: true, ignored: binding.reason } };
  }

  // ------------------------------------------------------------ 幂等
  // 先占住 update_id：占不到说明是 Telegram 的重投，直接 200 回去。
  const session = await ensureTelegramChatSession({
    chatId: message.chatId,
    binding,
  });
  const claimed = await claimTelegramUpdate({
    chatId: message.chatId,
    updateId,
  });

  if (!claimed) {
    return { status: 200, body: { ok: true, ignored: "duplicate_update" } };
  }

  const text = message.text.slice(0, MAX_CHAT_MESSAGE_LENGTH);
  const tenantName = binding.scope === "tenant" ? binding.tenantName : null;

  // ------------------------------------------------------------ 路由
  const route = resolveTelegramRoute({
    scope: binding.scope,
    text,
    currentAgent: session.agentType,
    tenantName,
  });

  try {
    switch (route.kind) {
      case "ignore":
        return { status: 200, body: { ok: true, ignored: route.reason } };

      case "switch_agent":
        await setTelegramChatAgent({
          chatId: message.chatId,
          scope: binding.scope,
          agentType: route.agentType,
        });
        await sendTelegramMessage({
          chatId: message.chatId,
          text: route.reply,
        });

        return {
          status: 200,
          body: {
            ok: true,
            action: "switch_agent",
            agentType: route.agentType,
          },
        };

      case "reset":
        await resetTelegramChatContext(message.chatId);
        await sendTelegramMessage({
          chatId: message.chatId,
          text: route.reply,
        });

        return { status: 200, body: { ok: true, action: "reset" } };

      case "reply":
        await sendTelegramMessage({
          chatId: message.chatId,
          text: route.reply,
        });

        return { status: 200, body: { ok: true, action: "reply" } };

      case "agent_message": {
        const result = await runTelegramAgentTurn({
          chatId: message.chatId,
          scope: binding.scope,
          agentType: route.agentType,
          tenantId: binding.scope === "tenant" ? binding.tenantId : null,
          tenantName,
          currency: binding.scope === "tenant" ? binding.currency : null,
          chatTitle: message.chatTitle,
          contextStartedAt: session.contextStartedAt,
          message: text,
          baseUrl: input.baseUrl,
        });
        const sent = await sendTelegramMessage({
          chatId: message.chatId,
          text: result.reply,
        });

        if (result.warning) {
          console.warn(
            `[telegram] chat=${message.chatId} agent=${result.agentType} 降级：${result.warning}`,
          );
        }

        return {
          status: 200,
          body: {
            ok: true,
            action: "agent_message",
            agentType: result.agentType,
            model: result.model,
            fallback: result.fallback,
            sent: sent.ok,
            warning: result.warning,
          },
        };
      }

      default:
        return { status: 200, body: { ok: true, ignored: "unhandled_route" } };
    }
  } catch (error) {
    // 已经占了 update_id，所以这里**不能**返回 5xx（Telegram 重投也会被幂等闸门挡掉，
    // 只会让群里一直等不到回复）。记日志 + 回一句让用户重试。
    console.error(
      `[telegram] 处理失败 chat=${message.chatId} message=${message.messageId}:`,
      error,
    );
    await sendTelegramMessage({
      chatId: message.chatId,
      text: "⚠️ 这条消息处理失败，请稍后重试；紧急问题请联系人工客服。",
    });

    return { status: 200, body: { ok: false, error: "processing_failed" } };
  }
}
