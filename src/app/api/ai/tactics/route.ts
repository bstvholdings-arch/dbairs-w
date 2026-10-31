import type { NextRequest } from "next/server";

import { generateFallbackTactic } from "@/lib/ai/fallback";
import {
  jsonError,
  jsonNoStore,
  readJsonObject,
  readTrimmedString,
} from "@/lib/ai/http";
import { buildTacticsMessages } from "@/lib/ai/prompts";
import {
  AiProviderError,
  requestChatCompletion,
} from "@/lib/ai/provider";
import { loadFailureReasonCounts } from "@/lib/ai/records";
import { resolveAiConnection } from "@/lib/ai/settings";
import { guardPermission } from "@/lib/session";

/**
 * POST /api/ai/tactics —— 战败复盘「生成对策」。
 *
 * 读取所有 failed 线索的 5 字原因统计，让模型生成一段可直接沉淀到
 * 销冠 AI System Prompt 的标准话术。本接口只生成、不落库；
 * 落库由用户点击「保存到 System Prompt」后调用 POST /api/ai/prompt。
 *
 * 请求体：{ focusReason?: string }（可选，点击某个原因时优先针对它生成）
 * 返回：{ tactic, model, fallback, warning, reasonCounts }
 */
export async function POST(request: NextRequest) {
  const gate = await guardPermission(request, "aiConsole");

  if (gate.response) {
    return gate.response;
  }

  const body = await readJsonObject(request);

  if (!body) {
    return jsonError("请求体格式错误，需要 JSON 对象（可为空对象 {}）", 400);
  }

  const focusReason = readTrimmedString(body.focusReason, 20);

  try {
    const reasonCounts = await loadFailureReasonCounts();

    if (reasonCounts.length === 0) {
      return jsonError(
        "暂无战败线索。先让销冠 AI 记录至少一条战败原因，再生成对策。",
        400,
      );
    }

    const ordered = focusReason
      ? [
          ...reasonCounts.filter((item) => item.reason === focusReason),
          ...reasonCounts.filter((item) => item.reason !== focusReason),
        ]
      : reasonCounts;

    if (focusReason && ordered[0]?.reason !== focusReason) {
      ordered.unshift({ reason: focusReason, count: 1 });
    }

    let tactic = "";
    let model = "local-rules";
    let fallback = false;
    let warning: string | null = null;

    try {
      const connection = await resolveAiConnection();
      const completion = await requestChatCompletion(
        buildTacticsMessages(ordered),
        { connection, temperature: 0.6, maxTokens: 500 },
      );

      tactic = completion.content.trim();
      model = completion.model;

      if (!tactic) {
        throw new AiProviderError("模型返回了空话术", 502);
      }
    } catch (error) {
      if (!(error instanceof AiProviderError)) {
        throw error;
      }

      warning = `${error.message} 已使用本地复盘模板生成对策。`;
      tactic = generateFallbackTactic(ordered);
      fallback = true;
    }

    return jsonNoStore({
      tactic,
      model,
      fallback,
      warning,
      reasonCounts: ordered,
    });
  } catch (error) {
    console.error("生成战败对策失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
