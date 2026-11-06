import { TELEGRAM_MESSAGE_LIMIT } from "./constants";

/**
 * 极简 Telegram Bot API 客户端（只实现「发消息」这一个动作）。
 *
 * 环境变量（全部只在服务端读取）：
 *   TELEGRAM_BOT_TOKEN      必填，BotFather 给的 token（缺失时整条链路 fail-closed）
 *   TELEGRAM_WEBHOOK_SECRET 必填，setWebhook 时用同一个值做 secret_token
 *   TELEGRAM_API_BASE_URL   可选，默认 https://api.telegram.org（本机联调可指向 mock）
 *
 * 安全约定：
 * - 任何日志都**不许**出现带 token 的 URL，只记录 HTTP 状态码与 TG 的 description；
 * - 发送失败不抛异常（Webhook 必须尽快 200 回去，否则 TG 会重投同一条消息）；
 * - 纯文本发送，不带 parse_mode：AI 回复里的 * _ [ ] 不会被当成 Markdown 解析失败。
 */

const DEFAULT_API_BASE_URL = "https://api.telegram.org";
const SEND_TIMEOUT_MS = 10_000;

export function telegramBotToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

export function telegramWebhookSecret(): string {
  return (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
}

export function telegramBotConfigured(): boolean {
  return Boolean(telegramBotToken());
}

function telegramApiBaseUrl(): string {
  return (
    (process.env.TELEGRAM_API_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
    DEFAULT_API_BASE_URL
  );
}

/** Telegram 单条消息有长度上限，超长直接截断（不要指望它自己处理）。 */
export function truncateTelegramText(text: string): string {
  const trimmed = text.trim();

  if (trimmed.length <= TELEGRAM_MESSAGE_LIMIT) {
    return trimmed;
  }

  return `${trimmed.slice(0, TELEGRAM_MESSAGE_LIMIT - 1)}…`;
}

async function readTelegramErrorDescription(
  response: Response,
): Promise<string> {
  try {
    const payload = (await response.json()) as { description?: unknown };

    return typeof payload.description === "string"
      ? payload.description.slice(0, 200)
      : "";
  } catch {
    return "";
  }
}

export type SendTelegramResult = {
  ok: boolean;
  error?: string;
};

export async function sendTelegramMessage(input: {
  chatId: string;
  text: string;
}): Promise<SendTelegramResult> {
  const token = telegramBotToken();
  const text = truncateTelegramText(input.text);

  if (!token) {
    console.error("Telegram 发送失败：未配置 TELEGRAM_BOT_TOKEN");
    return { ok: false, error: "missing_bot_token" };
  }

  if (!text) {
    return { ok: false, error: "empty_text" };
  }

  try {
    const response = await fetch(
      `${telegramApiBaseUrl()}/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: input.chatId,
          text,
          // 关掉链接预览：AI 回复里的网址不该在群里撑出一张卡片。
          disable_web_page_preview: true,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const description = await readTelegramErrorDescription(response);
      console.error(
        `Telegram sendMessage 失败（HTTP ${response.status}）${
          description ? `: ${description}` : ""
        }`,
      );

      return { ok: false, error: `http_${response.status}` };
    }

    return { ok: true };
  } catch (error) {
    // 网络异常只记录原因（不含 URL / token）。
    const reason = error instanceof Error ? error.message : String(error);
    console.error("Telegram sendMessage 网络异常:", reason);

    return { ok: false, error: "network_error" };
  }
}
