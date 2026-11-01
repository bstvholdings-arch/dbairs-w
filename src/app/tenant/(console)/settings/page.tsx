import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  getTenantScopeFromCookies,
  loadTenantSiteSettings,
} from "@/lib/tenant-console";

import { TenantSettingsView } from "./tenant-settings-client";

export const metadata = {
  title: "Site Settings | DBAIRS Tenant Console",
  description:
    "Change the lobby skin colour and module toggles for the current tenant.",
};

export const instant = false;

/**
 * 站点设置（换皮肤）。
 *
 * 写入只能落在会话里的 tenantId 上（见 saveTenantSiteSettings），
 * 因此商户之间不可能互相覆盖装修配置。
 */
export default async function TenantSettingsPage() {
  await connection();

  const scope = await getTenantScopeFromCookies();

  if (!scope) {
    redirect("/login?next=/tenant/settings");
  }

  const settings = await loadTenantSiteSettings(scope.tenantId);

  if (!settings) {
    redirect("/login?next=/tenant/settings");
  }

  return <TenantSettingsView settings={settings} />;
}
