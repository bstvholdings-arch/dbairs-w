import { connection } from "next/server";

import { gatewaySelect, serializeGateway } from "@/lib/payment-gateway";
import { prisma } from "@/lib/prisma";

import type { GatewayRow, GatewayTenantOption } from "../gateways/types";
import { PaymentsAdminClient } from "./payments-client";

export const metadata = {
  title: "Payment Gateways | DBAIRS Super Admin",
  description:
    "Manage platform payment channels, pay-in / payout / settlement costs and sell rates, and review tenant-provided gateways.",
};

export const instant = false;

export default async function AdminPaymentsPage() {
  await connection();

  const [gateways, tenants] = await Promise.all([
    prisma.paymentGateway.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: gatewaySelect,
    }),
    prisma.tenant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: GatewayRow[] = gateways.map(serializeGateway);
  const tenantOptions: GatewayTenantOption[] = tenants;

  return (
    <PaymentsAdminClient
      initialGateways={rows}
      tenants={tenantOptions}
    />
  );
}
