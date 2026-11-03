import { prisma } from "@/lib/prisma";
import { normalizeDomain, normalizeHost } from "@/lib/tenant-domains";

/**
 * 备用域名的**跨租户唯一性**校验（服务端专用）。
 *
 * 为什么必须有：备用域名也参与租户解析（跳过去就是那个站），一旦两个租户
 * 的池子里出现同一个域名，解析顺序一变就会把玩家送进别家的站。
 * 所以写入前统一在这里查一遍：
 *   - 已作为别家「主域名」→ 拒绝；
 *   - 已作为别家「备用域名」→ 拒绝；
 *   - 首段命中别家「子域名前缀」→ 拒绝（winvora.平台域 与 subdomain=winvora 是同一台站）。
 *
 * 租户表规模很小（几十行），一次性全量比对即可，不必为此加 GIN 索引。
 */

export type BackupDomainConflictReason = "domain" | "subdomain" | "backup";

export type BackupDomainConflict = {
  domain: string;
  reason: BackupDomainConflictReason;
  /** 已经占用该域名的租户，用于把话说清楚（不含敏感信息） */
  tenantName: string;
};

function describe(reason: BackupDomainConflictReason, domain: string, tenantName: string) {
  switch (reason) {
    case "domain":
      return `「${domain}」已经是商户「${tenantName}」的绑定域名`;
    case "subdomain":
      return `「${domain}」与商户「${tenantName}」的子域名前缀冲突`;
    default:
      return `「${domain}」已在商户「${tenantName}」的备用域名里`;
  }
}

/** 命中第一个冲突就返回；全部可用返回 null。`tenantId` 传自己是「改自己的站」。 */
export async function findBackupDomainConflict(
  domains: readonly string[],
  tenantId?: string | null,
): Promise<BackupDomainConflict | null> {
  if (domains.length === 0) {
    return null;
  }

  const others = await prisma.tenant.findMany({
    where: tenantId ? { id: { not: tenantId } } : {},
    select: { name: true, domain: true, subdomain: true, backupDomains: true },
  });

  for (const candidate of domains) {
    const domain = normalizeDomain(candidate);

    if (!domain) {
      continue;
    }

    for (const tenant of others) {
      if (normalizeHost(tenant.domain) === domain) {
        return { domain, reason: "domain", tenantName: tenant.name };
      }

      if (tenant.backupDomains.some((item) => normalizeDomain(item) === domain)) {
        return { domain, reason: "backup", tenantName: tenant.name };
      }

      // 子域名前缀：winvora / winvora.平台域 都视为同一台站
      const firstLabel = domain.split(".")[0];

      if (firstLabel && firstLabel === tenant.subdomain.toLowerCase()) {
        return { domain, reason: "subdomain", tenantName: tenant.name };
      }
    }
  }

  return null;
}

/** 冲突 → 直接可回给前端的中文错误文案 */
export function formatBackupDomainConflict(conflict: BackupDomainConflict): string {
  return `${describe(conflict.reason, conflict.domain, conflict.tenantName)}，请换一个域名`;
}
