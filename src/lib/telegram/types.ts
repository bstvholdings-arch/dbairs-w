/**
 * Telegram Update 的最小结构解析。
 *
 * 项目没有引入 telegram SDK（与 AI provider 同一思路：只要一个 HTTP 端点），
 * 所以这里只做「够用且严格」的字段读取：
 * - 只接受带 `message` 和文本消息的 update（贴纸 / 图片 / 入群事件一律忽略）；
 * - chat_id / update_id 必须是非空整数，格式不对直接当非法请求；
 * - 其余字段（from / title）只用于日志与提示，拿不到就留空，绝不因此报错。
 */

export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export type TelegramMessage = {
  messageId: number;
  /** 群 id 为负数（-100…），统一按字符串处理。 */
  chatId: string;
  chatType: TelegramChatType;
  chatTitle: string | null;
  fromId: string | null;
  fromName: string | null;
  text: string;
};

export type TelegramUpdate = {
  updateId: bigint;
  message: TelegramMessage;
};

const CHAT_ID_PATTERN = /^-?\d{1,20}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/** chat_id 可能是 number 也可能是数字字符串，统一成字符串；非法值返回 null。 */
export function readTelegramChatId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return CHAT_ID_PATTERN.test(trimmed) ? trimmed : null;
  }

  return null;
}

function readChatType(value: unknown): TelegramChatType {
  return value === "group" ||
    value === "supergroup" ||
    value === "channel" ||
    value === "private"
    ? value
    : "private";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 解析一次 Webhook 回调。
 *
 * 返回 null 表示「不是我们要处理的消息」（不支持的类型 / 结构损坏），
 * 调用方应直接 200 回包，避免 Telegram 反复重投。
 */
export function parseTelegramUpdate(payload: unknown): TelegramUpdate | null {
  const root = asRecord(payload);

  if (!root) {
    return null;
  }

  const updateIdRaw = root.update_id;

  if (
    typeof updateIdRaw !== "number" ||
    !Number.isSafeInteger(updateIdRaw) ||
    updateIdRaw <= 0
  ) {
    return null;
  }

  const message = asRecord(root.message);

  if (!message) {
    return null;
  }

  const chat = asRecord(message.chat);
  const chatId = readTelegramChatId(chat?.id);

  if (!chatId) {
    return null;
  }

  const from = asRecord(message.from);
  const messageIdRaw = message.message_id;

  return {
    updateId: BigInt(updateIdRaw),
    message: {
      messageId:
        typeof messageIdRaw === "number" && Number.isSafeInteger(messageIdRaw)
          ? messageIdRaw
          : 0,
      chatId,
      chatType: readChatType(chat?.type),
      chatTitle:
        readString(chat?.title) ??
        readString(chat?.username) ??
        readString(from?.first_name),
      fromId: readTelegramChatId(from?.id),
      fromName: readString(from?.username) ?? readString(from?.first_name),
      text: readString(message.text) ?? "",
    },
  };
}
