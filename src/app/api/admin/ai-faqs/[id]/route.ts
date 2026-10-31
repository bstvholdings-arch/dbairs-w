import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  MAX_FAQ_ANSWER_LENGTH,
  MAX_FAQ_QUESTION_LENGTH,
} from "@/lib/ai/faq-types";
import {
  agentFaqTenantExists,
  deleteAgentFaq,
  updateAgentFaq,
} from "@/lib/ai/faqs";
import { guardPermission } from "@/lib/session";

type AgentFaqRouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_TENANT_ID_LENGTH = 64;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * PATCH  /api/admin/ai-faqs/[id]
 *   body: { question?, answer?, tenantId?: string | null }
 *
 * DELETE /api/admin/ai-faqs/[id]
 *
 * 编辑不改变 agentType：FAQ 始终留在原助手，避免一条问答被误移到别的助手。
 */
export async function PATCH(
  request: NextRequest,
  context: AgentFaqRouteContext,
) {
  const gate = await guardPermission(request, "aiSettings");

  if (gate.response) {
    return gate.response;
  }

  const { id } = await context.params;

  if (!id.trim()) {
    return jsonError("FAQ ID 不能为空", 400);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("请求体格式错误", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("请求体格式错误，需要 JSON 对象", 400);
  }

  const input = body as Record<string, unknown>;
  const updates: {
    question?: string;
    answer?: string;
    tenantId?: string | null;
  } = {};

  if (hasOwn(input, "question")) {
    if (typeof input.question !== "string") {
      return jsonError("问题必须是文本", 400);
    }

    const question = input.question.trim();

    if (!question) {
      return jsonError("问题不能为空", 400);
    }

    if (question.length > MAX_FAQ_QUESTION_LENGTH) {
      return jsonError(
        `问题不能超过 ${MAX_FAQ_QUESTION_LENGTH} 个字符`,
        400,
      );
    }

    updates.question = question;
  }

  if (hasOwn(input, "answer")) {
    if (typeof input.answer !== "string") {
      return jsonError("标准答案必须是文本", 400);
    }

    const answer = input.answer.trim();

    if (!answer) {
      return jsonError("标准答案不能为空", 400);
    }

    if (answer.length > MAX_FAQ_ANSWER_LENGTH) {
      return jsonError(
        `标准答案不能超过 ${MAX_FAQ_ANSWER_LENGTH} 个字符`,
        400,
      );
    }

    updates.answer = answer;
  }

  if (hasOwn(input, "tenantId")) {
    if (input.tenantId === null) {
      updates.tenantId = null;
    } else if (typeof input.tenantId === "string") {
      const tenantId = input.tenantId.trim();

      if (tenantId.length > MAX_TENANT_ID_LENGTH) {
        return jsonError("tenantId 不合法", 400);
      }

      if (tenantId && !(await agentFaqTenantExists(tenantId))) {
        return jsonError("tenantId 对应的商户不存在", 400);
      }

      updates.tenantId = tenantId || null;
    } else {
      return jsonError("tenantId 必须是字符串或 null", 400);
    }
  }

  if (Object.keys(updates).length === 0) {
    return jsonError("没有需要保存的字段", 400);
  }

  try {
    const faq = await updateAgentFaq(id, updates);
    return Response.json({ success: true, faq });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("FAQ 不存在", 404);
    }

    console.error("更新 FAQ 失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  context: AgentFaqRouteContext,
) {
  const gate = await guardPermission(request, "aiSettings");

  if (gate.response) {
    return gate.response;
  }

  const { id } = await context.params;

  if (!id.trim()) {
    return jsonError("FAQ ID 不能为空", 400);
  }

  try {
    const deleted = await deleteAgentFaq(id);

    if (!deleted) {
      return jsonError("FAQ 不存在", 404);
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("删除 FAQ 失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
