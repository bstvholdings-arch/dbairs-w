import { redirect } from "next/navigation";

/**
 * 旧入口兼容：商户后台首页已统一到 /tenant/dashboard。
 * 保留 /tenant 是为了不让历史书签 / 登录后的旧跳转 404。
 */
export default function TenantIndexPage() {
  redirect("/tenant/dashboard");
}
