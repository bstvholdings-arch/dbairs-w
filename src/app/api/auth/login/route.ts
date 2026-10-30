import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { signToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const AUTH_COOKIE = "token";
/** 与 signToken 的 1d 有效期保持一致。 */
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24;
/** 生产环境不打印明文密码，避免凭据进入日志。 */
const LOG_PLAIN_PASSWORD = process.env.NODE_ENV !== "production";

function maskSecret(value: string) {
  if (value.length <= 2) {
    return "*".repeat(value.length);
  }

  return `${value[0]}***${value[value.length - 1]}（长度 ${value.length}）`;
}

/** 调试日志：让终端能立刻看到前端到底发了什么字段、什么值。 */
function logIncomingBody(body: unknown) {
  const record = (body ?? {}) as Record<string, unknown>;
  const password = record.password;

  console.log(
    "[login] 收到请求 body:",
    JSON.stringify(
      LOG_PLAIN_PASSWORD
        ? record
        : {
            ...record,
            password:
              typeof password === "string" ? maskSecret(password) : password,
          },
    ),
    "| 字段:",
    Object.keys(record),
  );
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    console.error("[login] 请求体解析失败（不是合法 JSON）:", error);
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  logIncomingBody(body);

  const { username, password } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
  };

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.trim().length === 0 ||
    password.length === 0
  ) {
    console.warn(
      "[login] 字段校验失败: username 类型 =",
      typeof username,
      "| password 类型 =",
      typeof password,
    );
    return NextResponse.json({ error: "账号和密码不能为空" }, { status: 400 });
  }

  const normalizedUsername = username.trim();

  if (normalizedUsername !== username) {
    console.warn(
      "[login] 用户名前后含空格，已自动 trim:",
      JSON.stringify(username),
      "->",
      JSON.stringify(normalizedUsername),
    );
  }

  // 密码不做 trim（空格可能是真实密码的一部分），但把可能的手误提示出来。
  if (password !== password.trim()) {
    console.warn("[login] 注意：密码首尾包含空白字符，请确认不是输入法误触");
  }

  try {
    const user = await prisma.adminUser.findUnique({
      where: { username: normalizedUsername },
    });

    if (!user) {
      console.warn(
        `[login] AdminUser 未命中: username=${JSON.stringify(normalizedUsername)}`,
      );
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    console.log(
      `[login] 命中账号 id=${user.id} role=${user.role} | bcrypt.compare=${passwordMatches} | hash 前缀=${user.passwordHash.slice(0, 7)} 长度=${user.passwordHash.length}`,
    );

    if (!passwordMatches) {
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId,
    });

    const response = NextResponse.json(
      { success: true, token, role: user.role },
      { status: 200 },
    );

    // cookie 由服务端下发：即使前端 JS 未加载 / hydration 失败，登录态也能生效，
    // 避免“登录成功却立刻被 proxy 弹回 /login”。httpOnly 让页面脚本读不到 token。
    response.cookies.set({
      name: AUTH_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE,
    });

    console.log(
      `[login] 登录成功: ${user.username} (${user.role})，已下发 ${AUTH_COOKIE} cookie`,
    );

    return response;
  } catch (error) {
    console.error("[login] 服务器内部错误:", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
