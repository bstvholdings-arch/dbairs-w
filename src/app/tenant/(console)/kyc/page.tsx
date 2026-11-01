import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  getTenantScopeFromCookies,
  loadTenantKycPage,
} from "@/lib/tenant-console";

import { TenantKycView } from "./tenant-kyc-client";

export const metadata = {
  title: "KYC Review | DBAIRS Tenant Console",
  description:
    "Review identity verification requests submitted by this tenant's players.",
};

export const instant = false;

/**
 * 商户实名认证审核。
 *
 * q / status / page 只影响筛选条件；tenantId 固定取会话，
 * 所以改 URL 参数也无法看到别的商户的实名资料。
 */
export default async function TenantKycPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/kyc");
  }

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const status = typeof params.status === "string" ? params.status : "";
  const page = typeof params.page === "string" ? params.page : "1";

  const data = await loadTenantKycPage({
    tenantId: scope.tenantId,
    q,
    status,
    page,
  });

  return (
    <TenantKycView
      tenantName={scope.tenant.name}
      data={data}
      query={{ q, status }}
    />
  );
}
