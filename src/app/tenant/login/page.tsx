import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { TENANT_HOME_PATH, TENANT_ROLE } from "@/lib/rbac";
import { getSessionUserFromCookies } from "@/lib/session";

import { TenantLoginClient } from "./tenant-login-client";

export const instant = false;

export const metadata: Metadata = {
  title: "商户后台登录 | DBAIRS",
  description: "商户管理员登录入口：使用总部开通的邮箱与初始密码登录。",
};

/**
 * 商户后台独立登录页（/tenant/login）。
 *
 * - 未登录：直接渲染表单（proxy 已把该路径列为公开入口）；
 * - 已是商户账号：直接送回 /tenant/dashboard，避免「登录了还要再看一次表单」；
 * - 平台员工登录会被 /api/auth/login 以 403 拒绝（portal=tenant），
 *   因此这里不需要按角色重定向到 /admin，也就不会出现循环跳转。
 */
export default async function TenantLoginPage() {
  // cacheComponents 下 cookies() 属于动态数据，先显式声明动态渲染。
  await connection();

  const user = await getSessionUserFromCookies();

  if (user?.role === TENANT_ROLE) {
    redirect(TENANT_HOME_PATH);
  }

  return <TenantLoginClient />;
}
