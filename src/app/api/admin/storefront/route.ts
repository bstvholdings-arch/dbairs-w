import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSuperAdminFromRequest } from "@/lib/super-admin";
import {
  normalizeLayoutConfig,
  normalizeStorefrontLayout,
  parseThemeSetting,
  readThemeSettingInput,
  serializeLayoutConfig,
  serializeThemeSetting,
} from "@/lib/storefront";

/**
 * 前台装修（Storefront Settings）。
 *
 * GET  /api/admin/storefront  列出全部租户的当前装修（超管可视化页面 + 排障用）
 * PUT  /api/admin/storefront  保存单个租户的 themeColor / layoutConfig
 *
 * 只有超级管理员能读写：装修影响的是玩家看到的整站外观，
 * 租户管理员暂时不开放自助改色。
 */

const storefrontSelect = {
  id: true,
  name: true,
  domain: true,
  subdomain: true,
  status: true,
  themeColor: true,
  layoutConfig: true,
} as const;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeTenant(row: {
  id: string;
  name: string;
  domain: string;
  subdomain: string;
  status: string;
  themeColor: string;
  layoutConfig: unknown;
}) {
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
    gameCardStyle: layout.gameCardStyle,
    modules: layout.modules,
    showTopbarChat: layout.showTopbarChat,
    showSidebarCasinoAnim: layout.showSidebarCasinoAnim,
    languageStyle: layout.languageStyle,
  };
}

/**
 * 把「themeColor + 可选的同级 brightness」整合成一个入参，交给 readThemeSettingInput 校验。
 *
 * 兼容三种写法（后台新版、老接口调用方、手工 curl 都会遇到）：
 *   1. themeColor: "#d4af37"        + brightness: 60
 *   2. themeColor: { hex, brightness }
 *   3. themeColor: '{"hex":"#d4af37","brightness":50}'
 */
function toThemeInput(themeColor: unknown, brightness: unknown): unknown {
  if (typeof themeColor === "string" && themeColor.trim().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(themeColor);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;

        return { ...record, brightness: record.brightness ?? brightness };
      }
    } catch {
      // 解析失败就原样返回，由校验层回 400
    }

    return themeColor;
  }

  if (themeColor && typeof themeColor === "object" && !Array.isArray(themeColor)) {
    const record = themeColor as Record<string, unknown>;

    return { ...record, brightness: record.brightness ?? brightness };
  }

  return { hex: themeColor, brightness };
}

/** GET /api/admin/storefront —— 读取全部租户的装修配置 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      select: storefrontSelect,
    });

    return Response.json(
      { tenants: tenants.map(serializeTenant) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("读取前台装修配置失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/** PUT /api/admin/storefront —— 保存某个租户的 themeColor + layoutConfig */
export async function PUT(request: NextRequest) {
  try {
    const admin = await getSuperAdminFromRequest(request);

    if (!admin) {
      return jsonError("未登录或登录已过期，请重新登录", 401);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const tenantId = typeof input.tenantId === "string" ? input.tenantId.trim() : "";

    if (!tenantId) {
      return jsonError("缺少 tenantId，无法确定要保存哪个租户", 400);
    }

    const themeSetting = readThemeSettingInput(
      toThemeInput(input.themeColor, input.brightness ?? input.themeBrightness),
    );

    if (!themeSetting) {
      return jsonError(
        "主色必须是 #d4af37 或 #fff 这样的十六进制颜色，深浅调节必须是 0-100 的数字",
        400,
      );
    }

    const exists = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, layoutConfig: true },
    });

    if (!exists) {
      return jsonError("租户不存在", 404);
    }

    // layoutConfig 允许传完整对象、只传 { modules }，或直接传数组。
    // 未传的互动组件开关保留数据库里的原值，避免老调用方把新开关重置成默认值。
    const currentLayout = normalizeStorefrontLayout(exists.layoutConfig);
    const layoutPatch: Record<string, unknown> = isRecord(input.layoutConfig)
      ? { ...input.layoutConfig }
      : {};

    // 同时兼容把新字段放在请求体顶层的写法，方便手工 curl / 旧版后台。
    for (const key of [
      "preset",
      "showTopbarChat",
      "showSidebarCasinoAnim",
      "languageStyle",
    ] as const) {
      if (input[key] !== undefined) {
        layoutPatch[key] = input[key];
      }
    }

    // 游戏封面风格（gameCardStyle）的写入入口已收回平台：
    // 只能由超管在【租户管理 → 新增 / 编辑】（POST / PUT /api/tenants）时配置，
    // 装修页即使被构造请求带上这个字段也必须忽略，保证写入入口唯一。
    delete layoutPatch.gameCardStyle;

    const modules = normalizeLayoutConfig(
      Array.isArray(input.layoutConfig)
        ? input.layoutConfig
        : input.modules ?? layoutPatch.modules ?? currentLayout.modules,
    );
    const layout = normalizeStorefrontLayout({
      ...currentLayout,
      ...layoutPatch,
      modules,
    });

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        // 统一存 {"hex":"#d4af37","brightness":50}，读取侧 parseThemeSetting 兼容裸 hex
        themeColor: serializeThemeSetting(themeSetting),
        layoutConfig: serializeLayoutConfig(layout),
      },
      select: storefrontSelect,
    });

    // 前台是按请求实时读库的，这里再显式失效一次缓存：
    // 万一以后给 `/` 套上 revalidate / 静态缓存，保存后也能立刻看到效果。
    revalidatePath("/");
    revalidatePath("/provider/[code]", "page");

    return Response.json({
      success: true,
      tenant: serializeTenant(tenant),
    });
  } catch (error) {
    console.error("保存前台装修配置失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
