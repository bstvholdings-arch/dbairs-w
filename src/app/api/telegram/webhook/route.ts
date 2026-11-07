import { connection } from "next/server";
import type { NextRequest } from "next/server";

import { jsonNoStore } from "@/lib/ai/http";
import { appBaseUrl } from "@/lib/mailer";
import {
  TELEGRAM_UPDATE_MAX_BYTES,
  TELEGRAM_WEBHOOK_SECRET_HEADER,
} from "@/lib/telegram/constants";
import { handleTelegramWebhook } from "@/lib/telegram/dispatch";

/**
 * Telegram Bot Webhook（全平台只跑 1 个 Bot，服务多个商户群 + 平台内部群）。
 *
 * 对接步骤（只在部署时做一次，不在代码里做）：
 *   1. 环境变量：TELEGRAM_BOT_TOKEN、TELEGRAM_WEBHOOK_SECRET（必填，缺失即 fail-closed）；
 *   2. 把群绑到商户：`UPDATE "Tenant" SET "telegramChatId" = '-100…' WHERE …`；
 *      把平台内部群绑到超管：`UPDATE "AdminUser" SET "telegramChatId" = '-100…' WHERE role='super_admin' …`；
 *   3. 注册回调：curl "https://api.telegram.org/bot<TOKEN>/setWebhook"
 *        -d "url=https://<域名>/api/telegram/webhook"
 *        -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 *        -d "allowed_updates=[\"message\"]"；
 *   4. 群里发 /help 自检。
 *
 * 三条硬规则：
 * - **必须 `await connection()`**：Next 16 开了 cacheComponents，Webhook 是纯请求期执行；
 *   同理**不允许**写 `export const dynamic = "force-dynamic"` 或 `export const runtime = "nodejs"`
 *   —— 两者都会让 `next build` 直接失败（route segment config 与 cacheComponents 不兼容），
 *   而 Route Handler 本来默认就是 Node.js runtime，不需要声明；
 * - **只读原始字符串**：secret 校验用 header 里的明文比对（timingSafeEqual），
 *   绝不先 parse 再 stringify；
 * - **永远尽快 200**：Telegram 收不到 200 会重投同一条 update，
 *   所以业务异常的兜底也在 handleTelegramWebhook 内部消化（回一句「请稍后重试」）。
 */

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return jsonNoStore(body, status);
}

export async function POST(request: NextRequest) {
  await connection();

  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return jsonResponse({ ok: false, error: "无法读取请求体" }, 400);
  }

  if (Buffer.byteLength(rawBody, "utf8") > TELEGRAM_UPDATE_MAX_BYTES) {
    return jsonResponse({ ok: false, error: "请求体过大" }, 413);
  }

  const outcome = await handleTelegramWebhook({
    rawBody,
    secretHeader: request.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER),
    baseUrl: appBaseUrl(),
  });

  return jsonResponse(outcome.body, outcome.status);
}

/** 运维探活用：确认路由被正确部署（不暴露任何配置，也不碰数据库）。 */
export async function GET() {
  await connection();

  return new Response("Telegram webhook is up. POST only.", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
