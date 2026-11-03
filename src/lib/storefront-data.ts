import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { DEFAULT_CURRENCY, normalizeCurrency } from "@/lib/currency";
import { logDataFallback } from "@/lib/data-fallback-log";
import { DEFAULT_THEME_BACKGROUND } from "@/lib/theme-backgrounds";
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationTicket,
} from "@/lib/impersonation";
import { prisma } from "@/lib/prisma";
import { getSessionUserFromCookies } from "@/lib/session";
import {
  DEFAULT_STOREFRONT_LANGUAGE_STYLE,
  DEFAULT_STOREFRONT_MODULES,
  DEFAULT_STOREFRONT_SIDEBAR_CASINO,
  DEFAULT_STOREFRONT_TOPBAR_CHAT,
  DEFAULT_TENANT_LOGO_POSITION,
  DEFAULT_THEME_BRIGHTNESS,
  DEFAULT_THEME_COLOR,
  normalizeStorefrontLayout,
  normalizeTenantLogoPosition,
  normalizeTenantLogoUrl,
  parseThemeSetting,
  type StorefrontSettings,
} from "@/lib/storefront";
import { DEFAULT_STOREFRONT_PRESET } from "@/lib/storefront-presets";
import { normalizeHost } from "@/lib/tenant-domains";

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
  // Logo 位置（left / center）：由超管在租户弹窗里配，前台只读
  logoPosition: true,
  currency: true,
  themeColor: true,
  layoutConfig: true,
} as const;

type StorefrontTenantRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  logoPosition: string;
  currency: string;
  themeColor: string;
  layoutConfig: unknown;
};

/** 数据库不可用 / 还没有任何租户时的兜底配置 */
export const FALLBACK_STOREFRONT: StorefrontSettings = {
  tenantId: null,
  tenantName: null,
  tenantLogoUrl: null,
  logoPosition: DEFAULT_TENANT_LOGO_POSITION,
  currency: DEFAULT_CURRENCY,
  themeColor: DEFAULT_THEME_COLOR,
  themeBrightness: DEFAULT_THEME_BRIGHTNESS,
  preset: DEFAULT_STOREFRONT_PRESET,
  themeBackground: DEFAULT_THEME_BACKGROUND,
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
    logoPosition: normalizeTenantLogoPosition(row.logoPosition),
    currency: normalizeCurrency(row.currency),
    themeColor: theme.hex,
    themeBrightness: theme.brightness,
    preset: layout.preset,
    themeBackground: layout.themeBackground,
    modules: layout.modules,
    showTopbarChat: layout.showTopbarChat,
    showSidebarCasinoAnim: layout.showSidebarCasinoAnim,
    languageStyle: layout.languageStyle,
  };
}

/**
 * 按访问域名找租户。
 *
 * 顺序：完整主域名 → **备用域名池** → 子域名前缀。
 *
 * 备用域名必须在这里一起认：多域名防封自动切换会把玩家从主域名跳到
 * `Tenant.backupDomains[0]`，如果这里不认它，跳过去就等于「站点不存在」。
 * 备用域名的跨租户唯一性在写入侧由 lib/tenant-domain-service.ts 保证。
 */
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

  // 2) 备用域名命中：Tenant.backupDomains 里包含这个 host
  const byBackupDomain = await prisma.tenant.findFirst({
    where: { backupDomains: { has: host } },
    select: STOREFRONT_SELECT,
  });

  if (byBackupDomain) {
    return byBackupDomain;
  }

  // 3) 子域名命中：winvora.xxx.cc → subdomain = winvora
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
        // 备用域名同样可以作为预览 / 联调入口（换线路后老链接还能直接用）
        { backupDomains: { has: lowered } },
        { backupDomains: { has: normalizeHost(lowered) } },
      ],
    },
    select: STOREFRONT_SELECT,
  });
}

/**
 * `.env` 里显式声明的「本地默认站点」（DEFAULT_TENANT，可填 id / 子域名 / 域名）。
 *
 * 这是**唯一**允许在「没有域名、没有会话」时顶上一个租户的途径，而且它是运维
 * 显式配置的；代码里绝不允许再出现 `winvora` 之类的商户名当兜底。
 */
function readDefaultTenantKey(): string {
  const raw = process.env.DEFAULT_TENANT;

  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * 解析本次请求属于哪个租户的装修配置。
 *
 * 返回 `null` 的含义很明确：**这个站点不存在**，调用方必须 404，
 * 绝不能再「随便挑一个租户顶上」（历史 Bug：超管代登录 abc 点【预览前台】，
 * 因为跳转链接没带租户标识，最后落到了最早创建的 winvora 站点）。
 *
 * 优先级（从高到低）：
 * 1. `?tenant=` 显式参数 —— 后台【预览前台】与联调都用它，**查不到就是不存在**；
 * 2. 当前访问域名 / 子域名 —— 真正的多租户白标访问；
 * 3. 已登录的商户账号（会话里的 tenantId）；
 * 4. 超管代登录票据（dba_impersonate，绑定 adminId，2 小时过期）——
 *    代登录期间直接访问 `/` 也必须看到被代登录的那家，而不是别人家；
 * 5. `.env` 的 DEFAULT_TENANT —— 本地开发/单站点部署的显式兜底；
 * 6. 以上全部落空 → `null`（→ 站点不存在）。
 */
export const resolveStorefront = cache(
  async (tenantKey?: string | null): Promise<StorefrontSettings | null> => {
    try {
      const explicitKey =
        typeof tenantKey === "string" ? tenantKey.trim() : "";

      // 1) 显式指定：命中就用，没命中就返回 null（不允许回落）
      if (explicitKey) {
        const byKey = await findTenantByKey(explicitKey);

        return byKey ? toSettings(byKey) : null;
      }

      // 2) 访问域名 / 子域名
      const host = normalizeHost((await headers()).get("host"));
      const byHost = await findTenantByDomain(host);

      if (byHost) {
        return toSettings(byHost);
      }

      const session = await getSessionUserFromCookies();

      // 3) 商户账号本人：看到的是自家站点
      if (session?.tenantId) {
        const bySession = await prisma.tenant.findUnique({
          where: { id: session.tenantId },
          select: STOREFRONT_SELECT,
        });

        if (bySession) {
          return toSettings(bySession);
        }
      }

      // 4) 超管代登录：票据只对当前超管有效（校验签名 + adminId）
      if (session?.role === "super_admin") {
        const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
        const ticket = verifyImpersonationTicket(token, session.id);

        if (ticket) {
          const byTicket = await prisma.tenant.findUnique({
            where: { id: ticket.tenantId },
            select: STOREFRONT_SELECT,
          });

          if (byTicket) {
            return toSettings(byTicket);
          }
        }
      }

      // 5) 显式配置的本地默认站点
      const defaultKey = readDefaultTenantKey();

      if (defaultKey) {
        const byDefault = await findTenantByKey(defaultKey);

        if (byDefault) {
          return toSettings(byDefault);
        }
      }

      // 6) 站点不存在（由 requireStorefront 抛 404）
      return null;
    } catch (error) {
      // 数据库临时不可用 ≠ 站点不存在：仍然渲染默认金色主题，
      // 不能因为一次超时就把整个前台判成 404。
      logDataFallback("读取前台装修配置失败，回退到默认金色主题", error);

      return FALLBACK_STOREFRONT;
    }
  },
);

/**
 * 玩家前台（`/`、`/provider/[code]`、`/player/*`）**专用**：
 * 拿不到租户直接 404「站点不存在」，绝不显示别家的站。
 */
export async function requireStorefront(
  tenantKey?: string | null,
): Promise<StorefrontSettings> {
  const settings = await resolveStorefront(tenantKey);

  if (!settings) {
    notFound();
  }

  return settings;
}

/**
 * 后台页面（`/admin/storefront` 等）用：允许回落到「最早创建的 active 租户」，
 * 因为装修后台需要一个默认选中项。
 *
 * ⚠️ 玩家可见页面**禁止**调用本函数，一律用 `requireStorefront`，
 * 否则又会回到「预览前台看到别人家站点」的老 Bug。
 */
export const loadStorefront = cache(
  async (tenantKey?: string | null): Promise<StorefrontSettings> => {
    const resolved = await resolveStorefront(tenantKey);

    if (resolved) {
      return resolved;
    }

    try {
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
    } catch (error) {
      logDataFallback("读取后台默认装修目标失败", error);
    }

    return FALLBACK_STOREFRONT;
  },
);
