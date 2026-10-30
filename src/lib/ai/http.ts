import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { getSuperAdminFromRequest } from "@/lib/super-admin";

/** 所有 AI 接口统一 no-store，避免日志 / 线索被 CDN 或浏览器缓存。 */
export function jsonNoStore(
  payload: unknown,
  status = 200,
): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function jsonError(message: string, status: number): Response {
  return jsonNoStore({ error: message }, status);
}

export async function readJsonObject(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readTrimmedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function safeEquals(expected: string, provided: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided, "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/**
 * POST /api/ai/log 的鉴权：
 * 1. 超级管理员 Cookie（后台手动补录 / 调试）；
 * 2. 外部销售机器人：x-ai-log-token === AI_LOG_TOKEN。
 *
 * 两者都不满足时返回 401；未配置 AI_LOG_TOKEN 时只有超管可用。
 */
export async function authorizeLogIngest(
  request: NextRequest,
): Promise<Response | null> {
  const admin = await getSuperAdminFromRequest(request);

  if (admin) {
    return null;
  }

  const expected = (process.env.AI_LOG_TOKEN ?? "").trim();
  const provided = (request.headers.get("x-ai-log-token") ?? "").trim();

  if (expected && provided && safeEquals(expected, provided)) {
    return null;
  }

  return jsonError(
    "未授权：请提供有效的 x-ai-log-token，或以超级管理员身份登录",
    401,
  );
}
