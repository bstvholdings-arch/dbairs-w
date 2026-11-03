/**
 * 多域名池与防封自动切换的**纯函数**工具（服务端 / 浏览器都能引用）。
 *
 * 三件事只有一个事实来源，任何一处都不要再各写一份：
 *   1. 域名的归一化与合法性（`normalizeDomain` / `DOMAIN_PATTERN`）；
 *   2. 后台输入框（逗号 / 空格 / 换行 / 数组）→ 干净的 `string[]`；
 *   3. 故障时「该跳哪个域名」的候选顺序（`buildFailoverTargets`）。
 *
 * ⚠️ 本文件**不允许** import prisma 或任何服务端专属模块：
 *    超管弹窗与商户设置页要在浏览器里直接用它做即时校验。
 *    跨租户唯一性校验放在 tenant-domain-service.ts（那是服务端的事）。
 */

/** 一个站点最多挂几个备用域名（够 2-5 条线路，再多既难维护也没意义） */
export const MAX_BACKUP_DOMAINS = 5;

/** 完整域名：winvora.cc / win-vora.example.com */
export const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** 子域名前缀：winvora */
export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** 后台输入框允许用逗号（中英文）、分号、竖线、空白分隔 */
const DOMAIN_SEPARATOR = /[\s,，;；、|]+/;

/** 粘贴完整 URL / 带端口 / 带末尾点 → 统一成可入库的小写 host */
export function normalizeDomain(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

export function normalizeSubdomain(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\.$/, "")
    : "";
}

/**
 * 请求头 `host` / 已入库域名 → 用于比对的主机名：
 * 去端口、去 `www.`、小写。逗号分隔的多级代理头只取第一段。
 */
export function normalizeHost(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

/** 后台输入（数组或一串文本）→ 归一化后的候选列表（不去重、不校验数量） */
export function splitBackupDomainInput(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeDomain(item))
      .filter((item) => item.length > 0);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(DOMAIN_SEPARATOR)
    .map((item) => normalizeDomain(item))
    .filter((item) => item.length > 0);
}

export type BackupDomainParseResult =
  | { ok: true; domains: string[] }
  | { ok: false; error: string };

/**
 * 后台提交的备用域名 → 可入库的数组。
 *
 * - 空值（""、[]、null）= 明确清空，返回 `[]`，不是错误；
 * - 顺序保留、自动去重（同一线路只留一条）；
 * - 超过 MAX_BACKUP_DOMAINS、或有一条格式不对，整批拒绝并返回中文原因；
 * - `reserved` 用于挡掉「把自己的主域名 / 子域名填进备用池」
 *   （主域名已经是入口，重复填只会让候选列表绕回自己）。
 */
export function readBackupDomainsInput(
  value: unknown,
  options?: { reserved?: readonly string[] },
): BackupDomainParseResult {
  const raw = splitBackupDomainInput(value);
  const reserved = new Set(
    (options?.reserved ?? []).map((item) => normalizeDomain(item)),
  );

  const domains: string[] = [];

  for (const domain of raw) {
    if (reserved.has(domain) || domains.includes(domain)) {
      continue;
    }

    if (!DOMAIN_PATTERN.test(domain)) {
      return {
        ok: false,
        error: `「${domain}」不是合法域名，请填写类似 example.com 的完整域名（不要带路径）`,
      };
    }

    domains.push(domain);
  }

  if (domains.length > MAX_BACKUP_DOMAINS) {
    return {
      ok: false,
      error: `备用域名最多 ${MAX_BACKUP_DOMAINS} 个，当前填了 ${domains.length} 个`,
    };
  }

  return { ok: true, domains };
}

/** 数组 → 输入框里的一行一个（超管弹窗与商户设置页共用同一份展示口径） */
export function formatBackupDomains(domains: readonly string[]): string {
  return domains.join("\n");
}

/**
 * 主线路失联时按顺序尝试的域名列表（不含当前所在域名）。
 *
 * - 当前在主域名 / 平台子域名上 → 依次试备用域名；
 * - 当前已经落在某个备用域名上 → **先试别的备用域名，最后才回主域名**
 *   （主域名刚才是因为打不开才跳过来的，立刻跳回去只会来回抖）；
 * - 当前域名不在池子里（例如平台分配的子域名）→ 备用域名优先，主域名兜底。
 */
export function buildFailoverTargets(input: {
  currentHost: string;
  domain: string;
  backupDomains: readonly string[];
}): string[] {
  const currentHost = normalizeHost(input.currentHost);
  const primary = normalizeDomain(input.domain);
  const backups = input.backupDomains
    .map((item) => normalizeDomain(item))
    .filter((item) => item.length > 0);

  const onBackup = backups.includes(currentHost);
  const ordered = onBackup
    ? [...backups.filter((item) => item !== currentHost), primary]
    : [...backups, primary];

  const targets: string[] = [];

  for (const host of ordered) {
    if (!host || host === currentHost || targets.includes(host)) {
      continue;
    }

    targets.push(host);
  }

  return targets;
}
