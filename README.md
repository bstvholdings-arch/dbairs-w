This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## 环境变量与数据库自检

`.env` 必须提供 `DATABASE_URL`（应用运行用）与 `DIRECT_URL`（直连，供 prisma migrate 使用）。

改完连接串先跑一次自检，确认密码 / 网络没问题：

```bash
npm run db:check
```

脚本会把连接串打码打印（不泄露密码）并真实连一次库；认证失败、Supabase 熔断（`ECIRCUITBREAKER`）等常见错误会直接给出处理建议。

> Supabase 的 Supavisor 连接池**必须走 TLS**：连接串里没有 `sslmode` 时，`pg` 会以明文握手，Supavisor 会把它当成「密码不正确」（报 `28P01 credentials not valid`），连续失败后还会触发 `ECIRCUITBREAKER` 临时封禁。
> `src/lib/database-url.ts` 会自动剥掉复制时带进来的引号/空格，并给 `*.supabase.com` 补上 `uselibpqcompat=true&sslmode=require`（加密链路但不校验 CA，兼容代理/网关替换证书的环境），所以 `.env` 里不写 sslmode 也能连上。

数据库不可用时前台会自动回退到内置游戏目录，页面照常打开。兜底日志统一走 `src/lib/data-fallback-log.ts`：开发环境降级成 `console.debug`（只在终端里留排查线索，不会点亮 Next.js 左下角的红色 issues），生产环境仍然是 `console.error` 写进服务端日志。

## 商户后台（Tenant Console）与数据隔离

商户账号（`role=tenant_admin`）只允许进入 `/tenant/...`：

| 路由 | 模块 | 数据范围 |
| --- | --- | --- |
| `/tenant/dashboard` | 数据概览（玩家数 / 总充值 / 总提现 / GGR / 平台应扣服务费） | `where: { tenantId }` |
| `/tenant/players` | 玩家管理（搜索 / 详情 / 封号解封） | `where: { tenantId }` |
| `/tenant/kyc` | KYC 审核（查看证件 / 通过 / 驳回需填原因） | `where: { tenantId }` |
| `/tenant/finance` | 财务流水（入金 / 出金，只读） | `where: { tenantId }` |
| `/tenant/ai-logs` | AI 客服监控（玩家与 AI 客服的对话） | `where: { tenantId, agentType: "support" }` |
| `/tenant/settings` | 站点设置（皮肤主色 / 大厅模块开关） | `where: { id: tenantId }` |

隔离规则：

1. `src/proxy.ts` 把 `/admin` 与 `/tenant` 彻底分区：`tenant_admin` 访问 `/admin/*` 会被 307 送到 `/tenant/dashboard`，访问平台 `/finance` 会被送到 `/tenant/finance`；
2. 所有商户接口在 `src/lib/tenant-console.ts` 里统一查询，**每个 where 都强制带 `tenantId`**，且 `tenantId` 只来自登录会话（`AdminUser.tenantId`），不接受任何前端参数；
3. 同租户子表查询使用 `{ tenantId, playerId }` 双条件，别的商户的 id 一律等价于「不存在」（404）。

AI 客服对话需要给 `AiChatLog` 补租户字段（一次性增量脚本，可重复执行）：

```bash
npx prisma db execute --file prisma/tenant-ai-chat-logs.sql
npx prisma generate
```

玩家侧客服弹窗（`src/components/lobby/support-chat-dialog.tsx`）会调用 `/api/player/support/chat`：
服务端按 `src/lib/support-chat.ts` 的同一份关键词表生成回复，并把 user / assistant 两条消息写入
`AiChatLog`（带 `tenantId`、已登录玩家带 `playerId`，访客 `playerId` 为空），商户后台即可在自己的
`/tenant/ai-logs` 看到这些对话；平台侧的招商 AI 日志 `tenantId` 为空，永远不会出现在商户后台。

### KYC 实名认证

- 玩家端：`/player/kyc`（个人中心「钱包」「安全」两个 Tab 都有入口）。未通过时钱包页顶部提示「请完成实名认证以解锁提现」；
- 图片：上传接口 `/api/player/kyc/upload` 只写本地私有目录 `.kyc-storage/`（已 gitignore），数据库存受控路径 `/api/player/kyc/files/<key>`；玩家只能读自己的，商户通过 `/api/tenant/kyc/files/<key>` 读本租户提交的。**生产环境请替换成对象存储 + 5-15 分钟签名 URL**（改 `src/lib/kyc-storage.ts` 即可，业务代码不动）；
- 提现闸门：`POST /api/withdrawal/create` 在余额判断之前校验 `PlayerKyc.status === "APPROVED"`，否则返回 403 + `code: "kyc_required"`（文案「请先完成实名认证」）；
- 审核：`/tenant/kyc` 列表只显示脱敏证件号，点「查看详情」才按 id 拉完整资料；通过 / 驳回都会写 `reviewedById` 与 `reviewedAt`，驳回必须填原因（≤200 字），玩家可重新提交并回到 `PENDING`；
- 表结构：`PlayerKyc` + `enum KycStatus` 与 `prisma/schema.prisma` 一致。`npx prisma db push` 正常时优先用它；CLI 连不上库时可执行增量脚本：

```bash
npx prisma db execute --file prisma/tenant-kyc.sql
npx prisma generate
```

### 玩家注册 / 登录（手机号 + 邮箱）

- 注册字段：`username` / `password` / `phone` / `email` **全部必填**，任一不合法直接 400；
- `phone` 必须带国际区号（注册页下拉框：`+60` 马来西亚（默认）、`+65` 新加坡、`+62` 印尼、`+63` 菲律宾、`+84` 越南、`+86` 中国）；
  服务端用 `src/lib/player-validation.ts` 的同一份规则归一化成 E.164（`+60123456789`）再入库，
  名单内的区号还会校验该国本地号码位数（如 `+65` 必须 8 位、`+86` 必须 11 位）；
- 唯一性：同一租户内 `username` / `phone` / `email` 三者都不重复，数据库层面是
  `@@unique([tenantId, username])` / `@@unique([tenantId, email])` / `@@unique([tenantId, phone])`，
  接口层先查库给出精确提示（`username_taken` / `email_taken` / `phone_taken`），唯一索引兜底并发注册；
- 登录：账号框可填 **用户名 / 手机号 / 邮箱** 任意一个（含区号或只填本地号码都可以），
  后端用 `OR` 一次性匹配多个候选后再用 bcrypt 校验密码，多个候选同时命中时以「密码对得上的那个」为准；
- 表结构变更（`Player.phone`、`AdminUser.phone` + 两个复合唯一索引）与 `prisma/schema.prisma` 一致。
  `npx prisma db push` 正常时优先用它；CLI 连不上库时执行增量脚本：

```bash
npx prisma db execute --file prisma/player-contact-fields.sql
npx prisma generate
```

- 商户后台可在 `/tenant/players` 按手机号搜索、在玩家详情看到手机号；玩家中心「安全」Tab 也会显示已绑定的手机号。

### 创建 / 重置商户老板账号

商户账号不能通过 `/admin/staff` 创建（那里只允许平台员工角色），用命令行工具：

```bash
npm run tenant:admin -- --tenant winvora --username boss --password 'ChangeMe#2026'
# 可选：同时绑定联系手机号 / 邮箱（同一租户内唯一）
npm run tenant:admin -- --tenant winvora --username boss --password 'ChangeMe#2026' \
  --phone +60123456789 --email boss@winvora.com
```

- `--tenant` 支持 租户 id / 域名 / 子域名 / 品牌名；
- `--phone` / `--email` 选填，会写入 `AdminUser.phone` / `AdminUser.email`；
- 账号不存在会新建 `tenant_admin` 并绑定该租户；
- 账号已存在且属于同一租户时只重置密码；角色或归属不同则直接报错退出。

### 在后台给商户分配管理员账号（推荐）

`/admin/tenants` 列表 →「新增租户」时必填「商户管理员邮箱」（保存即开通账号并发开通邮件，见下节）；
已有租户则在「编辑」里填写同一字段补建账号：

- 保存时自动创建 `role=tenant_admin` 账号并绑定该租户，账号的 `email` 就是填写的邮箱；
- 登录账号由邮箱前缀派生（`boss@brand.com` → `boss`），重名时自动加 `-2`、`-3`…，保证全局唯一；
- 临时密码 14 位（大小写 + 数字 + 符号，剔除 `0/O/1/l/I` 等易混字符），**只在弹窗里显示一次**，数据库只存 bcrypt 哈希；弹窗提供「复制账号密码」，关闭后无法再查看，只能重新分配；
- 同一邮箱重复保存不会重置密码，只提示「该邮箱已是本租户的管理员」；邮箱已被其他租户 / 平台员工占用时提示冲突，但租户资料照常保存；
- 登录页账号框填 **邮箱或用户名** 都能登录（`POST /api/auth/login` 会依次用两个候选做 bcrypt 校验）；商户请使用独立入口 `/tenant/login`；
- 列表「管理员」列展示已绑定的账号，未分配时显示「未分配管理员」。

### 新增租户：自动开通商户账号 + 邮件通知

`/admin/tenants` →「新增租户」弹窗里的「商户管理员邮箱」是**必填项**。保存时 `POST /api/admin/tenants`
在**同一个 Prisma 事务**里完成两件事：

1. 创建 `Tenant`（品牌名 / 域名 / 子域名 / 出金审批人数 / 默认套餐）；
2. 创建 `role=tenant_admin` 的 `AdminUser`，`tenantId` 指向刚建好的租户，`email` 用填写的邮箱，
   `username` 取邮箱前缀（`boss@brand.com` → `boss`，重名自动加 `-2`、`-3`…），密码 14 位随机 + bcrypt 哈希。

任何一步失败都会整体回滚（不会留下「租户建好了但没人能登录」的孤儿数据），并把明确原因返回给弹窗：

| 情况 | 返回 |
| --- | --- |
| 没填邮箱 | `400`「商户管理员邮箱不能为空：系统需要用它创建商户账号并发送登录邮件」 |
| 邮箱格式不对 | `400` |
| 邮箱已被其他租户 / 平台员工占用 | `409` |

事务**提交之后**才发邮件（发信失败不会回滚已经建好的账号），接口返回：

```json
{ "tenantAdmin": { "status": "created", "username": "boss", "email": "boss@brand.com", "temporaryPassword": "…", "emailSent": true } }
```

`emailSent = false` 时弹窗提示「账号已创建，但登录邮件发送失败」，并继续显示一次性临时密码，由超管手动转达。
编辑租户时补建账号（`PUT /api/admin/tenants/[id]`）走同一套逻辑，同样会发邮件。

### 邮件通知服务（src/lib/mailer.ts）

默认 `MAIL_PROVIDER=console`：**不真的发信**，只在 `npm run dev` / `next start` 的终端里打印完整邮件
（收件人 / 主题 / 正文），方便本地联调。

| 变量 | 作用 |
| --- | --- |
| `MAIL_PROVIDER` | `console`（默认）/ `resend` / `nodemailer`（预留） |
| `RESEND_API_KEY` | `resend` 通道密钥（纯 `fetch` 调用官方接口，无需安装 SDK） |
| `MAIL_FROM` | 发件人，如 `DBAIRS <no-reply@yourdomain.com>` |
| `APP_BASE_URL` | 邮件里的站点地址，默认取 `NEXT_PUBLIC_APP_URL`（`http://localhost:3000`） |

Nodemailer 通道留了接入位置（`sendWithNodemailer`，注释里写了要补的 `SMTP_*` 环境变量与
`createTransport` 写法）；在装上 `nodemailer` 之前它只打印到终端并明确返回失败，避免误以为邮件已发出。

邮件正文包含：商户后台登录地址（`${APP_BASE_URL}/tenant/login`）、玩家前台网址、管理员邮箱、
登录账号、初始密码，以及「登录后请立即修改密码」。

### 商户独立登录页 /tenant/login

- 平台员工用 `/login`，商户老板用 `/tenant/login`（开通邮件里给的就是这个地址）；
- 配色与主登录页一致，登录成功后**强制跳转** `/tenant/dashboard`，不接受 `next` 参数；
- 请求体带 `portal: "tenant"`：服务端发现账号不是 `tenant_admin` 直接 `403`
  （「该入口仅限商户管理员账号登录，请前往平台登录页 /login」），避免「平台员工登录后被
  proxy 立刻踢回 /admin」的怪异跳转；
- `src/proxy.ts` 把 `/tenant/login` 列为公开路径；已登录的商户再访问它会 307 回 `/tenant/dashboard`；
- 为了让登录页不被商户后台外壳（侧边栏 / 登录校验 layout）包裹，控制台页面整体搬进了路由组
  `src/app/tenant/(console)/`，**对外 URL 不变**（`/tenant/dashboard`、`/tenant/players` …）。

### 超管一键进入商户后台（代登录 / impersonation）

`/admin/tenants` 每行的「进入后台」按钮 → `GET /api/admin/impersonation/start?tenantId=<id>`：

- 校验 `super_admin` 且租户存在后，签发一张 **2 小时** 的代登录票据（`src/lib/impersonation.ts`：JWT，`kind=tenant_impersonation`，同时绑定 `adminId` 与 `tenantId`），写入独立的 httpOnly Cookie `dba_impersonate`，再 307 到 `/tenant/dashboard?impersonate=<id>&impersonated=1`；
- **不伪造、也不复制商户会话**：超管自己的 `token` Cookie 始终不变，商户侧能看什么完全由票据决定；票据换账号（`adminId` 不匹配）、过期、被篡改都会立即失效，退出后平台权限照旧；
- 代登录期间 `src/lib/tenant-console.ts` 的 `getTenantScopeFromCookies` / `guardTenantApi` 会把票据解析成带 `impersonation` 标记的 `TenantScope`，`src/proxy.ts` 据此放行 `/tenant/*` 与 `/api/tenant/*`；
- 页面顶部常驻安全横幅（`src/components/impersonation-banner.tsx`）：显示「操作人 + 目标商户」，点「退出代登录」调用 `DELETE /api/admin/impersonation`，只清票据并回到 `/admin/tenants`；
- 票据必须由 Route Handler 下发（Server Component 不能写 Cookie），所以入口是「先跳接口、再跳页面」；每次进入 / 退出都会在服务端打印 `[impersonate]` 审计日志。

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
