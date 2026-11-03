import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 活动 Banner 图片的本地存储（演示实现）。
 *
 * 与 KYC 证件图片的区别：**活动海报是公开营销素材**，玩家前台必须能直接渲染，
 * 所以不走带会话校验的私有接口，而是落在 .promotion-storage/ 并用
 * `/api/promotions/banners/<key>` 一个公开只读接口对外提供（长缓存 + immutable）。
 *
 * 为什么不写 public/：public 是构建期静态资源目录，运行期往里写文件在
 * standalone / 容器部署下会丢（构建产物只读），而且清理上传文件很不方便。
 *
 * 生产环境替换点：把 savePromotionImage / readPromotionImage 换成对象存储
 * （S3 / R2 / OSS），数据库里存对象 key，前台直接用 CDN 地址。
 * 校验规则（类型 / 大小）与后台表单不需要改。
 */

export const PROMOTION_STORAGE_DIR = path.join(
  process.cwd(),
  ".promotion-storage",
);

/** 上传成功后返回给后台、并落库到 PromotionBanner.imageUrl 的前缀 */
export const PROMOTION_FILE_PREFIX = "/api/promotions/banners/";

/** 活动图是横版大图，给到 5MB（与 KYC 同口径，避免调大内存占用） */
export const PROMOTION_MAX_FILE_BYTES = 5 * 1024 * 1024;

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

/** key 只允许 uuid + 已知扩展名，杜绝 ../ 目录穿越 */
const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export function isPromotionStorageKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** 从落库路径里取出 key（只认本站上传前缀，外站图片返回 null） */
export function promotionKeyFromUrl(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith(PROMOTION_FILE_PREFIX)) {
    return null;
  }

  const key = trimmed.slice(PROMOTION_FILE_PREFIX.length);

  return isPromotionStorageKey(key) ? key : null;
}

export type SavedPromotionImage = {
  key: string;
  /** 落库用：玩家前台可直接 <img src> 的公开地址 */
  url: string;
  size: number;
  contentType: string;
};

/**
 * 保存一张活动图，返回 key 与公开地址。
 * mime 必须是受支持的图片类型，大小上限 5MB（调用方已校验，这里再兜一次底）。
 */
export async function savePromotionImage(
  data: Uint8Array,
  mime: string,
): Promise<SavedPromotionImage | null> {
  const extension = MIME_EXTENSIONS[mime];

  if (
    !extension ||
    data.length === 0 ||
    data.length > PROMOTION_MAX_FILE_BYTES
  ) {
    return null;
  }

  await mkdir(PROMOTION_STORAGE_DIR, { recursive: true });

  const key = `${randomUUID()}.${extension}`;

  await writeFile(path.join(PROMOTION_STORAGE_DIR, key), data);

  return {
    key,
    url: `${PROMOTION_FILE_PREFIX}${key}`,
    size: data.length,
    contentType: mime,
  };
}

export type PromotionImagePayload = {
  data: Uint8Array;
  contentType: string;
};

export async function readPromotionImage(
  key: string,
): Promise<PromotionImagePayload | null> {
  if (!isPromotionStorageKey(key)) {
    return null;
  }

  try {
    const file = await readFile(path.join(PROMOTION_STORAGE_DIR, key));
    const extension = key.split(".").pop() ?? "";
    const contentType = EXTENSION_CONTENT_TYPES[extension] ?? "image/jpeg";

    return { data: new Uint8Array(file), contentType };
  } catch {
    // 文件被清理 / 迁移后丢失：返回 404，前台 <img> 自己兜底，不抛 500。
    return null;
  }
}

/** 仅判断文件是否存在（保存 Banner 时挡住伪造的本站图片地址）。 */
export async function promotionImageExists(key: string): Promise<boolean> {
  if (!isPromotionStorageKey(key)) {
    return false;
  }

  try {
    const info = await stat(path.join(PROMOTION_STORAGE_DIR, key));

    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
