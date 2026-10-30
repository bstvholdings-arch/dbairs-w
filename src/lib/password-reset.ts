/**
 * 找回密码的共享常量与纯函数。
 *
 * 玩家与后台管理员共用同一套 Token 规则，但两者的登录 Cookie / JWT 完全隔离；
 * Token 本身是全局唯一的 UUID，重置接口按 Token 反查账号类型。
 */

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export const PASSWORD_RESET_MESSAGE = "如果邮箱存在，重置链接已发送";

/** RFC 4122 UUID；Token 由 crypto.randomUUID() 生成。 */
export const PASSWORD_RESET_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PasswordResetAccountType = "player" | "admin";

/**
 * 重置链接的站点根地址。
 *
 * 本地开发默认取当前请求的 origin（http://localhost:3000），
 * 部署时建议设置 APP_URL，避免反向代理的 Host 头影响邮件里的链接。
 */
export function getPasswordResetOrigin(request: Request): string {
  const configured =
    process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export function buildPasswordResetUrl(request: Request, token: string): string {
  const url = new URL("/reset-password", getPasswordResetOrigin(request));
  url.searchParams.set("token", token);
  return url.toString();
}

export function readPasswordResetToken(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const token = value.trim();

  return PASSWORD_RESET_TOKEN_PATTERN.test(token) ? token : "";
}
