import { notFound } from "next/navigation";
import { connection } from "next/server";

import { prisma } from "@/lib/prisma";
import { listTenantProviderPoints } from "@/lib/tenant-provider-points";

import { TenantDetailView } from "./tenant-detail-view";

export const metadata = {
  title: "Tenant Point Configuration | DBAIRS Super Admin",
  description:
    "Set provider-specific points for a tenant. Unset points fall back to the global default.",
};

export const instant = false;

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;

  const [tenant, rows] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        domain: true,
        subdomain: true,
        status: true,
        withdrawalRequiredApprovals: true,
        createdAt: true,
      },
    }),
    listTenantProviderPoints(id),
  ]);

  if (!tenant) {
    notFound();
  }

  return (
    <TenantDetailView
      tenant={{
        id: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        subdomain: tenant.subdomain,
        status: tenant.status,
        withdrawalRequiredApprovals: tenant.withdrawalRequiredApprovals,
        createdAt: tenant.createdAt.toISOString(),
      }}
      rows={rows}
    />
  );
}
