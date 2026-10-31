import type { NextRequest } from "next/server";

import {
  DEFAULT_AI_AGENT,
  MAX_CHAT_CONTENT_LENGTH,
  isAiAgentType,
  isAiChatRole,
} from "@/lib/ai/constants";
import {
  authorizeLogIngest,
  jsonError,
  jsonNoStore,
  readJsonObject,
  readTrimmedString,
} from "@/lib/ai/http";
import {
  createChatLog,
  loadRecentChatLogs,
  serializeLead,
} from "@/lib/ai/records";
import { prisma } from "@/lib/prisma";
import { guardPermission } from "@/lib/session";

/**
 * POST /api/ai/log —— AI 对话日志上报（外部销售机器人 / 后台补录）。
 *
 * 鉴权：超管 Cookie 或 x-ai-log-token（AI_LOG_TOKEN），见 src/lib/ai/http.ts。
 * 脱敏：content 在 createChatLog 内统一处理（邮箱、手机号、钱包、TG 全部打码）。
 * 线索：同时传 tgOrEmail + brandName 时按唯一键 upsert，日志自动挂到 leadId 上；
 *       只有联系方式、没有品牌名时只存日志，不创建线索。
 */
export async function POST(request: NextRequest) {
  const authError = await authorizeLogIngest(request);

  if (authError) {
    return authError;
  }

  const body = await readJsonObject(request);

  if (!body) {
    return jsonError("请求体格式错误，需要 JSON 对象", 400);
  }

  const role = body.role;

  if (!isAiChatRole(role)) {
    return jsonError("role 只能是 user 或 assistant", 400);
  }

  const agentType = isAiAgentType(body.agentType)
    ? body.agentType
    : DEFAULT_AI_AGENT;

  const content = readTrimmedString(body.content, MAX_CHAT_CONTENT_LENGTH);

  if (!content) {
    return jsonError("content 不能为空", 400);
  }

  const tgOrEmail = readTrimmedString(body.tgOrEmail, 120);
  const brandName = readTrimmedString(body.brandName, 80);
  const inputLeadId = readTrimmedString(body.leadId, 64);

  try {
    let leadId = inputLeadId || null;

    if (tgOrEmail && brandName) {
      const lead = await prisma.leadRecord.upsert({
        where: {
          tgOrEmail_brandName: { tgOrEmail, brandName },
        },
        update: {},
        create: {
          tgOrEmail,
          brandName,
          status: "pending",
        },
        select: {
          id: true,
          tgOrEmail: true,
          brandName: true,
          status: true,
          failReason: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      leadId = lead.id;

      const log = await createChatLog({
        role,
        content,
        agentType,
        leadId,
      });

      return jsonNoStore(
        {
          success: true,
          log,
          lead: serializeLead(lead),
          leadId,
        },
        201,
      );
    }

    if (leadId) {
      const lead = await prisma.leadRecord.findUnique({
        where: { id: leadId },
        select: { id: true },
      });

      if (!lead) {
        return jsonError("leadId 对应的线索不存在", 404);
      }
    }

    const log = await createChatLog({
      role,
      content,
      agentType,
      leadId,
    });

    return jsonNoStore({ success: true, log, lead: null, leadId }, 201);
  } catch (error) {
    console.error("写入 AI 对话日志失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/**
 * GET /api/ai/log —— 后台按智能体 / 线索读取最近日志（AI 中控台使用）。
 * 该接口不在 proxy 的免登录白名单里，guardPermission 是第二道校验。
 */
export async function GET(request: NextRequest) {
  const gate = await guardPermission(request, "aiConsole");

  if (gate.response) {
    return gate.response;
  }

  const params = request.nextUrl.searchParams;
  const agentType = params.get("agentType");
  const leadId = (params.get("leadId") ?? "").trim();
  const takeRaw = Number.parseInt(params.get("take") ?? "", 10);

  if (agentType && !isAiAgentType(agentType)) {
    return jsonError("agentType 不是受支持的 AI 助手", 400);
  }

  try {
    const logs = await loadRecentChatLogs({
      agentType: isAiAgentType(agentType) ? agentType : undefined,
      leadId: leadId || undefined,
      take: Number.isFinite(takeRaw) ? takeRaw : undefined,
    });

    return jsonNoStore({ logs });
  } catch (error) {
    console.error("读取 AI 对话日志失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
