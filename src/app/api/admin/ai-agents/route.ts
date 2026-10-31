import type { NextRequest } from "next/server";

import {
  AI_CONSOLE_AGENT_TYPES,
  isAiAgentType,
} from "@/lib/ai/constants";
import {
  jsonError,
  jsonNoStore,
  readJsonObject,
  readTrimmedString,
} from "@/lib/ai/http";
import {
  listAgentConfigs,
  saveAgentConfig,
} from "@/lib/ai/records";
import { guardPermission } from "@/lib/session";

/**
 * /api/admin/ai-agents —— AI 控制中心的 5 个平台助手配置。
 *
 * GET  → { agents }（sales / tech / finance / audit / strategist）
 * POST → { agentName, systemPrompt?, model?, isEnabled?, tokenLimit? }
 *
 * 仅 aiSettings 权限（默认 super_admin）可读写。
 */
export async function GET(request: NextRequest) {
  const gate = await guardPermission(request, "aiSettings");

  if (gate.response) {
    return gate.response;
  }

  try {
    const agents = await listAgentConfigs();
    return jsonNoStore({ agents });
  } catch (error) {
    console.error("读取 Agent 配置失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
  const gate = await guardPermission(request, "aiSettings");

  if (gate.response) {
    return gate.response;
  }

  const body = await readJsonObject(request);

  if (!body) {
    return jsonError("请求体格式错误，需要 JSON 对象", 400);
  }

  if (
    !isAiAgentType(body.agentName) ||
    !(AI_CONSOLE_AGENT_TYPES as readonly string[]).includes(body.agentName)
  ) {
    return jsonError(
      "agentName 只能是 sales、tech、finance、audit 或 strategist",
      400,
    );
  }

  const agentName = body.agentName;
  const systemPrompt =
    typeof body.systemPrompt === "string"
      ? readTrimmedString(body.systemPrompt, 20_000)
      : undefined;
  const model =
    typeof body.model === "string"
      ? readTrimmedString(body.model, 120)
      : undefined;
  const isEnabled =
    typeof body.isEnabled === "boolean" ? body.isEnabled : undefined;
  const tokenLimitRaw =
    body.tokenLimit === undefined ? undefined : Number(body.tokenLimit);
  const tokenLimit =
    tokenLimitRaw === undefined || Number.isNaN(tokenLimitRaw)
      ? undefined
      : Math.trunc(tokenLimitRaw);

  if (systemPrompt !== undefined && !systemPrompt) {
    return jsonError("System Prompt 不能为空", 400);
  }

  if (model !== undefined && !model) {
    return jsonError("模型不能为空", 400);
  }

  if (
    tokenLimit !== undefined &&
    (tokenLimit < 100 || tokenLimit > 8000)
  ) {
    return jsonError("tokenLimit 需在 100–8000 之间", 400);
  }

  if (
    systemPrompt === undefined &&
    model === undefined &&
    isEnabled === undefined &&
    tokenLimit === undefined
  ) {
    return jsonError("没有需要保存的字段", 400);
  }

  try {
    const agent = await saveAgentConfig({
      agentName,
      systemPrompt,
      model,
      isEnabled,
      tokenLimit,
    });

    return jsonNoStore({ success: true, agent });
  } catch (error) {
    console.error("保存 Agent 配置失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
