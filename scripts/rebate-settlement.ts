/**
 * 每日洗码（返水）结算 —— 命令行入口。
 *
 * 用法：
 *   npx tsx scripts/rebate-settlement.ts                       # 结算「昨天」（UTC）
 *   npx tsx scripts/rebate-settlement.ts --date 2026-11-03     # 指定某一天（补发）
 *   npx tsx scripts/rebate-settlement.ts --tenant <租户 id>    # 只算这一家（排障）
 *   npx tsx scripts/rebate-settlement.ts --dry-run             # 只算不发
 *   `--date=<值>` / `--tenant=<值>` 也支持（等号形式等价）
 *
 * 注意：**不要**写 `--dry-run=true` 这类「给开关赋值」的形式，开关只认出现即生效。
 *
 * 行为：
 * - 按「商户 + 玩家 + 品类 + UTC 日界」聚合 BetRecord.betAmount，乘商户配置的费率；
 * - 品类开关 / 费率读 Tenant.rebateConfig（关闭的品类整类跳过）；
 * - 幂等：RebatePayout 的 @@unique([tenantId, playerId, category, periodStart])
 *   拦住重复结算，所以本脚本可以放心重跑；
 * - 会真发钱（加余额 + 写 Transaction type=rebate），不确定时先 --dry-run。
 *
 * 无参数时不会动任何数据以外的状态（不改配置、不改活动），只写结算单与流水。
 */
import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import {
  parseSettlementDate,
  previousUtcDayStart,
  settleDailyRebates,
} from "../src/lib/rebate-settlement";

/**
 * 读 `--name value` 或 `--name=value`。
 *
 * 两种都支持是必须的：调用方（人 / CI / npm script）习惯哪种都有，
 * 只认一种的话另一种会被**静默忽略**并退回默认值——`--date=2026-11-03`
 * 被吃掉就会变成「结算昨天的全平台」，属于事故级静默失败。
 */
function readArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length).trim();
  }

  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? (process.argv[index + 1] ?? "").trim() : "";
}

function readFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const dateArg = readArg("date");
  const tenantId = readArg("tenant");
  const dryRun = readFlag("dry-run") || readFlag("dryRun");

  const periodStart = dateArg ? parseSettlementDate(dateArg) : previousUtcDayStart();

  if (!periodStart) {
    console.error("✗ --date 必须是 YYYY-MM-DD 格式（UTC 日界）");
    return 1;
  }

  const result = await settleDailyRebates({ periodStart, tenantId, dryRun });

  console.log(`周期: ${result.periodStart} → ${result.periodEnd}（UTC）`);
  console.log(`模式: ${result.dryRun ? "试算（未写库）" : "实发"}`);

  if (result.tenants.length === 0) {
    console.log("没有商户开启洗码，或当天没有可结算流水。");
    return 0;
  }

  for (const tenant of result.tenants) {
    console.log(
      `- ${tenant.tenantName} (${tenant.tenantId}): ${tenant.payouts} 笔 / 合计 ${tenant.amount}，跳过 ${tenant.skipped} 条，品类 ${tenant.categories.join(", ")}`,
    );
  }

  console.log(
    `总计: ${result.totals.payouts} 笔 / 合计 ${result.totals.amount}，跳过 ${result.totals.skipped} 条`,
  );

  return 0;
}

main()
  .then(async (code) => {
    process.exitCode = code;
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("✗ 脚本执行失败:", error);
    process.exitCode = 1;
    await prisma.$disconnect();
  });
