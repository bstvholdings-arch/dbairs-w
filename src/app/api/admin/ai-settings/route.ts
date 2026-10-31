import type { NextRequest } from "next/server";

import {
  jsonError,
  jsonNoStore,
  readJsonObject,
} from "@/lib/ai/http";
import {
  AiSettingsError,
  getAiSettingsSnapshot,
  saveAiSettings,
} from "@/lib/ai/settings";
import { guardPermission } from "@/lib/session";

/**
 * /api/admin/ai-settings —— AI 控制中心的全局模型接入配置。
 *
 * GET  → { settings }，apiKey 永远是掩码（sk-****abcd），绝不返回明文。
 * POST → 保存 provider / apiKey / baseUrl / model / isActive。
 *        apiKey 留空或仍为掩码时保留数据库原值，clearApiKey=true 才清空。
 *
 * 仅 aiSettings 权限（默认 super_admin）可访问。
 */
export async function GET(request: NextRequest) {
  const gate = await guardPermission(request, "aiSettings");

  if (gate.response) {
    return gate.response;
  }

  try {
    const settings = await getAiSettingsSnapshot();
    return jsonNoStore({ settings });
  } catch (error) {
    console.error("读取 AI 接入配置失败:", error);
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

  try {
    const settings = await saveAiSettings({
      provider: body.provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      model: body.model,
      isActive: body.isActive,
      clearApiKey: body.clearApiKey,
    });

    return jsonNoStore({ success: true, settings });
  } catch (error) {
    if (error instanceof AiSettingsError) {
      return jsonError(error.message, error.status);
    }

    console.error("保存 AI 接入配置失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
