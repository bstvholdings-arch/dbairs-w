import { redirect } from "next/navigation";

/**
 * 旧路径兼容：财务对账已统一到 /finance，由页面按角色决定数据范围。
 */
export default function TenantFinanceRedirectPage() {
  redirect("/finance");
}
