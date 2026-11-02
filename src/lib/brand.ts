/**
 * 白标品牌口径（唯一事实来源）。
 *
 * 平台卖的是白标站点：玩家看到的一切品牌信息都必须来自当前访问的商户
 * （`Tenant.name` + `Tenant.logoUrl`），只有「拿不到租户数据」时才回退到平台名。
 *
 * 为什么单独拆一个文件：品牌兜底常量与首字母规则被大厅、登录注册、玩家中心、
 * 实名认证、充提弹窗同时引用，散落在各自文件里就一定会出现「某页还写着 DB AIRS」
 * 这种穿帮。这里只放纯函数，不 import prisma / cookies，客户端服务端都能用。
 */

/** 平台自有品牌名：仅在完全读不到租户时兜底，白标站不该露出它 */
export const PLATFORM_BRAND_NAME = "DB AIRS";

/** 租户品牌名：trim 后非空就用租户的，否则回退平台名（永不返回空串） */
export function resolveBrandName(name?: string | null): string {
  const trimmed = typeof name === "string" ? name.trim() : "";

  return trimmed || PLATFORM_BRAND_NAME;
}

/**
 * 品牌首字母，用作「没配 Logo」时的占位方块。
 *
 * 用 Array.from 而不是 name[0]：中文 / emoji 商户名取到的是完整字符，
 * 不会把代理对劈成乱码。空串时回退平台名的首字母。
 */
export function brandInitial(name?: string | null): string {
  const resolved = resolveBrandName(name);
  const [first] = Array.from(resolved);

  return (first ?? "D").toUpperCase();
}
