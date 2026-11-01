/**
 * 玩家账号的纯校验逻辑：不依赖 Prisma / next，登录注册页、个人中心与
 * Route Handler 共用同一套规则，保证「前端提示」与「后端拒绝」一致。
 */
import type { TranslationKey } from "@/lib/i18n-types";

export const PLAYER_USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
export const PLAYER_PASSWORD_MIN_LENGTH = 8;
export const PLAYER_PASSWORD_MAX_LENGTH = 72;
export const PLAYER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PLAYER_EMAIL_MAX_LENGTH = 120;
export const PLAYER_WALLET_MIN_LENGTH = 8;
export const PLAYER_WALLET_MAX_LENGTH = 128;
export const PLAYER_WALLET_PATTERN = /^[A-Za-z0-9:_-]+$/;
export const PLAYER_REFERRAL_PATTERN = /^[A-Za-z0-9]{4,16}$/;
/** 通用 E.164：+ 开头，1–15 位数字，且首位不能是 0。 */
export const PLAYER_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
export const PLAYER_PHONE_MAX_LENGTH = 20;
export const DEFAULT_PLAYER_PHONE_COUNTRY = "+60";
/** 登录标识（用户名 / 手机号 / 邮箱）长度上限，与邮箱字段保持一致。 */
export const PLAYER_IDENTIFIER_MAX_LENGTH = 120;
export const PLAYER_IDENTIFIER_PATTERN = /^[A-Za-z0-9@._+\-() ]{3,120}$/;

/**
 * 注册页【区号下拉框】的唯一数据源：前端选项、前端预校验、后端拒绝都读这一份，
 * minDigits / maxDigits 是该国的本地号码位数（不含区号）。
 */
export const PLAYER_PHONE_COUNTRIES = [
  {
    code: "+60",
    iso: "MY",
    labelKey: "player.auth.countryMY",
    minDigits: 9,
    maxDigits: 10,
  },
  {
    code: "+65",
    iso: "SG",
    labelKey: "player.auth.countrySG",
    minDigits: 8,
    maxDigits: 8,
  },
  {
    code: "+62",
    iso: "ID",
    labelKey: "player.auth.countryID",
    minDigits: 9,
    maxDigits: 12,
  },
  {
    code: "+63",
    iso: "PH",
    labelKey: "player.auth.countryPH",
    minDigits: 10,
    maxDigits: 10,
  },
  {
    code: "+84",
    iso: "VN",
    labelKey: "player.auth.countryVN",
    minDigits: 9,
    maxDigits: 10,
  },
  {
    code: "+86",
    iso: "CN",
    labelKey: "player.auth.countryCN",
    minDigits: 11,
    maxDigits: 11,
  },
] as const satisfies readonly {
  code: string;
  iso: string;
  labelKey: TranslationKey;
  minDigits: number;
  maxDigits: number;
}[];

export type PlayerPhoneCountry = (typeof PLAYER_PHONE_COUNTRIES)[number];
export type PlayerPhoneCountryCode = PlayerPhoneCountry["code"];

export function findPlayerPhoneCountry(
  code: string,
): PlayerPhoneCountry | null {
  return PLAYER_PHONE_COUNTRIES.find((item) => item.code === code) ?? null;
}

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

/**
 * 手机号归一化成 E.164（含国际区号）：
 * - 容忍粘贴进来的空格、括号、连字符、点，如 "+60 12-345 6789"；
 * - 没写 "+" 时自动补上，方便用户只输入 60123456789；
 * - 区号在 PLAYER_PHONE_COUNTRIES 名单内时，额外校验该国本地号码位数；
 * - 名单外的区号只做通用 E.164 校验（1–15 位数字），不影响其他国家的站点。
 *
 * 非法 / 空返回空字符串，由调用方决定返回 400 还是「必填」提示。
 */
export function readPlayerPhone(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const cleaned = value.trim().replace(/[\s()\-.]/g, "");

  if (!cleaned || cleaned.length > PLAYER_PHONE_MAX_LENGTH) {
    return "";
  }

  const phone = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;

  if (!PLAYER_PHONE_PATTERN.test(phone)) {
    return "";
  }

  const country = PLAYER_PHONE_COUNTRIES.find((item) =>
    phone.startsWith(item.code),
  );

  if (!country) {
    return phone;
  }

  const localNumber = phone.slice(country.code.length);

  // 国际格式不带本地 0 前缀：马来西亚 0123456789 要写成 +60123456789。
  if (!/^[1-9]\d*$/.test(localNumber)) {
    return "";
  }

  if (
    localNumber.length < country.minDigits ||
    localNumber.length > country.maxDigits
  ) {
    return "";
  }

  return phone;
}

/**
 * 登录标识：用户名 / 手机号 / 邮箱三选一。
 * 这里只做基础清洗与字符集校验——具体命中哪个字段交给后端 OR 查库判断，
 * 否则用户输手机号时会被用户名正则提前拦下。
 */
export function readPlayerLoginIdentifier(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const identifier = value.trim();

  if (
    identifier.length < 3 ||
    identifier.length > PLAYER_IDENTIFIER_MAX_LENGTH ||
    !PLAYER_IDENTIFIER_PATTERN.test(identifier)
  ) {
    return "";
  }

  return identifier;
}

/**
 * 把登录标识拆成查库用的候选值：
 * - 邮箱（含 @）统一小写，与注册时入库的小写邮箱对齐；
 * - 手机号去掉空格括号等符号后，同时尝试 "+<digits>" 与纯数字（兼容历史数据）。
 */
export function buildPlayerLoginCandidates(identifier: string): {
  username: string;
  email: string;
  phones: string[];
  phoneSuffix: string;
} {
  const email = identifier.includes("@") ? identifier.toLowerCase() : "";
  const digits = identifier.replace(/\D/g, "");
  // 少于 7 位数字（多半是带数字的用户名 / 邮箱）不做手机号匹配，避免多余的 OR 条件。
  const hasPhoneShape = digits.length >= 7;
  const phones = hasPhoneShape ? [`+${digits}`, digits] : [];

  return {
    username: identifier,
    email,
    phones,
    // 只输入本地号码（不带区号）时，用后缀匹配兜底：以 0 开头的先去掉前导 0。
    phoneSuffix: hasPhoneShape ? digits.replace(/^0+/, "") : "",
  };
}
