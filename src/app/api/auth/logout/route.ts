import { NextResponse } from "next/server";

const AUTH_COOKIE = "token";

/**
 * 登录 cookie 是 httpOnly 的，前端 `document.cookie` 清不掉，
 * 因此登出必须由服务端下发一个 Max-Age=0 的同名 cookie 来覆盖。
 */
export async function POST(request: Request) {
  const response = NextResponse.json({ success: true }, { status: 200 });

  response.cookies.set({
    name: AUTH_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 0,
  });

  return response;
}
