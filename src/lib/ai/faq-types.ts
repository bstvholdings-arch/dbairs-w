import type { AiAgentTypeValue } from "./constants";

/**
 * FAQ 的客户端安全常量与类型。
 *
 * 不要把 Prisma / 服务端检索逻辑放进本文件：后台抽屉是 Client Component，
 * 从这里导入运行时常量不会把数据库驱动打进浏览器包。
 */

export const MAX_FAQ_QUESTION_LENGTH = 300;
export const MAX_FAQ_ANSWER_LENGTH = 6000;

export type AgentFaqSnapshot = {
  id: string;
  agentType: AiAgentTypeValue;
  question: string;
  answer: string;
  tenantId: string | null;
  tenantName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentFaqTenantOption = {
  id: string;
  name: string;
  domain: string;
};
