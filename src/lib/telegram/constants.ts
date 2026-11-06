import type { AiAgentTypeValue } from "@/lib/ai/constants";

/**
 * Telegram Bot 多群组接入的共享常量（纯数据）。
 *
 * 这里不 import Prisma / next/*，因此 Webhook 路由、后台页面与回归脚本
 * （scripts/check-telegram-routing.ts）可以复用同一份判定，不会出现
 * 「接口认的助手」与「群里能切到的助手」两套口径。
 *
 * 架构口径（全平台只跑 1 个 Bot，服务多个商户群 + 平台内部群）：
 * 1. 群的身份**只由 chat_id 决定**：Tenant.telegramChatId = 商户专属群；
 *    AdminUser.telegramChatId（tenantId 必须为 NULL 且 role=super_admin）= 平台内部群；
 * 2. 对不上号的群一律「未授权」：不查任何业务表、不调用模型、不回显任何商户信息；
 * 3. 群内切换助手只改 TelegramChatSession.agentType，不改任何业务配置。
 */

export type TelegramChatScope = "tenant" | "platform";

/** 商户群可用的助手：综合客服（默认接待）+ 技术 + 财务。 */
export const TENANT_TELEGRAM_AGENTS = [
  "support",
  "tech",
  "finance",
] as const satisfies readonly AiAgentTypeValue[];

/**
 * 平台内部群可用的助手：AI 控制中心 5 大助手 + 综合客服（默认接待）。
 * 顺序即帮助文案里的展示顺序。
 */
export const PLATFORM_TELEGRAM_AGENTS = [
  "support",
  "sales",
  "tech",
  "finance",
  "audit",
  "strategist",
] as const satisfies readonly AiAgentTypeValue[];

/** 不发指令时的默认接待：综合客服。 */
export const DEFAULT_TELEGRAM_AGENT: AiAgentTypeValue = "support";

/**
 * 指令 → 助手。
 * 只认这些命令；其余 /xxx 一律回帮助文案（不猜、不静默）。
 */
export const TELEGRAM_AGENT_COMMANDS: Readonly<
  Record<string, AiAgentTypeValue>
> = {
  support: "support",
  kefu: "support",
  tech: "tech",
  finance: "finance",
  sales: "sales",
  audit: "audit",
  strategist: "strategist",
};

export const TELEGRAM_AGENT_LABELS: Readonly<Record<AiAgentTypeValue, string>> =
  {
    support: "综合客服",
    sales: "销冠助手",
    tech: "技术助手",
    finance: "财务助手",
    audit: "审计助手",
    strategist: "创业导师",
  };

export function telegramAgentLabel(agentType: AiAgentTypeValue): string {
  return TELEGRAM_AGENT_LABELS[agentType] ?? TELEGRAM_AGENT_LABELS.support;
}

/** 该群可用哪些助手（商户群与平台内部群**不一样**，权限来自这里）。 */
export function telegramAgentsForScope(
  scope: TelegramChatScope,
): readonly AiAgentTypeValue[] {
  return scope === "platform" ? PLATFORM_TELEGRAM_AGENTS : TENANT_TELEGRAM_AGENTS;
}

export function isTelegramAgentAllowed(
  scope: TelegramChatScope,
  agentType: AiAgentTypeValue,
): boolean {
  return telegramAgentsForScope(scope).includes(agentType);
}

/**
 * 把数据库里的 agentType 归一化成「该群合法」的助手。
 * 商户群残留 sales / audit / strategist（例如群从平台内部群改成商户群）时回落综合客服。
 */
export function normalizeTelegramChatAgent(
  scope: TelegramChatScope,
  value: unknown,
): AiAgentTypeValue {
  if (typeof value !== "string") {
    return DEFAULT_TELEGRAM_AGENT;
  }

  const allowed = telegramAgentsForScope(scope) as readonly string[];

  return allowed.includes(value)
    ? (value as AiAgentTypeValue)
    : DEFAULT_TELEGRAM_AGENT;
}

/**
 * 未登记群 / 已停用商户的统一回复。
 * **禁止**在这句话里带商户名、站点、Bot 用户名等任何可用于探测的信息。
 */
export const TELEGRAM_UNAUTHORIZED_REPLY = "⛔ 未授权群组，请联系平台客服。";

/** 单条发送文本上限（Telegram 官方的 4096 略留余量）。 */
export const TELEGRAM_MESSAGE_LIMIT = 4000;

/** Webhook 请求体上限：正常 update 几 KB，256KB 足够并挡掉明显的垃圾请求。 */
export const TELEGRAM_UPDATE_MAX_BYTES = 256 * 1024;

/** Telegram 官方回填的鉴权头（setWebhook 时用 secret_token 设定）。 */
export const TELEGRAM_WEBHOOK_SECRET_HEADER =
  "x-telegram-bot-api-secret-token";
