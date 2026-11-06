/**
 * Telegram 群组路由的常驻回归测试（`npm run telegram:check`）。
 *
 * 为什么要有：群里「这条消息该谁答」「这个群是谁的」判定一旦被改坏，
 * 后果是**跨商户数据泄漏**（平台内部群的 /finance 或 A 商户群看到 B 商户数据），
 * 而这种问题在 UI 上完全看不出来。所以断言直接打 src/lib/telegram/* 的真实导出。
 *
 * 安全约定（可随时在本地 / CI 跑）：
 * - 纯函数为主：不发送任何 Telegram 请求（sendMessage 一律不调用）、不调用模型、不需要 Bot Token；
 * - 只有一条断言查库（未登记 chat_id → 未授权），且是 `findUnique` 只读查询；
 * - 任一项断言不通过即退出码 1，可直接当作上线门禁。
 *
 * 覆盖的防线（对应 AGENTS.md 第 6、7 条与第 15 条 Telegram 架构）：
 *   1. 指令解析：大小写 / `@BotName` 后缀 / 非指令文本
 *   2. 商户群不能切到平台助手（/sales、/audit、/strategist 一律拒绝）
 *   3. 平台内部群 5 大助手都能切
 *   4. 脏数据里的越权 agentType 回落综合客服
 *   5. 帮助文案不泄漏不属于本群的助手
 *   6. 空消息不回包、未知指令回帮助
 *   7. Update 解析：合法 / 缺 chat / 非 message 类型
 *   8. Webhook secret：未配置 → 503（fail-closed）、不匹配 → 401、匹配 → 放行
 *   9. 未登记 chat_id → 未授权（且只回固定话术）
 *  10. Prompt 作用域：商户群带商户名 + 记账币种，平台群带内部口径
 */
import "dotenv/config";

import {
  DEFAULT_TELEGRAM_AGENT,
  TELEGRAM_UNAUTHORIZED_REPLY,
  isTelegramAgentAllowed,
  normalizeTelegramChatAgent,
  telegramAgentsForScope,
} from "../src/lib/telegram/constants";
import { resolveTelegramChatBinding } from "../src/lib/telegram/bindings";
import { verifyTelegramWebhookSecret } from "../src/lib/telegram/dispatch";
import { buildTelegramScopePrompt } from "../src/lib/telegram/prompt";
import {
  parseTelegramCommand,
  resolveTelegramRoute,
} from "../src/lib/telegram/routing";
import { parseTelegramUpdate } from "../src/lib/telegram/types";
import { prisma } from "../src/lib/prisma";

const checks: { name: string; pass: boolean; detail: string }[] = [];

function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(
    `${pass ? "✓ PASS" : "✗ FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`,
  );
}

/** update 里有 bigint（updateId），打印时转成字符串。 */
function printable(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

async function main(): Promise<number> {
  // ------------------------------------------------------------ 指令解析
  const techCommand = parseTelegramCommand("/Tech");
  check(
    "指令大小写不敏感：/Tech → tech",
    techCommand?.name === "tech",
    printable(techCommand),
  );

  const atCommand = parseTelegramCommand("/finance@DbaBot  帮我查昨日入金");
  check(
    "剥掉群里的 @BotName 后缀并保留参数",
    atCommand?.name === "finance" &&
      atCommand?.argument === "帮我查昨日入金",
    printable(atCommand),
  );

  check(
    "普通文本不是指令",
    parseTelegramCommand("帮我查昨日入金") === null,
  );

  // ------------------------------------------------------------ 商户群路由
  const tenantDefault = resolveTelegramRoute({
    scope: "tenant",
    text: "昨日入金多少",
    currentAgent: DEFAULT_TELEGRAM_AGENT,
  });
  check(
    "商户群普通消息 → 当前助手（默认综合客服）",
    tenantDefault.kind === "agent_message" &&
      tenantDefault.agentType === "support",
    printable(tenantDefault),
  );

  const tenantSwitch = resolveTelegramRoute({
    scope: "tenant",
    text: "/tech",
    currentAgent: "support",
  });
  check(
    "商户群 /tech → 切换技术助手",
    tenantSwitch.kind === "switch_agent" && tenantSwitch.agentType === "tech",
    printable(tenantSwitch),
  );

  const tenantEscalate = resolveTelegramRoute({
    scope: "tenant",
    text: "/sales",
    currentAgent: "support",
  });
  check(
    "商户群 /sales → 拒绝，不切换",
    tenantEscalate.kind === "reply" &&
      tenantEscalate.reply.includes("仅平台内部群可用"),
    printable(tenantEscalate),
  );

  for (const command of ["/audit", "/strategist"]) {
    const decision = resolveTelegramRoute({
      scope: "tenant",
      text: command,
      currentAgent: "support",
    });
    check(`商户群 ${command} 一律拒绝`, decision.kind === "reply");
  }

  const tenantHelp = resolveTelegramRoute({
    scope: "tenant",
    text: "/help",
    currentAgent: "tech",
  });
  const tenantHelpText = tenantHelp.kind === "reply" ? tenantHelp.reply : "";
  check(
    "商户群 /help：列本群助手，不泄漏平台助手",
    tenantHelpText.includes("/tech") &&
      tenantHelpText.includes("/finance") &&
      !tenantHelpText.includes("/sales") &&
      !tenantHelpText.includes("/strategist"),
    tenantHelpText.replace(/\n/g, " | "),
  );

  const emptyRoute = resolveTelegramRoute({
    scope: "tenant",
    text: "   ",
    currentAgent: "support",
  });
  check("空消息 → 不回复", emptyRoute.kind === "ignore");

  const unknownRoute = resolveTelegramRoute({
    scope: "tenant",
    text: "/不存在的命令",
    currentAgent: "support",
  });
  check(
    "未知指令 → 回帮助（不静默丢弃）",
    unknownRoute.kind === "reply" && unknownRoute.reply.includes("未知指令"),
  );

  const resetRoute = resolveTelegramRoute({
    scope: "tenant",
    text: "/reset",
    currentAgent: "finance",
  });
  check(
    "商户群 /reset → 重置上下文",
    resetRoute.kind === "reset" && resetRoute.reply.includes("财务助手"),
  );

  // ------------------------------------------------------------ 平台内部群路由
  for (const agentType of [
    "sales",
    "tech",
    "finance",
    "audit",
    "strategist",
  ] as const) {
    const decision = resolveTelegramRoute({
      scope: "platform",
      text: `/${agentType}`,
      currentAgent: "support",
    });
    check(
      `平台内部群 /${agentType} → 切换`,
      decision.kind === "switch_agent" && decision.agentType === agentType,
    );
  }

  // ------------------------------------------------------------ 助手归一化
  check(
    "商户群残留 sales → 回落综合客服",
    normalizeTelegramChatAgent("tenant", "sales") === DEFAULT_TELEGRAM_AGENT,
  );
  check(
    "平台群保留 strategist",
    normalizeTelegramChatAgent("platform", "strategist") === "strategist",
  );
  check(
    "脏数据 null → 回落综合客服",
    normalizeTelegramChatAgent("platform", null) === DEFAULT_TELEGRAM_AGENT,
  );
  check(
    "商户群白名单只有 support / tech / finance",
    telegramAgentsForScope("tenant").join(",") === "support,tech,finance" &&
      !isTelegramAgentAllowed("tenant", "sales"),
  );
  check(
    "未授权话术是固定文案（不含商户信息）",
    TELEGRAM_UNAUTHORIZED_REPLY === "⛔ 未授权群组，请联系平台客服。",
  );

  // ------------------------------------------------------------ Update 解析
  const update = parseTelegramUpdate({
    update_id: 1001,
    message: {
      message_id: 5,
      chat: { id: -1001234567890, type: "supergroup", title: "示例商户运营群" },
      from: { id: 123456, username: "ops" },
      text: "/tech 玩家充值不到账",
    },
  });
  check(
    "解析正常 update：chat_id / update_id / 文本 / 群名",
    update?.message.chatId === "-1001234567890" &&
      update.updateId === BigInt(1001) &&
      update.message.chatType === "supergroup" &&
      update.message.chatTitle === "示例商户运营群" &&
      update.message.text === "/tech 玩家充值不到账",
    printable(update),
  );

  check(
    "非 message 类型 update（channel_post）→ 忽略",
    parseTelegramUpdate({ update_id: 1, channel_post: { chat: { id: -100 } } }) ===
      null,
  );
  check(
    "缺 chat_id → 忽略",
    parseTelegramUpdate({ update_id: 1, message: { text: "hi" } }) === null,
  );
  check(
    "update_id 非法 → 忽略",
    parseTelegramUpdate({
      update_id: "abc",
      message: { chat: { id: -100 } },
    }) === null,
  );

  const sticker = parseTelegramUpdate({
    update_id: 2,
    message: { message_id: 6, chat: { id: -100 } },
  });
  check(
    "无文本消息：可解析但 text 为空（由 dispatch 静默）",
    sticker?.message.text === "",
  );

  // ------------------------------------------------------------ Webhook 鉴权
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  try {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const missingSecret = verifyTelegramWebhookSecret("whatever");
    check(
      "未配置 TELEGRAM_WEBHOOK_SECRET → 503 fail-closed",
      !missingSecret.ok && missingSecret.status === 503,
    );

    process.env.TELEGRAM_WEBHOOK_SECRET = "t3st-secret-value";
    const wrongSecret = verifyTelegramWebhookSecret("t3st-secret-wrong");
    check(
      "secret 不匹配 → 401",
      !wrongSecret.ok && wrongSecret.status === 401,
    );
    check("缺少 secret header → 401", !verifyTelegramWebhookSecret(null).ok);
    check(
      "secret 匹配 → 放行",
      verifyTelegramWebhookSecret("t3st-secret-value").ok,
    );
  } finally {
    if (originalSecret === undefined) {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
    } else {
      process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    }
  }

  // ------------------------------------------------------------ Prompt 作用域
  const tenantPrompt = buildTelegramScopePrompt({
    scope: "tenant",
    agentType: "finance",
    tenantName: "示例商户",
    currency: "MYR",
  });
  check(
    "商户群 Prompt：带商户名 + 记账币种 + 禁提别家",
    tenantPrompt.includes("示例商户") &&
      tenantPrompt.includes("MYR") &&
      tenantPrompt.includes("不要提及平台其它商户"),
  );

  const platformPrompt = buildTelegramScopePrompt({
    scope: "platform",
    agentType: "sales",
  });
  check(
    "平台群 Prompt：内部口径，不带商户群限制",
    platformPrompt.includes("平台内部群") &&
      !platformPrompt.includes("不要提及平台其它商户"),
  );

  // ------------------------------------------- 未登记群（唯一一处查库，只读）
  const stranger = await resolveTelegramChatBinding("-1009999999999");
  check(
    "未登记 chat_id → 未授权（绝不回落任何租户）",
    stranger.scope === "unknown" && stranger.reason === "unregistered_chat",
    printable(stranger),
  );

  const badChatId = await resolveTelegramChatBinding("not-a-chat-id");
  check("非法 chat_id → 未授权", badChatId.scope === "unknown");

  // ------------------------------------------------------------ 汇总
  const failed = checks.filter((item) => !item.pass);

  console.log(
    `\n${failed.length === 0 ? "✓ 全部通过" : `✗ ${failed.length} 项未通过`}：${
      checks.length - failed.length
    }/${checks.length}\n`,
  );

  return failed.length === 0 ? 0 : 1;
}

main()
  .then(async (code) => {
    process.exitCode = code;
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("✗ 自检脚本自身出错:", error);
    process.exitCode = 1;
    await prisma.$disconnect();
  });

