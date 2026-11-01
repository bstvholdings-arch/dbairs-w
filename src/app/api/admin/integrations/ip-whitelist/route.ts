import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  IP_WHITELIST_BATCH_LIMIT,
  parseIpWhitelistInput,
  type IntegrationIpRow,
} from "@/lib/integrations";
import { getSuperAdminFromRequest } from "@/lib/super-admin";

const NOTE_MAX_LENGTH = 120;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function listWhitelist(): Promise<IntegrationIpRow[]> {
  const rows = await prisma.integrationIpWhitelist.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, ip: true, note: true, createdAt: true },
  });

  return rows.map((row) => ({
    id: row.id,
    ip: row.ip,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * 批量添加全局 IP 白名单（区域 B）。
 * POST /api/admin/integrations/ip-whitelist
 *
 * body: {
 *   ips: string | string[],   // 支持整段粘贴：换行 / 逗号 / 分号 / 空格分隔
 *   note?: string             // 备注，整批共用，例如「XX 支付商出口 IP」
 * }
 *
 * 返回 { added, duplicated, invalid, ipWhitelist }：
 * 重复项走 skipDuplicates 静默忽略，非法条目不会让整批失败（只回报 invalid），
 * 这样超管粘一大段 Excel 时不用先自己清洗数据。
 */
export async function POST(request: NextRequest) {
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
  const { valid, invalid } = parseIpWhitelistInput(input.ips);

  if (valid.length === 0) {
    return jsonError("没有可添加的合法 IP 或 CIDR 段", 400);
  }

  if (valid.length > IP_WHITELIST_BATCH_LIMIT) {
    return jsonError(
      `单次最多添加 ${IP_WHITELIST_BATCH_LIMIT} 条，请分批提交`,
      400,
    );
  }

  const note =
    typeof input.note === "string"
      ? input.note.trim().slice(0, NOTE_MAX_LENGTH) || null
      : null;

  try {
    // 先查已存在的 ip：createMany 的 skipDuplicates 只告诉「插了几条」，
    // 前端需要明确区分「新增」与「已存在」两种反馈。
    const existing = await prisma.integrationIpWhitelist.findMany({
      where: { ip: { in: valid } },
      select: { ip: true },
    });
    const existingIps = new Set(existing.map((row) => row.ip));
    const toCreate = valid.filter((ip) => !existingIps.has(ip));

    if (toCreate.length > 0) {
      await prisma.integrationIpWhitelist.createMany({
        data: toCreate.map((ip) => ({
          ip,
          note,
          createdBy: admin.id,
        })),
        skipDuplicates: true,
      });
    }

    return Response.json(
      {
        success: true,
        added: toCreate.length,
        duplicated: valid.length - toCreate.length,
        invalid,
        ipWhitelist: await listWhitelist(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("添加 IP 白名单失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}

/** 白名单列表（页面刷新时与 GET /api/admin/integrations 二选一，这里留作独立调用）。 */
export async function GET(request: NextRequest) {
  const admin = await getSuperAdminFromRequest(request);

  if (!admin) {
    return jsonError("未登录或登录已过期，请重新登录", 401);
  }

  try {
    return Response.json(
      { ipWhitelist: await listWhitelist() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取 IP 白名单失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
