import type { ReasonCount } from "@/lib/ai/constants";
import type {
  AiAgentConfigSnapshot,
  SerializedAiChatLog,
  SerializedLeadRecord,
  WarRoomSnapshot,
} from "@/lib/ai/records";

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
};

export type LeadsResponse = {
  leads?: SerializedLeadRecord[];
  statusCounts?: WarRoomSnapshot["statusCounts"];
  reasonCounts?: ReasonCount[];
  error?: string;
};

export type ChatResponse = {
  success?: boolean;
  reply?: SerializedAiChatLog;
  fallback?: boolean;
  model?: string;
  warning?: string | null;
  lead?: SerializedLeadRecord | null;
  failReason?: string | null;
  failureReasonSaved?: boolean;
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
