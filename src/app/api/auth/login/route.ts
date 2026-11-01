import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { signToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TENANT_ROLE } from "@/lib/rbac";

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

  const { username, password, portal } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
    /** "tenant" = 独立商户登录页 /tenant/login，只允许 tenant_admin 登录。 */
    portal?: unknown;
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
    // 支持「账号」或「邮箱」登录：老板把临时密码发给商户时通常只给邮箱。
    const candidates = await prisma.adminUser.findMany({
      where: {
        OR: [
          { username: normalizedUsername },
          {
            email: {
              equals: normalizedUsername.toLowerCase(),
              mode: "insensitive",
            },
          },
        ],
      },
      take: 4,
    });

    if (candidates.length === 0) {
      console.warn(
        `[login] AdminUser 未命中: identifier=${JSON.stringify(normalizedUsername)}`,
      );
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    // 绝不「取第一行就放行」：逐个比对密码哈希，匹配上才算登录成功。
    let user: (typeof candidates)[number] | null = null;

    for (const candidate of candidates) {
      if (await bcrypt.compare(password, candidate.passwordHash)) {
        user = candidate;
        break;
      }
    }

    if (!user) {
      console.warn(
        `[login] 密码不匹配: identifier=${JSON.stringify(normalizedUsername)} 候选数=${candidates.length}`,
      );
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    console.log(
      `[login] 命中账号 id=${user.id} role=${user.role} | bcrypt.compare=${true} | hash 前缀=${user.passwordHash.slice(0, 7)} 长度=${user.passwordHash.length}`,
    );

    // 独立商户登录页（/tenant/login）会带上 portal=tenant：
    // 平台员工从商户入口登录会立刻被 proxy 踢回 /admin，因此在这里就拒绝并提示。
    if (portal === "tenant" && user.role !== TENANT_ROLE) {
      console.warn(
        `[login] 商户入口拒绝了非商户账号: ${user.username} (${user.role})`,
      );
      return NextResponse.json(
        { error: "该入口仅限商户管理员账号登录，请前往平台登录页 /login" },
        { status: 403 },
      );
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
