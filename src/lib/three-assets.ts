/**
 * 3D 素材路径的唯一出处（纯函数，服务端 / 客户端都能 import）。
 *
 * 红线（与 AGENTS.md 第 4.2 条 `logoUrl` 同一口径）：
 * 1. 所有下载的模型（`.glb` / `.gltf`）、贴图、环境图统一放 `public/assets/3d/`，
 *    落盘后由 Next 以站内路径直接出资源，**不要**散落到 `public/` 根目录；
 * 2. 组件里禁止手写 `"/assets/3d/xxx.glb"`，一律走 `resolveThreeAssetUrl()` ——
 *    将来把素材迁到对象存储 / CDN 时只改这一个文件，不用满仓库找字符串；
 * 3. 认不出来的值（空串、`javascript:` / `data:` / `//host/x.glb`、带 `..` 的路径）
 *    一律返回 `null`，调用方按「没有模型」处理。这些值最终会进 `useGLTF(<url>)`，
 *    放行等于让脏数据决定浏览器去加载什么。
 */

/** 站内素材根目录（相对 `public/`，对外即 `/assets/3d/...`） */
export const THREE_ASSET_ROOT = "/assets/3d";

/**
 * 3D 联调页路径（公众可访问，不需要登录、不查库、不需要 `?tenant=`）。
 *
 * 为什么常量放在这里而不是直接写字符串：`src/proxy.ts` 要按这个路径放行，
 * 页面文件 `/demo/three` 也要知道自己的地址 —— 两处硬编码迟早会不一致，
 * 一致的结果就是「页面明明存在，却被登录校验拦到 /login」。
 */
export const THREE_DEMO_PATH = "/demo/three";

/**
 * 联调页用的示例模型（相对素材根目录）。真实业务模型不要放在 `models/ui/` 下
 * （那个目录是演示 / 占位专用），也不要把它当第二个素材入口 —— 路径仍只从这里出口。
 */
export const THREE_DEMO_MODEL_PATH = "models/ui/demo-cube.glb";

/** 允许的模型格式：`.glb` 优先（单文件自带贴图），`.gltf` + 外部 `.bin` 只在必要时用 */
export const THREE_MODEL_EXTENSIONS = [".glb", ".gltf"] as const;

/** 允许的贴图格式：优先 `webp` / `ktx2`（体积小、GPU 友好），png/jpg 仅兜底 */
export const THREE_TEXTURE_EXTENSIONS = [".webp", ".ktx2", ".png", ".jpg", ".jpeg"] as const;

/**
 * 素材体积预算（MB）。超了就不要塞进 `public/`（会被打进部署包、也会拖慢首屏），
 * 改走对象存储 + CDN，再用 `resolveThreeAssetUrl()` 的 http(s) 直链分支。
 */
export const THREE_ASSET_LIMITS = {
  /** 单个模型上限：超过就该先做 Draco / meshopt 压缩或拆场景 */
  modelMb: 8,
  /** 单张贴图上限 */
  textureMb: 4,
  /** 单个场景（模型 + 贴图 + 环境图）合计上限 */
  sceneMb: 24,
} as const;

/** 这些协议会被塞进 `<img>` / loader 直接执行，一律拒 */
const BLOCKED_PROTOCOL = /^(?:javascript|data|vbscript|file):/i;

/**
 * 归一化素材路径：统一分隔符、拒绝危险写法。
 * 不做「猜一个能用的」——认不出来就返回 null。
 */
export function normalizeThreeAssetPath(input: string): string | null {
  const raw = (input ?? "").trim().replace(/\\/g, "/");

  if (!raw) {
    return null;
  }

  if (BLOCKED_PROTOCOL.test(raw)) {
    return null;
  }

  // 协议相对地址（//cdn.example.com/x.glb）在 <img> / fetch 里会继承当前协议，
  // 与 logo 一样直接拒掉，避免被当成「站内路径」混进相对解析。
  if (raw.startsWith("//")) {
    return null;
  }

  // 禁止跳出素材目录
  if (raw.split("/").includes("..")) {
    return null;
  }

  return raw;
}

/** 是否是 http(s) 绝对地址（CDN / 对象存储直链） */
export function isRemoteThreeAssetUrl(path: string): boolean {
  return /^https?:\/\//i.test((path ?? "").trim());
}

/**
 * 把「素材相对路径」解析成可以直接交给 loader 的地址。
 *
 *   resolveThreeAssetUrl("models/dice.glb")        → "/assets/3d/models/dice.glb"
 *   resolveThreeAssetUrl("/assets/3d/dice.glb")    → "/assets/3d/dice.glb"（原样）
 *   resolveThreeAssetUrl("https://cdn.x/dice.glb") → "https://cdn.x/dice.glb"（原样）
 *   resolveThreeAssetUrl("javascript:alert(1)")    → null
 */
export function resolveThreeAssetUrl(input: string): string | null {
  const normalized = normalizeThreeAssetPath(input);

  if (!normalized) {
    return null;
  }

  if (isRemoteThreeAssetUrl(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("/")) {
    return normalized;
  }

  return `${THREE_ASSET_ROOT}/${normalized.replace(/^\.\//, "")}`;
}

/** 是否是受支持的模型文件（用来在加载前拦掉 `.jpg`、`.zip` 这类误传） */
export function isThreeModelPath(path: string): boolean {
  const normalized = normalizeThreeAssetPath(path);

  if (!normalized) {
    return false;
  }

  const withoutQuery = normalized.split("?")[0].split("#")[0].toLowerCase();

  return THREE_MODEL_EXTENSIONS.some((extension) => withoutQuery.endsWith(extension));
}
