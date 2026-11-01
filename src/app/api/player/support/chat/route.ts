import type { NextRequest } from "next/server";

import { createChatLog } from "@/lib/ai/records";
import { resolvePlayerTenant } from "@/lib/player-tenant";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import {
  SUPPORT_MESSAGE_MAX_LENGTH,
  supportReplyKeyFor,
} from "@/lib/support-chat";
import {
  getSupportReplyText,
  isSupportLanguage,
} from "@/lib/support-chat-replies";

/**
 * POST /api/player/support/chat —— 玩家侧 AI 客服对话入口。
 *
 * 职责：
 * 1. 按「已登录玩家的租户 Cookie → 当前访问域名 → 默认租户」解析站点，
 *    绝不接受前端传入的 tenantId / site（否则访客可以把日志写进别家的商户后台）；
 * 2. 用与弹窗完全一致的关键词规则生成回复（src/lib/support-chat.ts）；
 * 3. 把 user / assistant 两条消息写进 AiChatLog，带 tenantId 与 playerId，
 *    供商户后台 /tenant/ai-logs 按租户查看。
 *
 * 落库失败不影响回复：客服窗口是玩家侧关键路径，宁可少一条日志也不能报错。
 */

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function persistLog(input: {
  role: "user" | "assistant";
  content: string;
  tenantId: string;
  playerId: string | null;
}) {
  try {
    await createChatLog({
      role: input.role,
      content: input.content,
      agentType: "support",
      tenantId: input.tenantId,
      playerId: input.playerId,
    });
  } catch (error) {
    // 服务端日志即可（不走 console.error 的 Server Component 回放通道）。
    console.warn("AI 客服对话写入失败:", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const message =
      typeof input.message === "string" ? input.message.trim() : "";

    if (!message) {
      return jsonError("消息不能为空", 400);
    }

    if (message.length > SUPPORT_MESSAGE_MAX_LENGTH) {
      return jsonError(
        `消息不能超过 ${SUPPORT_MESSAGE_MAX_LENGTH} 个字符`,
        400,
      );
    }

    const language = isSupportLanguage(input.language) ? input.language : "en";
    const tenant = await resolvePlayerTenant(request);

    if (!tenant) {
      return jsonError("当前站点暂不可用", 404);
    }

    const session = await getPlayerSessionFromRequest(request);
    const replyText = getSupportReplyText(language, supportReplyKeyFor(message));
    const playerId = session?.id ?? null;

    await Promise.all([
      persistLog({
        role: "user",
        content: message,
        tenantId: tenant.id,
        playerId,
      }),
      persistLog({
        role: "assistant",
        content: replyText,
        tenantId: tenant.id,
        playerId,
      }),
    ]);

    return Response.json(
      {
        success: true,
        reply: {
          content: replyText,
          createdAt: new Date().toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("AI 客服对话处理失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
