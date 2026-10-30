import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const PLAYER_ROLE = "player";
export const PLAYER_TOKEN_COOKIE = "player_token";
export const PLAYER_TOKEN_MAX_AGE = 60 * 60 * 24 * 7;

const JWT_SECRET = process.env.JWT_SECRET || "dbairs-secret";
const TOKEN_EXPIRES_IN = "7d" as const;
const BCRYPT_ROUNDS = 10;
const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type PlayerTokenPayload = {
  userId: string;
  role: typeof PLAYER_ROLE;
  tenantId: string;
};

export const PLAYER_AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: PLAYER_TOKEN_MAX_AGE,
} as const;

/** 与管理员 JWT 完全隔离：role 固定为 player，且必须带 tenantId。 */
export function signPlayerToken(payload: PlayerTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

export function verifyPlayerToken(token: string): PlayerTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (typeof decoded === "string") {
      return null;
    }

    const { userId, role, tenantId } = decoded;

    if (
      typeof userId !== "string" ||
      role !== PLAYER_ROLE ||
      typeof tenantId !== "string" ||
      !tenantId
    ) {
      return null;
    }

    return { userId, role: PLAYER_ROLE, tenantId };
  } catch {
    return null;
  }
}

export function hashPlayerPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPlayerPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/**
 * 玩家推广码：8 位大写字母 + 数字，去掉 0/O/1/I 等易混淆字符。
 * 全局唯一（schema 上是 @unique），注册时若碰撞会重新生成。
 */
export function createPlayerReferralCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += REFERRAL_ALPHABET[bytes[index] % REFERRAL_ALPHABET.length];
  }

  return code;
}
