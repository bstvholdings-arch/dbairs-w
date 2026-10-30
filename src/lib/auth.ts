import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dbairs-secret";
const TOKEN_EXPIRES_IN = "1d" as const;

export type AuthTokenPayload = {
  userId: string;
  role: string;
  tenantId: string | null;
};

/**
 * 签发 JWT，有效期 1 天。
 */
export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

/**
 * 校验并解析 JWT，校验失败（过期、签名错误、格式错误等）返回 null。
 */
export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // 正常情况下 payload 是对象；字符串 payload 不符合本项目约定
    if (typeof decoded === "string") {
      return null;
    }

    const { userId, role, tenantId } = decoded;

    if (typeof userId !== "string" || typeof role !== "string") {
      return null;
    }

    return {
      userId,
      role,
      tenantId: typeof tenantId === "string" ? tenantId : null,
    };
  } catch {
    return null;
  }
}
