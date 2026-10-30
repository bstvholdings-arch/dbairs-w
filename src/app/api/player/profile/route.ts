import { NextResponse, type NextRequest } from "next/server";

import { getPlayerProfileData } from "@/lib/player-profile";
import { getPlayerSessionFromRequest } from "@/lib/player-session";

/** 玩家中心数据（Server Component 已直接查库，此接口用于前端二次刷新 / 外部调用）。 */
export async function GET(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return NextResponse.json(
      { error: "未登录或登录已过期", code: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const data = await getPlayerProfileData(session);

    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("读取玩家中心失败:", error);
    return NextResponse.json(
      { error: "服务器内部错误，请稍后重试", code: "invalid_request" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
