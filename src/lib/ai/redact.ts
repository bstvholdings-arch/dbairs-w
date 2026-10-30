import { MAX_CHAT_CONTENT_LENGTH } from "./constants";

/**
 * 对话日志脱敏。
 *
 * 销售对话会被永久保留，但客户联系方式属于隐私数据：
 * - 邮箱：`ab***@gmail.com`
 * - 手机号 / 国际号码：`+12*****90`
 * - USDT / TRON 钱包：`0xabc...1234`
 * - Telegram 链接 / @handle：`t.me/***`、`@***`
 *
 * 原始联系方式只写入 LeadRecord.tgOrEmail（超管跟进用），
 * 任何进入 AiChatLog 的内容都必须先经过本函数。
 */

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const INTL_PHONE_PATTERN = /(?:\+|00)\d[\d\s-]{6,}\d/g;
const CN_PHONE_PATTERN = /(^|[^\d])(1[3-9]\d{9})(?!\d)/g;
const MY_PHONE_PATTERN = /(^|[^\d])(01\d[-\s]?\d{3,4}[-\s]?\d{4})(?!\d)/g;
const EVM_WALLET_PATTERN = /0x[a-fA-F0-9]{40}/g;
const TRON_WALLET_PATTERN = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g;
const TELEGRAM_LINK_PATTERN = /(?:https?:\/\/)?t\.me\/[A-Za-z0-9_]{3,}/gi;
const TELEGRAM_HANDLE_PATTERN = /(^|\s)@[A-Za-z0-9_]{3,}/g;

function maskEmail(value: string) {
  const [localPart, domain] = value.split("@");

  if (!domain) {
    return "***";
  }

  const visible = localPart.slice(0, 2);

  return `${visible}***@${domain}`;
}

function maskPhone(value: string) {
  const prefix = value.trimStart().startsWith("+") ? "+" : "";
  const digits = value.replace(/\D/g, "");

  if (digits.length <= 6) {
    return `${prefix}***`;
  }

  return `${prefix}${digits.slice(0, 2)}*****${digits.slice(-2)}`;
}

function maskWallet(value: string) {
  if (value.length <= 12) {
    return "***";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function redactSensitiveContent(
  input: string,
  maxLength = MAX_CHAT_CONTENT_LENGTH,
): string {
  let output = input.replace(/\r\n/g, "\n").trim();

  if (!output) {
    return "";
  }

  output = output
    .replace(EMAIL_PATTERN, maskEmail)
    .replace(INTL_PHONE_PATTERN, maskPhone)
    .replace(
      CN_PHONE_PATTERN,
      (_match, boundary: string, phone: string) =>
        `${boundary}${maskPhone(phone)}`,
    )
    .replace(
      MY_PHONE_PATTERN,
      (_match, boundary: string, phone: string) =>
        `${boundary}${maskPhone(phone)}`,
    )
    .replace(EVM_WALLET_PATTERN, maskWallet)
    .replace(TRON_WALLET_PATTERN, maskWallet)
    .replace(TELEGRAM_LINK_PATTERN, "t.me/***")
    .replace(
      TELEGRAM_HANDLE_PATTERN,
      (_match, boundary: string) => `${boundary}@***`,
    );

  return output.length > maxLength ? output.slice(0, maxLength) : output;
}
