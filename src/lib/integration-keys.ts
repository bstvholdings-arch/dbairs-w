import { randomBytes } from "node:crypto";

/**
 * 商户专属 API Key 的生成规则（只有服务端可以引用，因为依赖 node:crypto）。
 *
 * 前缀 sk_live_ 让密钥在日志 / 聊天记录里一眼可辨，便于做泄漏扫描；
 * 后面 24 字节随机数（48 位十六进制）≈ 192 bit 熵，实际使用中不可能碰撞。
 *
 * 明文入库是刻意选择：与 PaymentGateway.apiKey 同一口径，而且「发送至邮箱」
 * 需要能重新读出密钥。所有列表 / 详情接口只返回 maskApiKey() 掩码，
 * 只有「重置密钥」的响应里会返回一次明文，由超管自行抄走。
 */
export const TENANT_API_KEY_PREFIX = "sk_live_";

export function generateTenantApiKey() {
  return `${TENANT_API_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
}
