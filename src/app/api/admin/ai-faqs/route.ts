import type { NextRequest } from "next/server";

import {
  MAX_FAQ_ANSWER_LENGTH,
  MAX_FAQ_QUESTION_LENGTH,
} from "@/lib/ai/faq-types";
import {
  agentFaqTenantExists,
  createAgentFaq,
  isAgentFaqAgentType,
  listAgentFaqs,
} from "@/lib/ai/faqs";
import { guardPermission } from "@/lib/session";

const MAX_TENANT_ID_LENGTH = 64;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readFaqText(
  value: unknown,
  maxLength: number,
): { value: string } | { error: string } {
  if (typeof value !== "string") {
    return { error: "问题和标准答案必须是文本" };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return { error: "问题和标准答案不能为空" };
  }

  if (trimmed.length > maxLength) {
    return { error: `内容不能超过 ${maxLength} 个字符` };
  }

  return { value: trimmed };
}

async function readTenantId(
  value: unknown,
): Promise<{ value: string | null } | { error: string }> {
  if (value === undefined || value === null) {
    return { value: null };
  }

  if (typeof value !== "string") {
    return { error: "tenantId 必须是字符串或 null" };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return { value: null };
  }

  if (trimmed.length > MAX_TENANT_ID_LENGTH) {
    return { error: "tenantId 不合法" };
  }

  if (!(await agentFaqTenantExists(trimmed))) {
    return { error: "tenantId 对应的商户不存在" };
  }

  return { value: trimmed };
}

/**
 * /api/admin/ai-faqs —— 5 个 AI 助手的 FAQ 知识库。
 *
 * GET  ?agentType=tech
 * POST { agentType, question, answer, tenantId?: string | null }
 *
 * 仅 aiSettings 权限（默认 super_admin）可读写。
 */
export async function GET(request: NextRequest) {
  const gate = await guardPermission(request, "aiSettings");

  if (gate.response) {
    return gate.response;
  }

  const agentType = request.nextUrl.searchParams.get("agentType");

  if (!isAgentFaqAgentType(agentType)) {
    return jsonError(
      "agentType 只能是 sales、tech、finance、audit 或 strategist",
      400,
    );
  }

  try {
    const faqs = await listAgentFaqs({ agentType });
    return Response.json(
      { faqs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取 FAQ 知识库失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

export async function POST(request: NextRequest) {
  const gate = await guardPermission(request, "aiSettings");

  if (gate.response) {
    return gate.response;
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

  if (!isAgentFaqAgentType(input.agentType)) {
    return jsonError(
      "agentType 只能是 sales、tech、finance、audit 或 strategist",
      400,
    );
  }

  const question = readFaqText(input.question, MAX_FAQ_QUESTION_LENGTH);

  if ("error" in question) {
    return jsonError(`问题：${question.error}`, 400);
  }

  const answer = readFaqText(input.answer, MAX_FAQ_ANSWER_LENGTH);

  if ("error" in answer) {
    return jsonError(`标准答案：${answer.error}`, 400);
  }

  const tenantId = await readTenantId(input.tenantId);

  if ("error" in tenantId) {
    return jsonError(tenantId.error, 400);
  }

  try {
    const faq = await createAgentFaq({
      agentType: input.agentType,
      question: question.value,
      answer: answer.value,
      tenantId: tenantId.value,
    });

    return Response.json({ success: true, faq }, { status: 201 });
  } catch (error) {
    console.error("新增 FAQ 失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
