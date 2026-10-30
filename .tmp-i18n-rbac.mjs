import fs from "node:fs";

const zh = {
  "nav.staff": "员工管理",

  "shell.role.finance": "FINANCE",
  "shell.role.tech": "TECH",
  "shell.role.support": "SUPPORT",

  "rbac.denied": "无权限访问该页面",
  "rbac.deniedDetail":
    "当前角色「{{role}}」缺少「{{permission}}」权限，已返回你的首页。需要开通请联系超级管理员。",
  "rbac.dismiss": "知道了",
  "rbac.role.super_admin": "超级管理员",
  "rbac.role.finance": "财务",
  "rbac.role.tech": "技术",
  "rbac.role.support": "客服",
  "rbac.role.tenant_admin": "租户管理员",
  "rbac.roleHint.super_admin": "拥有平台全部权限，含员工管理与权限分配。",
  "rbac.roleHint.finance": "只看数据大盘与财务对账，可处理出金审批。",
  "rbac.roleHint.tech": "只维护游戏商 / 游戏库配置，AI 日志只读。",
  "rbac.roleHint.support": "仅可查看数据大盘，用于客服查询。",
  "rbac.permission.dashboard": "数据大盘",
  "rbac.permission.tenants": "租户管理",
  "rbac.permission.providers": "游戏商",
  "rbac.permission.games": "游戏库",
  "rbac.permission.storefront": "前台装修",
  "rbac.permission.payments": "支付网关",
  "rbac.permission.finance": "财务对账",
  "rbac.permission.withdrawals": "出金审批",
  "rbac.permission.aiSettings": "AI 设置",
  "rbac.permission.aiLogs": "AI 日志",
  "rbac.permission.staff": "员工管理",
  "rbac.permission.tenantZone": "租户控制台",

  "staff.header.eyebrow": "员工与权限",
  "staff.header.title": "员工管理",
  "staff.header.subtitle":
    "添加平台员工并分配角色；菜单与接口会按角色自动收敛，强行输入未授权 URL 会被送回首页并提示无权限。",
  "staff.actions.create": "新增员工",
  "staff.actions.edit": "修改权限",
  "staff.table.username": "账号",
  "staff.table.role": "角色",
  "staff.table.createdAt": "创建时间",
  "staff.table.actions": "操作",
  "staff.table.empty": "暂无员工账号，点击右上角「新增员工」开始添加。",
  "staff.table.self": "当前账号",
  "staff.footer.count": "共 {{count}} 名员工 · 按角色优先级排序",
  "staff.footer.security": "至少保留一名超级管理员；不能删除或降级自己",
  "staff.matrix.title": "权限矩阵",
  "staff.matrix.hint": "菜单、页面与接口共用同一份矩阵（src/lib/rbac.ts）",
  "staff.form.eyebrow": "员工账号",
  "staff.form.createTitle": "新增员工",
  "staff.form.editTitle": "修改员工",
  "staff.form.username": "登录用户名",
  "staff.form.usernamePlaceholder": "例如 finance01",
  "staff.form.usernameHint": "3–32 位字母、数字、下划线、点或连字符",
  "staff.form.usernameLocked": "用户名创建后不可修改",
  "staff.form.password": "登录密码",
  "staff.form.passwordPlaceholder": "至少 {{min}} 位",
  "staff.form.passwordCreateHint": "{{min}}–{{max}} 位，请线下告知员工",
  "staff.form.passwordEditHint": "留空表示不修改密码",
  "staff.form.role": "角色",
  "staff.form.roleLocked": "不能修改自己的角色，请让其他超级管理员操作",
  "staff.form.createSubmit": "创建员工",
  "staff.form.saveSubmit": "保存修改",
  "staff.form.error.username": "用户名需为 3–32 位字母、数字、下划线、点或连字符",
  "staff.form.error.password": "密码长度需在 {{min}}–{{max}} 位之间",
  "staff.form.error.saveFailed": "保存失败，请稍后重试",
  "staff.banner.created": "员工账号已创建",
  "staff.banner.saved": "员工资料已保存",
  "staff.banner.deleted": "员工「{{name}}」已删除",
  "staff.confirm.delete":
    "确认删除员工「{{name}}」？删除后该账号立即无法登录，且无法恢复。",
  "staff.error.deleteFailed": "删除失败，请稍后重试",
  "staff.error.deleteNetwork": "网络连接异常，删除失败",
  "staff.error.selfDelete": "不能删除当前登录的账号",
};

const en = {
  "nav.staff": "Staff & Roles",

  "shell.role.finance": "FINANCE",
  "shell.role.tech": "TECH",
  "shell.role.support": "SUPPORT",

  "rbac.denied": "You don't have access to this page",
  "rbac.deniedDetail":
    'Your role "{{role}}" is missing the "{{permission}}" permission, so you were sent back to your home page. Ask a super admin to grant access.',
  "rbac.dismiss": "Got it",
  "rbac.role.super_admin": "Super admin",
  "rbac.role.finance": "Finance",
  "rbac.role.tech": "Tech",
  "rbac.role.support": "Support",
  "rbac.role.tenant_admin": "Tenant admin",
  "rbac.roleHint.super_admin":
    "Full platform access, including staff management and permission assignment.",
  "rbac.roleHint.finance":
    "Dashboard and finance reconciliation only, plus withdrawal approvals.",
  "rbac.roleHint.tech":
    "Provider and game catalogue configuration only; AI logs are read-only.",
  "rbac.roleHint.support": "Dashboard only, for support lookups.",
  "rbac.permission.dashboard": "Dashboard",
  "rbac.permission.tenants": "Tenants",
  "rbac.permission.providers": "Providers",
  "rbac.permission.games": "Game library",
  "rbac.permission.storefront": "Storefront",
  "rbac.permission.payments": "Payment gateways",
  "rbac.permission.finance": "Finance",
  "rbac.permission.withdrawals": "Withdrawal approvals",
  "rbac.permission.aiSettings": "AI settings",
  "rbac.permission.aiLogs": "AI logs",
  "rbac.permission.staff": "Staff",
  "rbac.permission.tenantZone": "Tenant console",

  "staff.header.eyebrow": "Staff & permissions",
  "staff.header.title": "Staff management",
  "staff.header.subtitle":
    "Add platform staff and assign roles. Menus and APIs narrow down automatically, and any unauthorised URL sends the user back home with a permission notice.",
  "staff.actions.create": "Add staff",
  "staff.actions.edit": "Edit access",
  "staff.table.username": "Account",
  "staff.table.role": "Role",
  "staff.table.createdAt": "Created",
  "staff.table.actions": "Actions",
  "staff.table.empty":
    'No staff accounts yet. Use "Add staff" in the top right corner.',
  "staff.table.self": "You",
  "staff.footer.count": "{{count}} staff accounts · sorted by role priority",
  "staff.footer.security":
    "Keep at least one super admin; you cannot delete or demote yourself",
  "staff.matrix.title": "Permission matrix",
  "staff.matrix.hint":
    "Menus, pages and APIs share one matrix (src/lib/rbac.ts)",
  "staff.form.eyebrow": "Staff account",
  "staff.form.createTitle": "Add staff",
  "staff.form.editTitle": "Edit staff",
  "staff.form.username": "Username",
  "staff.form.usernamePlaceholder": "e.g. finance01",
  "staff.form.usernameHint":
    "3–32 characters: letters, digits, underscore, dot or hyphen",
  "staff.form.usernameLocked":
    "The username cannot be changed after creation",
  "staff.form.password": "Password",
  "staff.form.passwordPlaceholder": "At least {{min}} characters",
  "staff.form.passwordCreateHint":
    "{{min}}–{{max}} characters, share it with the staff member privately",
  "staff.form.passwordEditHint": "Leave blank to keep the current password",
  "staff.form.role": "Role",
  "staff.form.roleLocked":
    "You cannot change your own role, ask another super admin",
  "staff.form.createSubmit": "Create staff",
  "staff.form.saveSubmit": "Save changes",
  "staff.form.error.username":
    "Username must be 3–32 letters, digits, underscore, dot or hyphen",
  "staff.form.error.password":
    "Password must be between {{min}} and {{max}} characters",
  "staff.form.error.saveFailed": "Save failed, please try again later",
  "staff.banner.created": "Staff account created",
  "staff.banner.saved": "Staff account updated",
  "staff.banner.deleted": 'Staff "{{name}}" deleted',
  "staff.confirm.delete":
    'Delete staff "{{name}}"? The account loses access immediately and this cannot be undone.',
  "staff.error.deleteFailed": "Delete failed, please try again later",
  "staff.error.deleteNetwork": "Network error, delete failed",
  "staff.error.selfDelete":
    "You cannot delete the account you are signed in with",
};

for (const [file, additions] of [
  ["src/locales/zh.json", zh],
  ["src/locales/en.json", en],
]) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const overwritten = [];
  const added = [];

  for (const [key, value] of Object.entries(additions)) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      overwritten.push(key);
    } else {
      added.push(key);
    }

    data[key] = value;
  }

  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  console.log(
    `${file}: +${added.length} new, ${overwritten.length} overwritten${
      overwritten.length ? ` -> ${overwritten.join(", ")}` : ""
    }`,
  );
}

