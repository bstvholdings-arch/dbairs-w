import { NextResponse, type NextRequest } from "next/server";

import { getPlayerSessionFromRequest } from "@/lib/player-session";

/** 返回当前玩家（大厅顶栏 / 玩家中心刷新余额用），未登录返回 401。 */
export async function GET(request: NextRequest) {
  const player = await getPlayerSessionFromRequest(request);

  if (!player) {
    return NextResponse.json(
      { error: "未登录或登录已过期", code: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { player },
    { headers: { "Cache-Control": "no-store" } },
  );
}
