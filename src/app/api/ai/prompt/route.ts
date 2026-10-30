import type { NextRequest } from "next/server";

import {
  DEFAULT_AI_AGENT,
  isAiAgentType,
} from "@/lib/ai/constants";
import {
  jsonError,
  jsonNoStore,
  readJsonObject,
  readTrimmedString,
} from "@/lib/ai/http";
import {
  appendTactic,
  getAgentConfigSnapshot,
  saveSystemPrompt,
} from "@/lib/ai/records";
import { guardPermission } from "@/lib/session";

/**
 * /api/ai/prompt —— 销冠 AI 的 System Prompt。
 *
 * GET  ?agentType=sales
 *      → { config: { systemPrompt, tactics, effectivePrompt, updatedAt } }
 *
 * POST { agentType?, tactic }        → 把「生成对策」的话术追加到 tactics（默认动作）
 * POST { agentType?, systemPrompt }  → 手动覆盖基础人设（保留 tactics）
 *
 * 仅 aiConsole 权限（默认 super_admin）可读写。
 */
export async function GET(request: NextRequest) {
  const gate = await guardPermission(request, "aiConsole");

  if (gate.response) {
    return gate.response;
  }

  const agentTypeParam = request.nextUrl.searchParams.get("agentType");
  const agentType = isAiAgentType(agentTypeParam)
    ? agentTypeParam
    : DEFAULT_AI_AGENT;

  if (agentTypeParam && !isAiAgentType(agentTypeParam)) {
    return jsonError("agentType 只能是 sales、tech 或 support", 400);
  }

  try {
    const config = await getAgentConfigSnapshot(agentType);
    return jsonNoStore({ success: true, config });
  } catch (error) {
    console.error("读取 AI System Prompt 失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
  const gate = await guardPermission(request, "aiConsole");

  if (gate.response) {
    return gate.response;
  }

  const body = await readJsonObject(request);

  if (!body) {
    return jsonError("请求体格式错误，需要 JSON 对象", 400);
  }

  if (body.agentType !== undefined && !isAiAgentType(body.agentType)) {
    return jsonError("agentType 只能是 sales、tech 或 support", 400);
  }

  const agentType = isAiAgentType(body.agentType)
    ? body.agentType
    : DEFAULT_AI_AGENT;
  const tactic = readTrimmedString(body.tactic, 2000);
  const systemPrompt = readTrimmedString(body.systemPrompt, 20_000);

  try {
    if (tactic) {
      const result = await appendTactic(agentType, tactic);

      return jsonNoStore({
        success: true,
        alreadyPresent: result.alreadyPresent,
        config: result.config,
      });
    }

    if (systemPrompt) {
      const config = await saveSystemPrompt(agentType, systemPrompt);
      return jsonNoStore({ success: true, alreadyPresent: false, config });
    }

    return jsonError("需要提供 tactic 或 systemPrompt", 400);
  } catch (error) {
    console.error("保存 AI System Prompt 失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
