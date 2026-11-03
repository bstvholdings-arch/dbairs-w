import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { buildFailoverTargets, normalizeHost } from "@/lib/tenant-domains";

/**
 * `GET /api/domain-guard` —— 告诉前台 `<DomainGuard />`：
 * 当前这台站点有哪些备用线路可跳、跳的顺序是什么。
 *
 * 为什么要有这个接口，而不是把备用域名塞进大厅页面 props：
 * 1. `<DomainGuard />` 挂在 root layout（所有页面最顶层），而 root layout 里
 *    拿不到租户（后台页面没有租户上下文，硬解析会把 /admin 也弄成 404）；
 * 2. 候选列表的排序规则（当前在备用线路上时先试别的备用域名、最后才回主域名）
 *    必须只有一份实现 —— 就是 lib/tenant-domains.ts 的 buildFailoverTargets，
 *    客户端只负责按列表顺序取第一个，不做任何判断。
 *
 * 安全口径：只按**访问域名**解析，只看 `?tenant=` / 会话 / 代登录票据一律不认，
 * 这样后台（平台自己的域名）拿到的永远是空列表，不会把运营从后台踢到商户线路上。
 * 返回值只有域名，不含租户 id / 名称 / 任何业务数据。
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

type DomainGuardPayload = {
  /** true = 这台站点挂了备用域名，且当前域名不是候选目标（可以跳） */
  enabled: boolean;
  /** 当前主机名（已归一化，前端用它做自跳保护） */
  host: string;
  /** 按顺序尝试的备用域名列表（不含当前主机） */
  candidates: string[];
};

function payload(host: string, candidates: string[]): DomainGuardPayload {
  return { enabled: candidates.length > 0, host, candidates };
}

export async function GET() {
  const host = normalizeHost((await headers()).get("host"));

  if (!host) {
    return Response.json(payload("", []), { headers: NO_STORE });
  }

  try {
    // 主域名 / 备用域名直接命中；`winvora.平台域` 这种三级域名再按子域名前缀兜一次
    // （二级域名如 example.com 不走子域名匹配，避免把 localhost / 平台自身域名误认成租户）。
    const labels = host.split(".");
    const subdomain = labels.length >= 3 ? labels[0] : "";

    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { domain: host },
          { backupDomains: { has: host } },
          ...(subdomain ? [{ subdomain }] : []),
        ],
      },
      select: { domain: true, backupDomains: true },
    });

    if (!tenant) {
      return Response.json(payload(host, []), { headers: NO_STORE });
    }

    const candidates = buildFailoverTargets({
      currentHost: host,
      domain: tenant.domain,
      backupDomains: tenant.backupDomains,
    });

    return Response.json(payload(host, candidates), { headers: NO_STORE });
  } catch (error) {
    // 查库失败 = 无法判断线路，一律「不启用」：
    // 自动跳转是保命功能，不能因为它自己出错而把还能用的站点踢走。
    console.error("读取备用域名池失败:", error);

    return Response.json(payload(host, []), { headers: NO_STORE });
  }
}
