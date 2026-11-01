import jwt from "jsonwebtoken";

/**
 * 超管「代登录」商户后台（impersonation）的临时票据。
 *
 * 设计要点：
 * 1. 不复制、不伪造商户账号：超管仍然用自己的会话（token cookie）访问 /tenant，
 *    另外下发一张「代登录票据」说明「我此刻代表哪个租户」。撤掉票据即恢复原身份。
 * 2. 票据是有签名的 JWT，且绑定 adminId：别人的浏览器即使拿到 cookie 也无法使用。
 * 3. 有效期只有 2 小时，过期后 /tenant 立即回到「平台账号无权访问」的状态。
 * 4. 本文件不依赖 Prisma / next，因此可以被 Edge 的 proxy 直接引用。
 */

export const IMPERSONATION_COOKIE = "dba_impersonate";

/** 票据有效期（秒）：2 小时，足够查看数据，又不至于长期挂着代登录态。 */
export const IMPERSONATION_MAX_AGE_SECONDS = 2 * 60 * 60;

const TICKET_KIND = "tenant_impersonation";
/** 与 src/lib/auth.ts 使用同一个 JWT_SECRET，避免两套密钥配置。 */
const IMPERSONATION_SECRET = process.env.JWT_SECRET || "dbairs-secret";

export type ImpersonationTicket = {
  /** 发起代登录的超管 id（票据只对这个账号有效）。 */
  adminId: string;
  /** 被代登录的租户 id。 */
  tenantId: string;
};

export function signImpersonationTicket(ticket: ImpersonationTicket): string {
  return jwt.sign(
    {
      kind: TICKET_KIND,
      adminId: ticket.adminId,
      tenantId: ticket.tenantId,
    },
    IMPERSONATION_SECRET,
    { expiresIn: IMPERSONATION_MAX_AGE_SECONDS },
  );
}

/**
 * 校验票据并确认它属于当前登录的超管。
 * 任何异常（过期、签名错、kind 不对、adminId 不匹配）都返回 null。
 */
export function verifyImpersonationTicket(
  token: string | undefined,
  adminId: string,
): ImpersonationTicket | null {
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, IMPERSONATION_SECRET);

    if (typeof decoded === "string") {
      return null;
    }

    const { kind, adminId: ticketAdminId, tenantId } = decoded as Record<
      string,
      unknown
    >;

    if (kind !== TICKET_KIND) {
      return null;
    }

    if (typeof ticketAdminId !== "string" || typeof tenantId !== "string") {
      return null;
    }

    // 票据必须属于当前登录的超管：换了账号一律无效。
    if (ticketAdminId !== adminId) {
      return null;
    }

    return { adminId: ticketAdminId, tenantId };
  } catch {
    return null;
  }
}

/** 统一 cookie 属性：httpOnly + SameSite=Lax，页面脚本读不到、跨站表单也拿不走。 */
export function impersonationCookieOptions(secure: boolean) {
  return {
    name: IMPERSONATION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  };
}
