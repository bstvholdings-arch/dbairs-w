/**
 * 租户隔离 / 只读工具 / 脱敏的常驻回归测试（`npm run ai:isolation:check`）。
 *
 * 为什么留成常驻用例：断言打的是 src/lib/ai/tools.ts 的真实导出，不是另写一份
 * 逻辑，所以「where 条件被改坏」「新工具忘了进白名单」这类回归会立刻变红。
 *
 * 安全约定（可随时在本地 / CI 跑）：
 * - 只读：不发任何写库语句、不调用模型、不需要 API Key、不需要 dev server；
 * - 只依赖 DATABASE_URL；库里少于 2 个租户时直接失败，避免「跳过 = 假绿」；
 * - 任一项断言不通过即退出码 1，可直接当作上线门禁。
 *
 * 覆盖的防线（对应 AGENTS.md 第 5、6 条）：
 *   1. 商户账号不得查询别家商户（resolveAiToolScope → 403）
 *   2. 平台账号不选商户 → 不下发数据工具
 *   3. 白名单外的工具名 → 403，且不查库
 *   4. 模型参数里伪造 tenantId / merchantId → 403，且不查库
 *   5. 跨租户按用户名 / 主键查玩家 → 404（且不回显任何余额字段）
 *   6. 跨租户按注单 ID 查注单 → 404，归属方自查 → 200（正反对照）
 *   7. 返回值脱敏：不带 txHash / 钱包地址 / 证件号 / GGR
 *   8. 参数边界：limit 夹紧到 20、非法 type → 400
 *   9. 工具下发：销冠永远没有数据工具、无商户范围时不下发
 */
import "dotenv/config";

import {
  READONLY_TOOL_NAMES,
  buildAiTools,
  executeReadonlyTool,
  resolveAiToolScope,
  type AiToolScope,
} from "../src/lib/ai/tools";
import { prisma } from "../src/lib/prisma";

const checks: { name: string; pass: boolean; detail: string }[] = [];

function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(
    `${pass ? "✓ PASS" : "✗ FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`,
  );
}

function scopeOf(tenantId: string, role = "tenant_admin"): AiToolScope {
  return {
    tenantId,
    actor: { userId: "probe-user", role },
    delegated: role !== "tenant_admin",
  };
}

function names(definitions: ReturnType<typeof buildAiTools>) {
  return definitions.map((item) => item.function.name);
}

async function main() {
  // 优先挑「真有玩家」的两个租户，否则跨租户用例会被跳过、等于没验到。
  const tenantsWithPlayers = await prisma.tenant.findMany({
    where: { players: { some: {} } },
    take: 2,
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, currency: true },
  });

  const tenants =
    tenantsWithPlayers.length >= 2
      ? tenantsWithPlayers
      : await prisma.tenant.findMany({
          take: 5,
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, currency: true },
        });

  if (tenants.length < 2) {
    console.error(
      `✗ 至少需要 2 个租户才能验证隔离（当前 ${tenants.length} 个）。`,
    );
    return 1;
  }

  const [tenantA, tenantB] = tenants;

  console.log(
    `\n范围: A=${tenantA.name}(${tenantA.id}) / B=${tenantB.name}(${tenantB.id})\n`,
  );

  // ---------------------------------------------------------------- 1 会话范围
  const crossMerchant = await resolveAiToolScope({
    user: { id: "probe-a", role: "tenant_admin", tenantId: tenantA.id },
    requestedTenantId: tenantB.id,
  });

  check(
    "tenant_admin 请求别家 tenantId → 403",
    !crossMerchant.ok && crossMerchant.status === 403,
    crossMerchant.ok
      ? "居然放行了"
      : `${crossMerchant.status} ${crossMerchant.message}`,
  );

  const ownScope = await resolveAiToolScope({
    user: { id: "probe-a", role: "tenant_admin", tenantId: tenantA.id },
    requestedTenantId: null,
  });

  check(
    "tenant_admin 不传 tenantId → 范围取自会话",
    ownScope.ok &&
      ownScope.scope?.tenantId === tenantA.id &&
      ownScope.scope?.delegated === false,
    ownScope.ok ? `scope=${ownScope.scope?.tenantId}` : ownScope.message,
  );

  const unbound = await resolveAiToolScope({
    user: { id: "probe-x", role: "tenant_admin", tenantId: null },
    requestedTenantId: null,
  });

  check(
    "tenant_admin 未绑定商户 → 403",
    !unbound.ok && unbound.status === 403,
    unbound.ok ? "居然放行了" : `${unbound.status} ${unbound.message}`,
  );

  const platformNoPick = await resolveAiToolScope({
    user: { id: "probe-root", role: "super_admin", tenantId: null },
    requestedTenantId: null,
  });

  check(
    "super_admin 未选商户 → scope = null（不下发数据工具）",
    platformNoPick.ok && platformNoPick.scope === null,
    platformNoPick.ok ? "scope=null" : platformNoPick.message,
  );

  const platformPick = await resolveAiToolScope({
    user: { id: "probe-root", role: "super_admin", tenantId: null },
    requestedTenantId: tenantB.id,
  });

  check(
    "super_admin 显式选商户 → 委托范围（delegated）",
    platformPick.ok &&
      platformPick.scope?.tenantId === tenantB.id &&
      platformPick.scope?.delegated === true,
    platformPick.ok
      ? `scope=${platformPick.scope?.tenantId}`
      : platformPick.message,
  );

  const ghostTenant = await resolveAiToolScope({
    user: { id: "probe-root", role: "super_admin", tenantId: null },
    requestedTenantId: "tenant-does-not-exist",
  });

  check(
    "super_admin 选不存在的商户 → 404",
    !ghostTenant.ok && ghostTenant.status === 404,
    ghostTenant.ok ? "居然放行了" : `${ghostTenant.status} ${ghostTenant.message}`,
  );

  // ------------------------------------------------------- 2 白名单 / 伪造参数
  const noScope = await executeReadonlyTool({
    name: "get_player_balance",
    rawArguments: JSON.stringify({ player: "whatever" }),
    scope: {
      tenantId: "",
      actor: { userId: "x", role: "super_admin" },
      delegated: false,
    },
  });

  check(
    "空租户范围执行工具 → 403",
    noScope.status === 403 && noScope.payload.ok === false,
    String(noScope.payload.error),
  );

  const notWhitelisted = await executeReadonlyTool({
    name: "update_player_balance",
    rawArguments: JSON.stringify({ player: "whatever", amount: "999999" }),
    scope: scopeOf(tenantA.id),
  });

  check(
    "白名单外的写工具名 → 403（不查库）",
    notWhitelisted.status === 403,
    String(notWhitelisted.payload.error),
  );

  const forgedTenant = await executeReadonlyTool({
    name: "get_player_balance",
    rawArguments: JSON.stringify({ player: "whatever", tenantId: tenantB.id }),
    scope: scopeOf(tenantA.id),
  });

  check(
    "参数里伪造 tenantId=别家 → 403（不查库）",
    forgedTenant.status === 403,
    String(forgedTenant.payload.error),
  );

  const forgedMerchant = await executeReadonlyTool({
    name: "list_recent_transactions",
    rawArguments: JSON.stringify({ merchantId: tenantB.id }),
    scope: scopeOf(tenantA.id),
  });

  check(
    "参数里伪造 merchantId=别家 → 403",
    forgedMerchant.status === 403,
    String(forgedMerchant.payload.error),
  );

  const sameTenantArg = await executeReadonlyTool({
    name: "list_recent_transactions",
    rawArguments: JSON.stringify({ tenantId: tenantA.id, limit: 999 }),
    scope: scopeOf(tenantA.id),
  });

  check(
    "参数里 tenantId = 自己 → 正常执行，limit 夹紧到 20",
    sameTenantArg.status === 200 &&
      (sameTenantArg.payload.count as number) <= 20,
    `count=${String(sameTenantArg.payload.count)}`,
  );

  const badType = await executeReadonlyTool({
    name: "list_recent_transactions",
    rawArguments: JSON.stringify({ type: "hack" }),
    scope: scopeOf(tenantA.id),
  });

  check("非法 type → 400", badType.status === 400, String(badType.payload.error));

  // ------------------------------------------------------------ 3 跨租户取数
  const playerA = await prisma.player.findFirst({
    where: { tenantId: tenantA.id },
    select: { id: true, username: true },
  });
  const playerB = await prisma.player.findFirst({
    where: { tenantId: tenantB.id },
    select: { id: true, username: true },
  });

  if (playerB) {
    const stealB = await executeReadonlyTool({
      name: "get_player_balance",
      rawArguments: JSON.stringify({ player: playerB.username }),
      scope: scopeOf(tenantA.id),
    });

    const leaked = JSON.stringify(stealB.payload);

    check(
      "A 会话按用户名查 B 的玩家 → 404 且不含余额字段",
      stealB.status === 404 &&
        !leaked.includes("availableBalance") &&
        !leaked.includes("currency"),
      `${stealB.status} ${String(stealB.payload.error)}`,
    );
  } else {
    console.log("  (跳过) 商户 B 没有玩家数据");
  }

  if (playerA) {
    const own = await executeReadonlyTool({
      name: "get_player_balance",
      rawArguments: JSON.stringify({ player: playerA.username }),
      scope: scopeOf(tenantA.id),
    });

    check(
      "A 会话查自己的玩家 → 200，币种取自 Tenant.currency",
      own.status === 200 && own.payload.currency === tenantA.currency,
      `${own.status} currency=${String(own.payload.currency)} available=${String(own.payload.availableBalance)}`,
    );

    const asB = await executeReadonlyTool({
      name: "get_player_balance",
      rawArguments: JSON.stringify({ player: playerA.username }),
      scope: scopeOf(tenantB.id),
    });

    check(
      "B 会话按用户名查 A 的玩家 → 404",
      asB.status === 404,
      `${asB.status} ${String(asB.payload.error)}`,
    );

    // 更狠的一种：别家连主键都知道了，也必须查不到（按 ID 查同样被租户条件挡住）。
    const asBById = await executeReadonlyTool({
      name: "get_player_balance",
      rawArguments: JSON.stringify({ player: playerA.id }),
      scope: scopeOf(tenantB.id),
    });

    check(
      "B 会话按玩家主键 ID 查 A 的玩家 → 404",
      asBById.status === 404 &&
        !JSON.stringify(asBById.payload).includes("availableBalance"),
      `${asBById.status} ${String(asBById.payload.error)}`,
    );
  } else {
    console.log("  (跳过) 商户 A 没有玩家数据");
  }

  // 注单：拿任意一条真实注单，用「非归属租户」的会话去查，必须 404；
  // 再用归属租户自查，必须是 200（正反两个方向都验，避免 404 是因为别的原因）。
  const bet = await prisma.betRecord.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, tenantId: true },
  });

  if (bet) {
    const outsiderTenantId =
      bet.tenantId === tenantA.id ? tenantB.id : tenantA.id;

    const crossTicket = await executeReadonlyTool({
      name: "get_ticket_status",
      rawArguments: JSON.stringify({ ticket: bet.id }),
      scope: scopeOf(outsiderTenantId),
    });

    check(
      "非归属商户按注单 ID 查别家注单 → 404",
      crossTicket.status === 404,
      `${crossTicket.status} ${String(crossTicket.payload.error)}`,
    );

    const ownTicket = await executeReadonlyTool({
      name: "get_ticket_status",
      rawArguments: JSON.stringify({ ticket: bet.id }),
      scope: scopeOf(bet.tenantId),
    });

    check(
      "注单归属商户自查 → 200（证明上一条不是误判）",
      ownTicket.status === 200,
      `${ownTicket.status} ${String(ownTicket.payload.error ?? "ok")}`,
    );
  } else {
    console.log("  (跳过) 库里没有注单数据");
  }

  // ---------------------------------------------------------------- 4 脱敏
  const tx = await executeReadonlyTool({
    name: "list_recent_transactions",
    rawArguments: JSON.stringify({ limit: 5 }),
    scope: scopeOf(tenantA.id),
  });
  const txJson = JSON.stringify(tx.payload);

  check(
    "流水返回体不含 txHash / 钱包地址 / 证件号 / GGR",
    tx.status === 200 && !/txhash|wallet|address|idnumber|ggr/i.test(txJson),
    `status=${tx.status} 顶层字段=${Object.keys(tx.payload).join(",")}`,
  );

  // ------------------------------------------------------- 5 工具下发（RAG 侧）
  const readonlyNames = READONLY_TOOL_NAMES as readonly string[];
  const salesTools = names(buildAiTools("sales", { hasTenantScope: true }));
  const supportTools = names(buildAiTools("support", { hasTenantScope: true }));
  const noScopeTools = names(buildAiTools("support", { hasTenantScope: false }));

  check(
    "销冠 AI 永远拿不到数据工具",
    !salesTools.some((name) => readonlyNames.includes(name)),
    `sales=[${salesTools.join(", ")}]`,
  );

  check(
    "support 有商户范围时下发 3 个只读工具",
    READONLY_TOOL_NAMES.every((name) => supportTools.includes(name)),
    `support=[${supportTools.join(", ")}]`,
  );

  check(
    "没有商户范围时不下发数据工具",
    !noScopeTools.some((name) => readonlyNames.includes(name)),
    `support(no scope)=[${noScopeTools.join(", ")}]`,
  );

  // ------------------------------------------------------------------ 汇总
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
