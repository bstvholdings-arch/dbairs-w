import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import {
  parseSettlementDate,
  previousUtcDayStart,
  settleDailyRebates,
} from "@/lib/rebate-settlement";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 每日洗码结算的定时任务入口（服务器 cron / Vercel Cron / GitHub Actions 均可）。
 *
 * POST /api/cron/rebate-settlement
 *   header  x-cron-secret: <CRON_SECRET>   （或 Authorization: Bearer <CRON_SECRET>）
 *   body    { "date"?: "YYYY-MM-DD", "tenantId"?: "<id>", "dryRun"?: true }
 *   query   ?date=YYYY-MM-DD&tenantId=<id>&dryRun=1（与 body 等价，方便 curl）
 *
 * 安全约定（不可放宽）：
 * - **必须配 CRON_SECRET**（或 REBATE_CRON_SECRET）。没配就直接 503 拒绝服务，
 *   绝不允许「谁都能打一下就把全平台洗码发出去」；
 * - 密钥比较用 timingSafeEqual，长度不同直接失败（避免长度侧信道）；
 * - 幂等由 RebatePayout 的唯一键兜住：重复调用 / 重试 / 手动补跑都不会重复发钱；
 * - 默认结算「昨天（UTC）」；指定 date 用于补发，dryRun 用于先看金额再发。
 *
 * 注意：这里**不查 cookie、不读会话**，它是机器对机器的接口。
 */
function readSecret() {
  return (process.env.CRON_SECRET ?? process.env.REBATE_CRON_SECRET ?? "").trim();
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length === 0 || left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function readProvidedSecret(request: NextRequest) {
  const header = request.headers.get("x-cron-secret")?.trim() ?? "";

  if (header) {
    return header;
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return request.nextUrl.searchParams.get("secret")?.trim() ?? "";
}

export async function POST(request: NextRequest) {
  const secret = readSecret();

  if (!secret) {
    return jsonError(
      "未配置 CRON_SECRET，洗码结算接口已禁用（请在环境变量里设置后再调用）",
      503,
    );
  }

  if (!safeEqual(readProvidedSecret(request), secret)) {
    return jsonError("无权调用结算接口", 401);
  }

  let body: Record<string, unknown> = {};

  try {
    const raw = await request.text();

    if (raw.trim()) {
      const parsed: unknown = JSON.parse(raw);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    }
  } catch {
    return jsonError("请求体不是合法的 JSON", 400);
  }

  const search = request.nextUrl.searchParams;
  const rawDate = body.date ?? search.get("date");
  const rawTenantId = body.tenantId ?? search.get("tenantId");
  const rawDryRun = body.dryRun ?? search.get("dryRun");

  const periodStart =
    rawDate === undefined || rawDate === null || rawDate === ""
      ? previousUtcDayStart()
      : parseSettlementDate(rawDate);

  if (!periodStart) {
    return jsonError("date 必须是 YYYY-MM-DD 格式（UTC 日界）", 400);
  }

  const tenantId =
    typeof rawTenantId === "string" && rawTenantId.trim()
      ? rawTenantId.trim()
      : undefined;
  const dryRun =
    rawDryRun === true ||
    rawDryRun === 1 ||
    rawDryRun === "1" ||
    rawDryRun === "true";

  try {
    const result = await settleDailyRebates({ periodStart, tenantId, dryRun });

    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("洗码结算失败:", error);

    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
