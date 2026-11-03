import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 商户品牌 Logo 的图片存储（演示实现）。
 *
 * 权限口径（产品决策，不可回退）：Logo **只能由超级管理员**在
 * 【租户管理 → 新建 / 编辑租户】弹窗里上传或更换，商户后台没有任何
 * 写入口（/api/tenant/settings 的 PATCH 会显式忽略 logoUrl）。
 * 所以写侧只有 `/api/admin/tenant-logos/upload` 一个入口，且必须超管身份。
 *
 * 为什么不放 public/：public 是构建期静态资源目录，运行期往里写文件在
 * standalone / 容器部署下会丢（构建产物只读），清理旧 Logo 也不方便。
 * Logo 属于公开营销素材（玩家前台 <img> 必须能直接渲染），因此读侧走
 * `/api/tenant-logos/<key>` 这个**公开只读**接口（长缓存 + immutable），
 * 不做会话校验 —— 对比 KYC 证件图：那份必须登录 + 归属校验。
 *
 * ── 生产环境替换点（Supabase Storage / S3 / R2）────────────────────────────
 * 只替换本文件的 saveTenantLogo：改成把 bytes 上传到 bucket（例如
 * supabase.storage.from("tenant-logos").upload(key, bytes)）并返回
 * `getPublicUrl(key)` 的直链；readTenantLogo 与 `/api/tenant-logos/[key]`
 * 可以整段删掉。/api/admin/tenant-logos/upload 的入参、校验规则、
 * 返回结构 { url } 以及 Tenant.logoUrl 的读写口径都不用改。
 * ────────────────────────────────────────────────────────────────────────
 */

export const TENANT_LOGO_STORAGE_DIR = path.join(
  process.cwd(),
  ".tenant-logo-storage",
);

/** 上传成功后返回给后台、并落库到 Tenant.logoUrl 的前缀 */
export const TENANT_LOGO_FILE_PREFIX = "/api/tenant-logos/";

/**
 * Logo 是展示用小图（前台最大也就 224px 宽）：2MB 已经远超实际需要，
 * 超过基本是原图没压；压小一点也能让玩家首屏少拉几百 KB。
 */
export const TENANT_LOGO_MAX_FILE_BYTES = 2 * 1024 * 1024;

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

/**
 * key 只允许 uuid + 已知扩展名，杜绝 ../ 目录穿越。
 * 刻意不接受 svg：SVG 里可以带 <script>，直接当图片对外提供等于开放 XSS 面
 * （与活动图 / KYC 证件图同一口径，见 lib/kyc-storage.ts 的 sniffImageMime）。
 */
const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export function isTenantLogoStorageKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** 从落库地址里取出 key（只认本站上传前缀，外站图片 / public 静态图返回 null） */
export function tenantLogoKeyFromUrl(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith(TENANT_LOGO_FILE_PREFIX)) {
    return null;
  }

  const key = trimmed.slice(TENANT_LOGO_FILE_PREFIX.length);

  return isTenantLogoStorageKey(key) ? key : null;
}

export type SavedTenantLogo = {
  key: string;
  /** 落库用：玩家前台可直接 <img src> 的公开地址 */
  url: string;
  size: number;
  contentType: string;
};

/**
 * 保存一张 Logo，返回 key 与公开地址。
 * mime 必须是受支持的图片类型（由调用方按文件头嗅探），大小上限 2MB。
 */
export async function saveTenantLogo(
  data: Uint8Array,
  mime: string,
): Promise<SavedTenantLogo | null> {
  const extension = MIME_EXTENSIONS[mime];

  if (
    !extension ||
    data.length === 0 ||
    data.length > TENANT_LOGO_MAX_FILE_BYTES
  ) {
    return null;
  }

  await mkdir(TENANT_LOGO_STORAGE_DIR, { recursive: true });

  // 文件名用 uuid：换 Logo 必然换地址，前台长缓存 + immutable 也不会看到旧图。
  const key = `${randomUUID()}.${extension}`;

  await writeFile(path.join(TENANT_LOGO_STORAGE_DIR, key), data);

  return {
    key,
    url: `${TENANT_LOGO_FILE_PREFIX}${key}`,
    size: data.length,
    contentType: mime,
  };
}

export type TenantLogoPayload = {
  data: Uint8Array;
  contentType: string;
};

export async function readTenantLogo(
  key: string,
): Promise<TenantLogoPayload | null> {
  if (!isTenantLogoStorageKey(key)) {
    return null;
  }

  try {
    const file = await readFile(path.join(TENANT_LOGO_STORAGE_DIR, key));
    const extension = key.split(".").pop() ?? "";
    const contentType = EXTENSION_CONTENT_TYPES[extension] ?? "image/png";

    return { data: new Uint8Array(file), contentType };
  } catch {
    // 文件被清理 / 迁移后丢失：返回 404，前台 <img> 自己退回占位，不抛 500。
    return null;
  }
}

/** 仅判断文件是否存在（保存租户时挡住伪造的本站 Logo 地址）。 */
export async function tenantLogoExists(key: string): Promise<boolean> {
  if (!isTenantLogoStorageKey(key)) {
    return false;
  }

  try {
    const info = await stat(path.join(TENANT_LOGO_STORAGE_DIR, key));

    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
