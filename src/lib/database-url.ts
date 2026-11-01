/**
 * 数据库连接串规范化（纯函数：Prisma Client 与 `npm run db:check` 共用）。
 *
 * 这一层的存在是为了对付「从 Supabase 控制台复制连接串」最常见的三个坑：
 *
 * 1. 首尾空格 / 整串被引号包住 —— 环境变量加载器不一定帮你剥掉，
 *    粘错一次就会变成「密码明明是对的，数据库却一直认证失败」；
 * 2. Supabase 的 Supavisor 连接池（*.supabase.com / *.supabase.co）强制 TLS，
 *    而 `pg` 只有在连接串里出现 sslmode 参数时才会真正走 TLS，
 *    缺省是明文握手，表现同样是握手/认证阶段报错；
 * 3. 开了代理 / 企业网关 / 部分杀毒软件时，TLS 证书链会被替换成自签证书，
 *    `pg` 新版本把 sslmode=require 当 verify-full 处理，会直接报
 *    `SELF_SIGNED_CERT_IN_CHAIN`。这里加 uselibpqcompat=true 回到 libpq 语义：
 *    链路加密，但不做 CA 校验——与 Supabase 文档推荐的 sslmode=require 一致。
 *
 * 因此这里只做两件事：剥引号、给 Supabase 主机补上 TLS 参数。
 * 用户自己写了 sslmode 的一律不覆盖；其它数据库（本地 Postgres、自建库）原样返回。
 */
export function normalizeDatabaseUrl(raw: string): string {
  const trimmed = stripQuotes(raw);

  try {
    const url = new URL(trimmed);

    if (!url.searchParams.has("sslmode") && isSupabaseHost(url.hostname)) {
      url.searchParams.set("uselibpqcompat", "true");
      url.searchParams.set("sslmode", "require");
    }

    return url.toString();
  } catch {
    // 连 URL 都解析不了：原样交给 pg，让真实的报错信息透出来。
    return trimmed;
  }
}

/** 打日志 / 自检脚本用：隐去密码，只保留定位问题需要的部分 */
export function maskDatabaseUrl(raw: string): string {
  try {
    const url = new URL(stripQuotes(raw));
    const credentials = url.password
      ? `${url.username}:****@`
      : url.username
        ? `${url.username}@`
        : "";

    return `${url.protocol}//${credentials}${url.host}${url.pathname}${url.search}`;
  } catch {
    return "(无法解析的数据库连接串)";
  }
}

function stripQuotes(raw: string): string {
  const trimmed = raw.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);

  return (quoted ? quoted[2] : trimmed).trim();
}

function isSupabaseHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
}
