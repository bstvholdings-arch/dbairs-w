import type { NextRequest } from "next/server";

import { isLeadStatus } from "@/lib/ai/constants";
import { jsonError, jsonNoStore } from "@/lib/ai/http";
import { loadWarRoomSnapshot } from "@/lib/ai/records";
import { guardPermission } from "@/lib/session";

/**
 * GET /api/ai/leads —— 战败分析看板数据（线索列表 + 状态计数 + 战败原因统计）。
 *
 * 查询参数：
 * - status=pending|failed|open（默认 open = 未成交，open 不是数据库值）
 * - q=品牌名 / 联系方式关键字（前端过滤也可以，这里提供一份避免拉全量）
 *
 * 仅 aiConsole 权限可见（默认 super_admin）。联系方式属于敏感数据，
 * 因此页面与接口都不对 finance / tech / support 开放。
 */
export async function GET(request: NextRequest) {
  const gate = await guardPermission(request, "aiConsole");

  if (gate.response) {
    return gate.response;
  }

  const params = request.nextUrl.searchParams;
  const statusParam = (params.get("status") ?? "open").trim();
  const query = (params.get("q") ?? "").trim().toLowerCase();

  if (
    statusParam !== "open" &&
    statusParam !== "all" &&
    !isLeadStatus(statusParam)
  ) {
    return jsonError("status 只能是 pending、failed、success、open 或 all", 400);
  }

  try {
    const leadFilter =
      statusParam === "open" || statusParam === "all"
        ? statusParam
        : isLeadStatus(statusParam)
          ? statusParam
          : "open";

    const snapshot = await loadWarRoomSnapshot(leadFilter);
    let leads = snapshot.leads;

    if (query) {
      leads = leads.filter(
        (lead) =>
          lead.brandName.toLowerCase().includes(query) ||
          lead.tgOrEmail.toLowerCase().includes(query) ||
          (lead.failReason ?? "").toLowerCase().includes(query),
      );
    }

    return jsonNoStore({
      leads,
      statusCounts: snapshot.statusCounts,
      reasonCounts: snapshot.reasonCounts,
    });
  } catch (error) {
    console.error("读取战败分析数据失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
