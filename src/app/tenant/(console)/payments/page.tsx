import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getTenantScopeFromCookies } from "@/lib/tenant-console";
import { loadTenantPaymentGateways } from "@/lib/tenant-payment-gateways";

import { TenantPaymentsClient } from "./tenant-payments-client";

export const metadata = {
  title: "My Payment Gateways | DBAIRS Tenant Console",
  description:
    "View platform pay-in, payout, and settlement rates, and submit tenant-owned gateways for review.",
};

export const instant = false;

export default async function TenantPaymentsPage() {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/payments");
  }

  const data = await loadTenantPaymentGateways(scope.tenantId);

  return (
    <TenantPaymentsClient
      initialData={data}
      tenantName={scope.tenant.name}
    />
  );
}
