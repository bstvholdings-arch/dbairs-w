import { NextResponse } from "next/server";

import {
  PLAYER_AUTH_COOKIE_OPTIONS,
  PLAYER_TOKEN_COOKIE,
} from "@/lib/player-auth";

/** 玩家退出登录：只清玩家 Cookie，不影响同一浏览器里的后台登录态。 */
export async function POST() {
  const response = NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } },
  );

  response.cookies.set(PLAYER_TOKEN_COOKIE, "", {
    ...PLAYER_AUTH_COOKIE_OPTIONS,
    maxAge: 0,
  });

  return response;
}
