import type {
  AiConsoleAgentName,
  ReasonCount,
} from "@/lib/ai/constants";
import type {
  AiAgentConfigSnapshot,
  SerializedAiChatLog,
  SerializedLeadRecord,
  WarRoomSnapshot,
} from "@/lib/ai/records";
import type { AiSettingsSnapshot } from "@/lib/ai/settings";
import type { TranslationKey } from "@/lib/i18n-types";

/**
 * AI 中控台的共享类型。
 *
 * 只放 type / 常量，不 import Prisma 或服务端模块，因此客户端组件可以安全复用。
 */

export type LeadFilter = "open" | "failed" | "pending" | "success" | "all";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** 本地规则兜底生成的消息（仅助手消息使用）。 */
  fallback?: boolean;
  /** 实际调用的模型，展示在助手气泡下方。 */
  model?: string;
};

export type LeadsResponse = {
  leads?: SerializedLeadRecord[];
  statusCounts?: WarRoomSnapshot["statusCounts"];
  reasonCounts?: ReasonCount[];
  error?: string;
};

export type ChatResponse = {
  success?: boolean;
  agentType?: string;
  reply?: SerializedAiChatLog;
  fallback?: boolean;
  model?: string;
  warning?: string | null;
  lead?: SerializedLeadRecord | null;
  failReason?: string | null;
  failureReasonSaved?: boolean;
  /** 「新对话」首轮由服务端返回的新上下文起点，后续请求用它过滤历史。 */
  contextStartedAt?: string | null;
  error?: string;
};

export type TacticsResponse = {
  tactic?: string;
  model?: string;
  fallback?: boolean;
  warning?: string | null;
  reasonCounts?: ReasonCount[];
  error?: string;
};

export type PromptResponse = {
  success?: boolean;
  alreadyPresent?: boolean;
  config?: AiAgentConfigSnapshot;
  error?: string;
};

export type LogsResponse = {
  logs?: SerializedAiChatLog[];
  error?: string;
};

export type AiSettingsResponse = {
  success?: boolean;
  settings?: AiSettingsSnapshot;
  error?: string;
};

export type AiAgentsResponse = {
  success?: boolean;
  agent?: AiAgentConfigSnapshot;
  agents?: AiAgentConfigSnapshot[];
  error?: string;
};

export type TestChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  model?: string;
};

export type TestChatResponse = {
  success?: boolean;
  testMode?: boolean;
  reply?: SerializedAiChatLog;
  model?: string;
  warning?: string | null;
  error?: string;
};

export const AGENT_COPY_KEYS: Record<
  AiConsoleAgentName,
  { name: TranslationKey; description: TranslationKey }
> = {
  sales: {
    name: "aiConsole.agent.sales.name",
    description: "aiConsole.agent.sales.desc",
  },
  tech: {
    name: "aiConsole.agent.tech.name",
    description: "aiConsole.agent.tech.desc",
  },
  finance: {
    name: "aiConsole.agent.finance.name",
    description: "aiConsole.agent.finance.desc",
  },
  audit: {
    name: "aiConsole.agent.audit.name",
    description: "aiConsole.agent.audit.desc",
  },
  strategist: {
    name: "aiConsole.agent.strategist.name",
    description: "aiConsole.agent.strategist.desc",
  },
};

export const LEAD_FILTERS: readonly LeadFilter[] = [
  "open",
  "failed",
  "pending",
  "success",
  "all",
];

export const LEAD_FILTER_LABEL_KEYS = {
  open: "aiConsole.war.filter.open",
  failed: "aiConsole.war.filter.failed",
  pending: "aiConsole.war.filter.pending",
  success: "aiConsole.war.filter.success",
  all: "aiConsole.war.filter.all",
} as const;

export const LEAD_STATUS_LABEL_KEYS = {
  pending: "aiConsole.status.pending",
  success: "aiConsole.status.success",
  failed: "aiConsole.status.failed",
} as const;
