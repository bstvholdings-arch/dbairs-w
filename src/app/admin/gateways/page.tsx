import { redirect } from "next/navigation";

/**
 * 旧路径兼容：平台不再提供支付网关配置页（收款通道已下放给商户，
 * 商户在 /tenant/payments 自行对接支付商），超管只在集成中心只读监控。
 */
export default function AdminGatewaysPage() {
  redirect("/admin/integrations");
}
