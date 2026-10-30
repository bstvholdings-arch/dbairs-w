/**
 * 玩家账号的纯校验逻辑：不依赖 Prisma / next，登录注册页、个人中心与
 * Route Handler 共用同一套规则，保证「前端提示」与「后端拒绝」一致。
 */

export const PLAYER_USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
export const PLAYER_PASSWORD_MIN_LENGTH = 8;
export const PLAYER_PASSWORD_MAX_LENGTH = 72;
export const PLAYER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PLAYER_EMAIL_MAX_LENGTH = 120;
export const PLAYER_WALLET_MIN_LENGTH = 8;
export const PLAYER_WALLET_MAX_LENGTH = 128;
export const PLAYER_WALLET_PATTERN = /^[A-Za-z0-9:_-]+$/;
export const PLAYER_REFERRAL_PATTERN = /^[A-Za-z0-9]{4,16}$/;

/** 用户名 trim 后必须是 3–32 位字母、数字、下划线、点、连字符。 */
export function readPlayerUsername(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const username = value.trim();

  return PLAYER_USERNAME_PATTERN.test(username) ? username : "";
}

/**
 * bcrypt 只处理前 72 个字节，超过部分会被静默丢弃，因此这里按 UTF-8 字节数校验，
 * 避免中文密码等「字符数够、字节数超」的边界情况。
 */
export function readPlayerPassword(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const bytes = new TextEncoder().encode(value).length;

  if (
    bytes < PLAYER_PASSWORD_MIN_LENGTH ||
    bytes > PLAYER_PASSWORD_MAX_LENGTH
  ) {
    return "";
  }

  return value;
}

/** 邮箱选填；传空字符串代表不设置。非法格式返回 null。 */
export function readPlayerEmail(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  if (!email) {
    return "";
  }

  if (
    email.length > PLAYER_EMAIL_MAX_LENGTH ||
    !PLAYER_EMAIL_PATTERN.test(email)
  ) {
    return null;
  }

  return email;
}

/** 钱包地址必填校验；返回 trim 后的地址，非法返回空字符串。 */
export function readPlayerWalletAddress(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const address = value.trim();

  if (
    address.length < PLAYER_WALLET_MIN_LENGTH ||
    address.length > PLAYER_WALLET_MAX_LENGTH ||
    !PLAYER_WALLET_PATTERN.test(address)
  ) {
    return "";
  }

  return address;
}

export function readPlayerReferralCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const code = value.trim().toUpperCase();

  return PLAYER_REFERRAL_PATTERN.test(code) ? code : "";
}
