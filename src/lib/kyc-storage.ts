import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * KYC 证件图片的私有存储（演示实现）。
 *
 * 为什么不写 public/：public 下的文件是静态公开资源，任何人拿到路径就能下载，
 * 身份证照片放进去等于裸奔。这里把文件写在仓库根目录的 .kyc-storage/（已 gitignore），
 * 读取必须经过带会话校验的接口：
 *   - 玩家：GET /api/player/kyc/files/[key]  只能读自己的
 *   - 商户：GET /api/tenant/kyc/files/[key]  只能读本租户提交的
 *
 * 生产环境替换点：把 saveKycImage / readKycImage 换成对象存储（S3 / R2 / OSS），
 * 数据库里存对象 key，接口返回 5-15 分钟的预签名 URL（storage.save 改为 putObject）。
 * 其余业务代码（状态流转、提现前置校验）不需要改。
 */

export const KYC_STORAGE_DIR = path.join(process.cwd(), ".kyc-storage");

/** 落库的规范路径（玩家侧可读），商户侧展示时换成 tenant 前缀。 */
export const KYC_PLAYER_FILE_PREFIX = "/api/player/kyc/files/";
export const KYC_TENANT_FILE_PREFIX = "/api/tenant/kyc/files/";

export const KYC_MAX_FILE_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** key 只允许 uuid + 已知扩展名，杜绝 ../ 目录穿越。 */
const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export function isKycStorageKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/**
 * 用文件头（magic bytes）判断真实类型，
 * 避免把 .html / .svg 改个扩展名就当成图片存进来（存储型 XSS 的常见入口）。
 */
export function sniffImageMime(data: Uint8Array): string | null {
  if (data.length < 12) {
    return null;
  }

  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return "image/png";
  }

  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export type SavedKycImage = {
  key: string;
  /** 落库用：玩家侧可读的受控路径 */
  url: string;
  size: number;
  contentType: string;
};

/**
 * 保存一张证件图片，返回 key 与受控 URL。
 * mime 必须是受支持的图片类型，大小上限 5MB（调用方已校验，这里再兜一次底）。
 */
export async function saveKycImage(
  data: Uint8Array,
  mime: string,
): Promise<SavedKycImage | null> {
  const extension = MIME_EXTENSIONS[mime];

  if (!extension || data.length === 0 || data.length > KYC_MAX_FILE_BYTES) {
    return null;
  }

  await mkdir(KYC_STORAGE_DIR, { recursive: true });

  const key = `${randomUUID()}.${extension}`;

  await writeFile(path.join(KYC_STORAGE_DIR, key), data);

  return {
    key,
    url: `${KYC_PLAYER_FILE_PREFIX}${key}`,
    size: data.length,
    contentType: mime,
  };
}

export type KycImagePayload = {
  data: Uint8Array;
  contentType: string;
};

export async function readKycImage(
  key: string,
): Promise<KycImagePayload | null> {
  if (!isKycStorageKey(key)) {
    return null;
  }

  try {
    const file = await readFile(path.join(KYC_STORAGE_DIR, key));
    const extension = key.split(".").pop() ?? "";
    const contentType = EXTENSION_CONTENT_TYPES[extension] ?? "image/jpeg";

    return { data: new Uint8Array(file), contentType };
  } catch {
    // 文件被清理 / 迁移后丢失：当作不存在处理，页面显示「图片不可用」而不是 500。
    return null;
  }
}

/** 仅判断文件是否存在（提交接口用它挡住伪造的图片 URL）。 */
export async function kycImageExists(key: string): Promise<boolean> {
  if (!isKycStorageKey(key)) {
    return false;
  }

  try {
    const info = await stat(path.join(KYC_STORAGE_DIR, key));

    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** 从落库路径里取出 key（同时兼容玩家侧 / 商户侧两种前缀）。 */
export function kycKeyFromUrl(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  const prefix = trimmed.startsWith(KYC_PLAYER_FILE_PREFIX)
    ? KYC_PLAYER_FILE_PREFIX
    : trimmed.startsWith(KYC_TENANT_FILE_PREFIX)
      ? KYC_TENANT_FILE_PREFIX
      : null;

  if (!prefix) {
    return null;
  }

  const key = trimmed.slice(prefix.length);

  return isKycStorageKey(key) ? key : null;
}

/** 玩家端展示用 URL（读自己的图）。 */
export function playerKycFileUrl(
  value: string | null | undefined,
): string | null {
  const key = kycKeyFromUrl(value);

  return key ? `${KYC_PLAYER_FILE_PREFIX}${key}` : null;
}

/** 商户端展示用 URL（读本租户提交的图）。 */
export function tenantKycFileUrl(
  value: string | null | undefined,
): string | null {
  const key = kycKeyFromUrl(value);

  return key ? `${KYC_TENANT_FILE_PREFIX}${key}` : null;
}
