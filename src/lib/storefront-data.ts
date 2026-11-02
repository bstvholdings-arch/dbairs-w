import { cache } from "react";
import { headers } from "next/headers";

import { DEFAULT_CURRENCY, normalizeCurrency } from "@/lib/currency";
import { logDataFallback } from "@/lib/data-fallback-log";
import { prisma } from "@/lib/prisma";
import { getSessionUserFromCookies } from "@/lib/session";
import {
  DEFAULT_STOREFRONT_LANGUAGE_STYLE,
  DEFAULT_STOREFRONT_MODULES,
  DEFAULT_STOREFRONT_SIDEBAR_CASINO,
  DEFAULT_STOREFRONT_TOPBAR_CHAT,
  DEFAULT_THEME_BRIGHTNESS,
  DEFAULT_THEME_COLOR,
  normalizeStorefrontLayout,
  normalizeTenantLogoUrl,
  parseThemeSetting,
  type StorefrontSettings,
} from "@/lib/storefront";
import { DEFAULT_STOREFRONT_PRESET } from "@/lib/storefront-presets";

/**
 * 前台装修配置的读取层（只在服务端跑）。
 *
 * 大厅 `/` 与品牌展馆 `/provider/[code]` 共用这份逻辑：
 * 先找出「这次访问属于哪个租户」，再读它的 themeColor 与 layoutConfig。
 * 任何一步失败（数据库挂了、配置是脏 JSON）都回退到默认金色 + 全模块显示，
 * 保证玩家永远不会看到白屏或没有主色的页面。
 */

const STOREFRONT_SELECT = {
  id: true,
  name: true,
  // 白标品牌 Logo：大厅顶栏优先渲染它，没配则用商户名首字母占位
  logoUrl: true,
  currency: true,
  themeColor: true,
  layoutConfig: true,
} as const;

type StorefrontTenantRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  currency: string;
  themeColor: string;
  layoutConfig: unknown;
};

/** 数据库不可用 / 还没有任何租户时的兜底配置 */
export const FALLBACK_STOREFRONT: StorefrontSettings = {
  tenantId: null,
  tenantName: null,
  tenantLogoUrl: null,
  currency: DEFAULT_CURRENCY,
  themeColor: DEFAULT_THEME_COLOR,
  themeBrightness: DEFAULT_THEME_BRIGHTNESS,
  preset: DEFAULT_STOREFRONT_PRESET,
  modules: DEFAULT_STOREFRONT_MODULES.map((module) => ({ ...module })),
  showTopbarChat: DEFAULT_STOREFRONT_TOPBAR_CHAT,
  showSidebarCasinoAnim: DEFAULT_STOREFRONT_SIDEBAR_CASINO,
  languageStyle: DEFAULT_STOREFRONT_LANGUAGE_STYLE,
};

function toSettings(row: StorefrontTenantRow): StorefrontSettings {
  // themeColor 里存的是 {"hex":"#d4af37","brightness":50}；老数据是裸 hex，
  // parseThemeSetting 两种都认，脏数据则退化成默认金色 + 50% 深浅。
  const theme = parseThemeSetting(row.themeColor);
  const layout = normalizeStorefrontLayout(row.layoutConfig);

  return {
    tenantId: row.id,
    tenantName: row.name,
    tenantLogoUrl: normalizeTenantLogoUrl(row.logoUrl),
    currency: normalizeCurrency(row.currency),
    themeColor: theme.hex,
    themeBrightness: theme.brightness,
    preset: layout.preset,
    modules: layout.modules,
    showTopbarChat: layout.showTopbarChat,
    showSidebarCasinoAnim: layout.showSidebarCasinoAnim,
    languageStyle: layout.languageStyle,
  };
}

/** 去掉端口、去掉 www. 前缀，得到用于匹配 Tenant.domain / subdomain 的主机名 */
function normalizeHost(rawHost: string | null) {
  if (!rawHost) {
    return "";
  }

  return rawHost
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

async function findTenantByDomain(host: string) {
  if (!host) {
    return null;
  }

  // 1) 完整域名命中：winvora.cc
  const byDomain = await prisma.tenant.findFirst({
    where: { domain: host },
    select: STOREFRONT_SELECT,
  });

  if (byDomain) {
    return byDomain;
  }

  // 2) 子域名命中：winvora.xxx.cc → subdomain = winvora
  const [firstLabel] = host.split(".");

  if (!firstLabel) {
    return null;
  }

  return prisma.tenant.findFirst({
    where: { subdomain: firstLabel },
    select: STOREFRONT_SELECT,
  });
}

/** `?tenant=` 显式指定：id / 子域名 / 域名都可以，后台预览就用这个 */
async function findTenantByKey(rawKey: string) {
  const key = rawKey.trim();

  if (!key) {
    return null;
  }

  const lowered = key.toLowerCase();

  return prisma.tenant.findFirst({
    where: {
      OR: [
        { id: key },
        { subdomain: lowered },
        { domain: lowered },
        // 允许直接粘贴完整 URL，与后台表单的容错口径一致
        { domain: lowered.replace(/^https?:\/\//, "").replace(/\/.*$/, "") },
      ],
    },
    select: STOREFRONT_SELECT,
  });
}

/**
 * 解析本次请求对应的装修配置。
 *
 * 优先级（从高到低）：
 * 1. `?tenant=` 显式参数 —— 后台「预览前台」与单体站点调试用；
 * 2. 当前访问域名 / 子域名 —— 真正的多租户白标访问；
 * 3. 已登录的租户管理员 —— 在自己域名之外预览时，看到的是自家配置；
 * 4. 最早创建的 active 租户 —— 兜底，和 /admin/storefront 的默认目标一致，
 *    所以超管在后台改完、刷新 `/` 立即生效。
 */
export const loadStorefront = cache(
  async (tenantKey?: string | null): Promise<StorefrontSettings> => {
    try {
      if (tenantKey && tenantKey.trim()) {
        const byKey = await findTenantByKey(tenantKey);

        if (byKey) {
          return toSettings(byKey);
        }
      }

      const host = normalizeHost((await headers()).get("host"));
      const byHost = await findTenantByDomain(host);

      if (byHost) {
        return toSettings(byHost);
      }

      const session = await getSessionUserFromCookies();

      if (session?.tenantId) {
        const bySession = await prisma.tenant.findUnique({
          where: { id: session.tenantId },
          select: STOREFRONT_SELECT,
        });

        if (bySession) {
          return toSettings(bySession);
        }
      }

      const fallbackTenant =
        (await prisma.tenant.findFirst({
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
          select: STOREFRONT_SELECT,
        })) ??
        (await prisma.tenant.findFirst({
          orderBy: { createdAt: "asc" },
          select: STOREFRONT_SELECT,
        }));

      if (fallbackTenant) {
        return toSettings(fallbackTenant);
      }

      return FALLBACK_STOREFRONT;
    } catch (error) {
      logDataFallback("读取前台装修配置失败，回退到默认金色主题", error);

      return FALLBACK_STOREFRONT;
    }
  },
);
