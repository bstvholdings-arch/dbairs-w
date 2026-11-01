import { connection } from "next/server";

import { loadIntegrationSnapshot } from "@/lib/integrations-data";

import { IntegrationsClient } from "./integrations-client";

export const metadata = {
  title: "API & Integrations | DBAIRS Super Admin",
  description:
    "Platform webhook endpoints, global IP allowlist, provider key status and per-merchant API credentials.",
};

// 与 /admin/tenants 一致：密钥掩码与白名单都是实时数据，必须每次请求现算。
export const instant = false;

export default async function AdminIntegrationsPage() {
  // cacheComponents 下用 connection() 显式声明「请求时渲染」：
  // 只读一次数据库快照，交给客户端组件做后续的局部刷新。
  await connection();

  const snapshot = await loadIntegrationSnapshot();

  return <IntegrationsClient initialSnapshot={snapshot} />;
}
