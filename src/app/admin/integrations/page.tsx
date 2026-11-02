import { redirect } from "next/navigation";
import { connection } from "next/server";

import { loadIntegrationSnapshot } from "@/lib/integrations-data";
import { can, homePathForRole } from "@/lib/rbac";
import { getSessionUserFromCookies } from "@/lib/session";

import { IntegrationsClient } from "./integrations-client";
import { readIntegrationTab } from "./types";

export const metadata = {
  title: "API & Integrations | DBAIRS Super Admin",
  description:
    "Platform webhook endpoints, global IP allowlist, provider key status and per-merchant API credentials.",
};

// 与 /admin/tenants 一致：密钥掩码与白名单都是实时数据，必须每次请求现算。
export const instant = false;

/** 查询参数可能是 string[]（?tab=a&tab=b），统一取第一个。 */
function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function AdminIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  // cacheComponents 下用 connection() 显式声明「请求时渲染」：
  // 只读一次数据库快照，交给客户端组件做后续的局部刷新。
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user) {
    redirect("/login?next=/admin/integrations");
  }

  // 第二道防线：proxy 已按权限矩阵拦截，这里再确认一次。
  // 商户对接密钥 / 全局 IP 白名单属于最高敏感配置，只有超级管理员可见。
  if (!can(user.role, "integrations")) {
    redirect(`${homePathForRole(user.role)}?denied=integrations`);
  }

  const snapshot = await loadIntegrationSnapshot();
  // ?tab=gateways 之类的深链接直接落到对应页签；非法值统一回落到全局设置。
  const params = await searchParams;

  return (
    <IntegrationsClient
      initialSnapshot={snapshot}
      initialTab={readIntegrationTab(readParam(params.tab))}
    />
  );
}
