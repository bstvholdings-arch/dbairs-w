import { redirect } from "next/navigation";

/**
 * 旧路径兼容：支付网关已独立到 /admin/payments。
 */
export default function AdminGatewaysPage() {
  redirect("/admin/payments");
}
