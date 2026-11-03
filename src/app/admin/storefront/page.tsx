import { connection } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  normalizeStorefrontLayout,
  parseThemeSetting,
} from "@/lib/storefront";
import { loadStorefront } from "@/lib/storefront-data";

import { StorefrontClient } from "./storefront-client";
import type { StorefrontProviderRow, StorefrontTenantRow } from "./types";

export const metadata = {
  title: "Storefront Settings | DBAIRS Super Admin",
  description:
    "Visual storefront editor: brand colour, lobby module visibility and module order, saved per tenant — plus the provider showcase grid order.",
};

export const instant = false;

/**
 * 后台【前台装修】。
 *
 * - 列出全部租户的当前装修（主色 + 模块开关/顺序），默认选中「前台正在生效」的那个租户
 *   （与大厅 / 的解析规则完全一致，见 lib/storefront-data.ts），所以改完刷新 `/` 立即生效；
 * - 想装修别的站点时，用左侧租户标签切换，或带 `?tenant=<租户 id / 子域名>` 打开本页；
 * - 页面底部的【游戏商商标网格】是全局配置（GameProvider.sortOrder / showInShowcase），
 *   一次保存对所有租户的前台品牌墙生效。
 */
export default async function AdminStorefrontPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  await connection();

  const params = await searchParams;
  const rawTenant = Array.isArray(params.tenant) ? params.tenant[0] : params.tenant;
  const requestedTenant =
    typeof rawTenant === "string" && rawTenant.trim()
      ? rawTenant.trim().toLowerCase()
      : null;

  const [tenantRows, effective, providerRows] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        domain: true,
        subdomain: true,
        status: true,
        themeColor: true,
        layoutConfig: true,
      },
    }),
    loadStorefront(null),
    prisma.gameProvider.findMany({
      // 与前台品牌墙同一套排序规则：sortOrder 降序 → 名称升序
      orderBy: [{ sortOrder: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        showInShowcase: true,
        isActive: true,
        _count: { select: { games: true } },
      },
    }),
  ]);

  const tenants: StorefrontTenantRow[] = tenantRows.map((row) => {
    // themeColor 现在是 {"hex":...,"brightness":...} 的 JSON 字符串，老数据是裸 hex
    const theme = parseThemeSetting(row.themeColor);
    const layout = normalizeStorefrontLayout(row.layoutConfig);

    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      subdomain: row.subdomain,
      status: row.status,
      themeColor: theme.hex,
      themeBrightness: theme.brightness,
      preset: layout.preset,
      themeBackground: layout.themeBackground,
      modules: layout.modules,
      showTopbarChat: layout.showTopbarChat,
      showSidebarCasinoAnim: layout.showSidebarCasinoAnim,
      languageStyle: layout.languageStyle,
    };
  });

  const providers: StorefrontProviderRow[] = providerRows.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    showInShowcase: row.showInShowcase,
    isActive: row.isActive,
    gameCount: row._count.games,
  }));

  const requestedMatch = requestedTenant
    ? tenants.find(
        (tenant) =>
          tenant.id === requestedTenant ||
          tenant.subdomain.toLowerCase() === requestedTenant ||
          tenant.domain.toLowerCase() === requestedTenant,
      )
    : undefined;

  const initialTenantId =
    requestedMatch?.id ??
    tenants.find((tenant) => tenant.id === effective.tenantId)?.id ??
    tenants[0]?.id ??
    null;

  return (
    <StorefrontClient
      initialTenants={tenants}
      initialTenantId={initialTenantId}
      initialProviders={providers}
    />
  );
}
