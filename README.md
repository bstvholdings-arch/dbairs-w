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

> **本地 404 / 白屏排障（先看这一条）**：`npm run dev` 与 `npm run build` **共用同一个 `.next` 目录**。
> 如果 dev server 正在跑的时候执行了 `npm run build`（或反过来），`.next` 里会混进
> `BUILD_ID` 等生产产物，浏览器随后就会大量 404（chunk 文件名对不上，页面白屏或报错）。
> 修复方式：停掉 dev → 删掉 `.next` → 重新 `npm run dev`（重新编译约 1 秒，别怕删）。
> 要验证生产构建，请用 `npm run build && npm run start`，并在另一个端口跑，别和 dev 抢。
>
> 裸 `http://localhost:3000/` 显示「站点不存在」是**另一回事**：那是 `requireStorefront()`
> 找不到租户（没有 `?tenant=`、域名不是任何租户的域名/子域名、没有会话），
> 在 `.env` 里配 `DEFAULT_TENANT=<子域名 | id | 域名>` 并重启 dev 即可，详见
> `src/lib/storefront-data.ts` 的 `warnUnresolvedStorefront`（dev 环境会把真实原因打在终端里）。

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

### 前台租户上下文：`?tenant=` → 域名 → 会话 → 代登录票据（找不到就 404）

同一个构建要同时服务 N 个白标站，所以「这次访问属于哪个租户」只能由 `src/lib/storefront-data.ts` 统一解析，玩家可见页面一律走 `requireStorefront()`：

1. `?tenant=<id | 子域名 | 域名>` —— 后台【预览前台】与联调用。**传了就必须命中，命中不了直接「站点不存在」，绝不回落到别家**；
2. 访问域名 / 子域名（`Tenant.domain`、`Tenant.subdomain`）—— 真正的白标访问；
3. 已登录的商户账号（会话里的 `tenantId`）；
4. 超管代登录票据（`dba_impersonate`，校验签名 + `adminId`）—— 代登录期间直接敲 `/` 看到的必须是**被代登录的那家**；
5. `.env` 的 `DEFAULT_TENANT`（可填 id / 子域名 / 域名）—— 唯一允许的「本地默认站点」显式配置；
6. 全部落空 → `notFound()` 渲染 `src/app/not-found.tsx` 的「站点不存在 / Site not found」。

配套约束：

- 代码里**不允许**再出现 `winvora` 之类的商户名当兜底；`resolvePlayerTenant()`（注册 / 登录）同样删掉了「库里最早创建的租户」兜底，拿不到租户就返回 `tenant_unavailable`；
- 商户后台 Header 的【预览前台】跳的是 `/?tenant=<subdomain 优先，没有则 id>`（`ConsoleShell` 的 `previewTenantKey`，由 `tenant/(console)/layout.tsx` 下发）；平台后台（`/admin`、`/finance` 平台范围）没有归属租户，**不渲染**这个入口；
- 预览模式下，大厅里所有站内跳转（品牌馆、登录 / 注册、玩家中心、返回大厅）都会自动带上 `?tenant=`，避免点进二级页丢掉上下文；
- 注意：`cacheComponents` 是流式渲染，`notFound()` 若在响应开始输出后才抛出，HTTP 状态会是 200 + `<meta name="robots" content="noindex">`（Next 官方行为，见 `node_modules/next/dist/docs/.../loading.md` 的 Status codes）。页面内容仍是「站点不存在」，不会被搜索引擎收录；需要严格 404 状态码时只能在 `proxy.ts` 里做（Edge 环境下没有数据库连接，本仓库没有这么做）。

本地切换商户 A / B 的前台：

```bash
# 1) 直连（不需要域名、不需要代登录）
http://localhost:3000/?tenant=abc      # 商户 A 的大厅
http://localhost:3000/?tenant=winvora  # 商户 B 的大厅
http://localhost:3000/?tenant=no-such  # → 站点不存在（不会再显示成别人家）

# 2) 后台入口：超管 /admin/tenants → 「进入后台」→ 商户后台顶部【预览前台】
#    新标签页地址形如 /?tenant=abc，顶栏 Logo / 名称 / 主色 / 选项卡标题都跟着走

# 3) 想直接打开裸 `/` 也能看到一个固定站点（仅限本地开发）：在 .env 里加
DEFAULT_TENANT=winvora
#    不配 = 裸 `/` 返回「站点不存在」，这是刻意设计，避免把陌生域名解析成别人的站
```

### 去中心化支付架构：商户自行对接支付商（平台只读监控）

包网平台**不再提供统一的收款网关**：收款的 API Endpoint、收款钱包地址与 API Secret 全部由商户自己在商户后台配置，平台既不代收也不再配置任何收款钱包，只负责监控商户的对接状态。

| 位置 | 变更 |
| --- | --- |
| `/admin` 左侧菜单 | 移除 **Payment Gateways**（`/admin/payments`）；平台后台不再有支付网关配置入口 |
| `/admin/payments`、`/api/admin/gateways` | 已整体删除（页面 + 审核弹窗 + CRUD 接口 + RBAC 规则） |
| `/admin/gateways` | 旧链接兼容：301 跳到 `/admin/integrations` |
| `/admin/integrations` → Payment Gateways 页签 | 唯一入口，默认**只读监控**：通道归属、对接状态、脱敏 API Key、「已接入 N/M 家商户」与历史平台通道计数；每行带【编辑】，仅供运维兜底修正（不改归属、不能新建） |
| `/tenant` 左侧菜单 | 新增 **支付网关 / Payment Gateway**（`nav.tenantPayments` → `/tenant/payments`），商户可自行进入 |
| `/tenant/payments` | 开放全部配置权限：新增 / 编辑（API Endpoint、收款钱包地址、API Secret）/ 启停 / 删除 |

| 接口 | 说明 |
| --- | --- |
| `GET /api/tenant/gateways/available` | 返回当前商户自己的通道（含已停用），供商户后台列表与编辑弹窗回填 |
| `POST /api/tenant/gateways` | 新增通道：归属强制绑定当前 `tenantId`，`isPlatformGateway=false`；**保存即生效**（`reviewStatus=APPROVED`、`isActive=true`），不再有平台审核环节 |
| `PUT /api/tenant/gateways/[id]` | 编辑配置；`apiKey` 留空 = 沿用原密钥（但仍以旧密钥参与完整性校验） |
| `PATCH /api/tenant/gateways/[id]` | 启停 `{ "isActive": boolean }`；启用前会重新跑 `validateGatewayConfiguration`，配置不完整直接 400 |
| `DELETE /api/tenant/gateways/[id]` | 删除；已有 `DepositOrder` 的通道返回 409，只能停用（对账 / 回调 / 上分都靠 `gatewayId` 回溯） |
| `GET /api/deposit/gateways` | **严格只读玩家所属商户的通道**（`ownerId = tenantId`）；返回 `merchantConfigured` 区分「商户未开通」与「通道暂时不可用」 |
| `POST /api/deposit/create` | 校验 `gateway.ownerId === player.tenantId`，平台通道（`isPlatformGateway` / `ownerId=null`）与别家商户通道一律 403 |
| `PATCH /api/admin/integrations/gateways/[id]` | **超管兜底修正**（Payment Gateways 页签的【编辑】）：只改 `name` / `currency` / `endpoint` / `walletAddress` / `apiKey`（留空 = 不改）/ `isActive`，与商户侧共用 `parseTenantGatewayInput` 校验；`ownerId`、`isPlatformGateway`、支付形态不可变更，也不能新建通道 |

- **玩家弹窗两种空态**：`merchantConfigured=false` → 「该商户暂未开通充值通道，请联系客服。」；有通道但全部停用 / 配置不完整 → 「当前没有可用的支付通道。」（`src/locales/zh.json` → `player.deposit.merchantNoChannels` / `player.deposit.noGateways`）。
- **无需改表**：`PaymentGateway` 已有 `ownerId` / `isPlatformGateway` / `reviewStatus`，本次只是改变了读写口径（平台通道不再参与收款）。
- **提现（代付）归属口径暂未下放**：`/api/player/withdrawal-gateways` 仍允许「平台历史通道 + 本商户通道」，避免存量代付通道立刻失效；但它已收窄为**纯法币 MYR → MYR**（非加密 + 币种等于 `Tenant.currency`），USDT 等跨币种通道不再出现在玩家端。后续可按充值同一模式把归属整体下放。
- **集成中心四个页签都是深链接**：`/admin/integrations?tab=global|providers|gateways|merchants`（`readIntegrationTab` 收敛非法值，统一回落到 `global`），页面内部切页签不触发路由跳转，未提交的 IP 白名单文本与搜索词不会丢。


### 充值（Deposit）全链路：下单 → 收款 → 回调验签 → 自动上分

| 接口 | 说明 |
| --- | --- |
| `POST /api/deposit/create` | 统一下单：校验玩家身份（玩家 Cookie / 商户代下单）、金额区间与网关可用性，落库 `DepositOrder(status=pending)`，返回 `orderNo` 与 `paymentInstructions` |
| `GET /api/deposit/gateways` | 收银台下拉数据：**只返回当前登录玩家所属商户（tenantId）自己配置的通道**（`isActive` + `ownerId = tenantId` + 校验通过），附 `merchantConfigured` 与 `amountLimits`；平台公用通道（`ownerId=null`）一律不返回。按形态额外下发：`REDIRECT_URL` 的 `supportedBanks`（银行编码）、`STATIC_QR` 的 `staticQrImageUrl`（仅 http(s) / 站内路径，base64 大图留到下单后） |
| `POST /api/deposit/callback/[gatewayCode]` | **真实支付商回调主入口**：`x-signature` 验签 → 按 `orderNo` 回查 → 状态幂等 → 金额核对 → 事务上分 |
| `POST /api/deposit/callback` | 旧版回调（按本系统订单主键 `orderId`，供历史联调脚本使用），与新接口共用同一份上分实现 |
| `POST /api/deposit/test-callback` | 前端「我已完成支付（测试）」，仅非生产环境 / `DEPOSIT_ALLOW_TEST_CALLBACK=true` 开放，复用正式状态机 |
| `POST /api/deposit/claim-paid` | 玩家点「我已付款，通知商家核对」：**只把订单挂进人工审核队列，不加钱**，仅对静态码 / 银行转账生效（这两类通道没有支付商回调，玩家不标记商户就看不到） |
| `PATCH /api/tenant/deposits/[id]` | 商户确认 / 驳回待人工审核的充值（`approve` = 上分 + 记账，`reject` = 置 failed 不动余额） |

- **订单号**：`DEP_<毫秒时间戳>_<6 位十六进制随机>`（`src/lib/deposit-order.ts`，`crypto.randomInt` 生成）。服务端生成、唯一索引兜底、撞号自动重试；第三方回调带回 `orderNo` 即可定位订单，历史订单仍可用主键 `id` 回查。
- **金额区间**：默认单笔 `10 ~ 50,000`，可用 `DEPOSIT_MIN_AMOUNT` / `DEPOSIT_MAX_AMOUNT` 覆盖；服务端 `parseDepositAmount` 为唯一口径，前端只做同口径提示。
- **收款指令**：`gatewayKind=CRYPTO`（`usdt_trc20` / `usdt_erc20` 或币种为 USDT）返回钱包地址 + 链网络 + 二维码内容；`gatewayKind=FIAT` 返回银行账号明细 / 静态收款图 / 跳转收银台地址。
- **回调四条防线**（`src/app/api/deposit/callback/[gatewayCode]/route.ts`）：
  1. 验签：`x-signature`（兼容 `x-pay-signature` / `x-gateway-signature`）= `hex(HMAC-SHA256(rawBody, gateway.apiKey))`，`apiKey` 即支付商后台的 `API_SECRET`；默认所有环境强制校验，可用 `PAYMENT_CALLBACK_REQUIRE_SIGNATURE=false` 仅在本机关闭；
  2. 防重放：订单已 `success` 直接 `replayed:true` 返回，绝不重复加钱；`failed` 拒绝再入账；`DepositOrder @@unique([gatewayId, txHash])` 挡住「同一交易号刷多单」；上分用 `updateMany({ where: { id, status: "pending" } })` 做数据库层 CAS，同一个订单回调 10 次只有抢到状态迁移的那一次会加钱；
  3. 金额核对：回调 `amount` 必须与数据库订单金额一致（Decimal 比较），**差 0.01 也拒绝**，不一致打印 `[ALARM][deposit-callback]` 结构化日志并拒绝入账；
  4. 静态码 / 银行转账**永不自动上分**：`gatewayRequiresManualReview()`（`src/lib/payment-gateway-constants.ts`）命中时，回调（含「我已完成支付」按钮走的旧入口）只调 `recordManualDepositCallback()` 把订单挂进人工审核队列（`status` 仍是 `pending` + `manualReviewStatus=pending`），回 `200 { manualReview: true }`，**一分钱都不加**；商户在 `/tenant/deposits` 核对银行流水后点【确认到账】才真正上分。原因：这两类通道的钱直接进商户自己的银行账户，系统拿不到「支付商已收款」的机器凭证，签名合法也证明不了到账。
- **上分事务**（`src/lib/deposit-settlement.ts`）：`updateMany({ where: { id, status: "pending" } })` 条件更新抢状态 → `Player.balance` 原子 increment → 写 `Transaction(type=deposit)` → 首充返佣，任一步失败整体回滚。人工确认走同一个 `settleDepositOrder`（额外带 `tenantId` + `requireManualReview`，CAS 里再加 `manualReviewStatus=pending`），所以「商户连点两次」「商户点了 + 支付商又回调一次」都不会加两次钱。
- **充值人工审核台**（`/tenant/deposits`，`PATCH /api/tenant/deposits/[id]`）：列出**静态码 / 银行转账的全部 `pending` 单**（含玩家付完就关页面、没点「我已付款」的「无信号」单，否则商户会漏单），每行标付款信号，侧边栏有金色待办角标。`approve` = 加余额 + 写充值流水（同一事务，CAS 保证只加一次）；`reject` = 置 `failed`，不动余额不写流水。`tenantId` 只来自会话，别家商户的单号一律 404；自动上分通道（REDIRECT_URL / DYNAMIC_QR）的单不允许从这里人工改单。上分用的 `txHash` 优先取回调带回的交易号，冲突时由 `@@unique([gatewayId, txHash])` 拦下（同一张银行流水不能登记到第二笔订单）。
- **前端弹窗**：`src/components/player/deposit-modal.tsx`（大厅黑金风格）。**界面按 `gatewayType` 分形态渲染**，不是「一律二维码 + 银行信息堆一起」：
  - `STATIC_QR` → 直接大图收款码 + 「请使用手机银行扫码支付」（商户配了远程图时**下单前**就展示，省掉一次点击）；
  - `REDIRECT_URL` → 先渲染银行卡片（Maybank / CIMB / Public Bank…，来自 `gateway.supportedBanks`）→ 输入金额 → 下单 → `window.location.assign(paymentUrl)` 整页跳转到支付商，**任何情况下都不渲染二维码**；
  - `BANK_TRANSFER` → 展示收款银行 / 户名 / 账号 + 逐行复制 + 一键复制全部，**任何情况下都不渲染二维码**；
  - `DYNAMIC_QR` → USDT 钱包地址 + 现场生成二维码，非 USDT 支付商则用接口下发的二维码内容。
  - 只有 1 条通道时**不渲染下拉框**（直接显示通道卡片 + 形态标签），多条通道才出下拉框。
- **银行白名单（REDIRECT_URL）**：`PaymentGateway.supportedBanks String[]`，唯一写入口是 `/tenant/payments` 的通道表单（内置银行勾选 + 「其他银行」手工补充，上限 20 家），归一化 / 校验 / 展示统一走 `src/lib/payment-gateway-banks.ts`。下单时 `POST /api/deposit/create` 用 `resolveDepositBankSelection()` 强制校验：列表非空却没选银行 / 选了不在列表里的银行一律 400，通过后把 `bank=<code>` 拼到支付商跳转地址上。列表为空 = 不做银行选择，交给支付商收银台。
- **通道费率与对账账本（只记账，绝不碰资金）**：商户在 `/tenant/payments` 的通道表单里填【通道费率 (Fee Rate %)】（`PaymentGateway.feeRate`，百分比，`2` = 2%，留空 = 0），下单时 `POST /api/deposit/create` 按**当时费率快照**把账算进订单：
  - `DepositOrder.feeAmount` = `amount × feeRate ÷ 100`（四舍五入到分）；
  - `DepositOrder.actualReceived` = `amount − feeAmount`（支付商结给商户的钱）；
  - **玩家余额永远只加 `amount`**：充 100 依然上分 100，通道费一分钱都不从玩家身上扣（平台不碰资金，只做账本）；
  - 口径唯一实现：`src/lib/deposit-fee.ts`（`calculateDepositFee` / `resolveDepositFeeBreakdown` / `parseGatewayFeeRatePercent`），服务端下单、历史单补账、弹窗实时预览、前端展示全部共用，**禁止**各写一份；
  - `/tenant/finance`（入金行）与 `/tenant/deposits`（审核台）在金额下面用小灰字显示 `通道费: 2.00 | 实际入账: 98.00`；本功能上线前的历史单两列都是 0，展示层按「全额入账」回落；
  - `tenantGatewayWriteData` 是「整对象覆盖」，`PUT /api/tenant/gateways/[id]` 与超管 `PATCH /api/admin/integrations/gateways/[id]` 漏传 `feeRate` 就等于把商户配好的费率清零，两处都已做「缺省沿用旧值」兜底。
- **表结构增量**：`prisma/deposit-order-no.sql`（幂等，补 `DepositOrder.orderNo` + 唯一索引）、`prisma/gateway-supported-banks.sql`（幂等，补 `PaymentGateway.supportedBanks`）、`prisma/deposit-manual-review.sql`（幂等，补 `DepositOrder.manualReviewStatus` / `callbackAmount` / `callbackTxHash` / `callbackReceivedAt` + 索引）、`prisma/gateway-fee-rate.sql`（幂等，补 `PaymentGateway.feeRate` + `DepositOrder.feeAmount` / `actualReceived` 并回填历史单）；`npx prisma db push` 正常时也可直接用 schema。

回调示例（`gatewayCode` 支持网关 `id`、`providerType` 或网关名称）：

```bash
BODY='{"orderNo":"DEP_1730000000000_A1B2C3","status":"success","amount":"100","txHash":"0xabc"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$API_SECRET" -hex | sed 's/^.* //')
curl -X POST "https://<host>/api/deposit/callback/usdt_trc20" \
  -H "Content-Type: application/json" -H "x-signature: $SIG" -d "$BODY"
```

### 提现（Withdrawal）全链路：玩家中心按钮 → 提单 → 代付回调扣款

| 接口 | 说明 |
| --- | --- |
| `GET /api/player/withdrawal-gateways` | 玩家提现弹窗的通道列表（**纯法币 MYR → MYR**）：只返回 `isActive` + `APPROVED` + （平台公用或本租户）+ **非加密（`usdt_*` 等一律排除）+ 币种等于 `Tenant.currency`** 的网关，附 `payoutCurrency`、`feeRate`（`payoutSellRate`）与 `amountLimits` |
| `POST /api/withdrawal/create` | 玩家提单：玩家 Cookie 身份 → KYC 闸门 → 金额区间 → 收款账号解析 → 纯法币通道 + 出款币种核对 → 可用余额校验 → **智能路由**（见下）→ 自动出款落 `processing` / 转人工落 `pending` |
| `POST /api/withdrawal/callback` | 代付商回调：`pending \| processing → success` 条件更新成功者才扣 `Player.balance` 并写 `Transaction(type=withdraw)`；`failed` 只改状态（实现见 `src/lib/withdrawal-settlement.ts`） |
| `PATCH /api/tenant/withdrawals/[id]` | 商户审批提现：`{ action: "approve" \| "reject" }`。`approve` 与代付回调**同一套 CAS 事务**（`pending → success` + 扣余额 + 写流水）；`reject` 只置 `failed`，不动余额；`processing`（自动出款在途）返回 409 拒绝人工介入。`tenantId` 只来自会话，别家单号一律 404 |
| `GET /api/tenant/payout-engine` | 自动出款引擎快照：开关/限额、今日已自动出款、剩余额度、是否熔断、各通道是否配了代付 API |
| `PATCH /api/tenant/payout-engine` | 保存自动出款配置：`{ isEnabled?, maxAutoAmount?, dailyAutoLimit?, payoutEndpoints?: [{ gatewayId, endpoint }] }`；代付地址只能写**商户自有通道**（`ownerId` 必须是本站、`isPlatformGateway=false`），非法地址 400、别家通道 404 |

#### 提现审批：商户后台一级菜单（`/tenant/withdrawals`）

- **入口就是一级菜单**：左侧导航「提现审批」（`nav.tenantWithdrawals`，图标 `withdrawal`），
  右侧带真实待审批笔数角标（`tenant/(console)/layout.tsx` → `countTenantPendingWithdrawals()` 下发，
  一次走 `(tenantId, status)` 索引的 count，失败回落 0，不拖垮控制台）。
  别把审批再塞进「财务」二级页签 —— 入口太深就是出款积压的直接原因。
- **页面 `src/app/tenant/(console)/withdrawals/`**：待审批单**全量不翻页**（上限 200 条保护），
  老单在前；每行两个显眼按钮「通过出款 / 驳回」；下方「最近已处理」10 条用于对账。
  收款账号走 `maskWithdrawalDestination()`（`src/lib/withdrawal-accounts.ts`，银行账号只留后 4 位）。
- **审批口径 `reviewTenantWithdrawal()`（`src/lib/tenant-console.ts`）**：
  `approve` = 已出款，与 `/api/withdrawal/callback` 完全同口径 —— 同一事务里
  `updateMany({ where: { status: "pending" } })` 抢状态迁移 → 条件扣 `Player.balance` → 写
  `Transaction(type=withdraw)`；抢不到迁移的请求（重复点击 / 代付回调同时到达）返回 409，
  **绝不重复扣款**。`reject` = `pending → failed`，不动余额、不写流水，玩家可重新提单。
  金额币种直接取单据上的 `Withdrawal.currency`（本站记账币种），不做任何换算。
- **财务页（`/tenant/finance`）只做账本**：金额改走 `formatDisplayAmount(value, currency)`（币种来自
  `Tenant.currency`，不再写死 `$`）；有待审批时顶部出现金色 CTA 直接跳到审批页。

#### 自动出款引擎（Auto Payout）+ 人工兜底：能自动就自动，不能自动就一定能人工

一句话口径：**有代付 API 且风控全过 → 自动打款；任意一项不满足 → 立刻进人工队列，人工按钮永远在。**

- **数据**：`Tenant.autoPayoutConfig`（`{ isEnabled, maxAutoAmount, dailyAutoLimit }`）、
  `PaymentGateway.payoutEndpoint`（商户自己的代付 API 地址，与收款 `endpoint` 是两条链路）、
  `Withdrawal.riskStatus`（路由原因快照）+ `Withdrawal.isAuto`。增量 SQL：`prisma/auto-payout.sql`（幂等）。
- **判定只写一次**：`src/lib/auto-payout.ts` 的 `evaluateAutoPayoutRoute()`（纯函数）+`evaluateWithdrawalRouting()`（查库版）。
  顺序是「先看有没有代付能力，再看商户策略，最后看风控」：
  `没有 payoutEndpoint → 开关关 → KYC 未通过 → 红利流水未打满 → 超单笔上限 → 当日额度熔断`，
  每条不满足都写一个 `manual_*` 原因，商户在审批台一眼看到「为什么这单没自动出」。
- **路由 A（自动）**：`status=processing + isAuto=true + riskStatus=auto_queued` → 立刻
  `POST {payoutEndpoint}`（`x-gateway-signature: sha256=HMAC-SHA256(rawBody, apiKey)`、`x-idempotency-key=提现单号`、
  15s 超时）→ 成功即 `settleWithdrawalSuccess()`（`processing → success` + 扣余额 + 写流水），
  失败则 `returnWithdrawalToManualReview()` 退回 `pending + riskStatus=auto_payout_failed`（**钱不动，商户一键 Approve 兜底**）。
- **路由 B（人工）**：`status=pending + isAuto=false`，进 `/tenant/withdrawals` 审批队列。
  `Approve（通过出款）` / `Reject（驳回）` 两个按钮对**每一条 pending 单无条件渲染** ——
  没有代付 API / 自动打款失败时，这两个按钮就是唯一出口，任何改动都不得把它们做成条件渲染。
- **熔断（防击穿）**：当日 `isAuto=true` 且 `status in (processing, success)` 的金额合计 ≥ `dailyAutoLimit` 时，
  本单直接转人工（判定用「已出 + 本单」比较，所以永远不会超发）；额度按**自然日**（服务器本地 00:00）重置，
  不需要定时任务去关开关。刻意偏保守：自动失败后被人工点掉的单也计入。
- **结算只写一次**：`src/lib/withdrawal-settlement.ts` 的 `settleWithdrawalSuccess()` / `markWithdrawalFailed()` /
  `returnWithdrawalToManualReview()` 是**代付回调、商户人工审批、自动出款引擎共用的唯一记账实现**，
  靠 `updateMany({ where: { status: { in: [...] } } })` 做数据库层 CAS，三条路径并发到达也只扣一次钱。
- **配置权限**：只有商户自己在 `/tenant/withdrawals` 的【自动出款引擎】面板能写（`PATCH /api/tenant/payout-engine`，
  `tenantId` 来自 `guardTenantApi` 会话）。代付地址只能挂在 `ownerId=本站 + isPlatformGateway=false` 的通道上 ——
  平台通道永远 `manual_no_payout_api`，钱不经过平台（与「去中心化支付」红线一致）。
- **在途可视**：`processing` 单单独一张「自动出款中」表，看得见但**不给审批按钮**
  （结果没回来就人工再点一次 = 重复出款），`reviewTenantWithdrawal()` 也会对 `processing` 返回 409。

- **按钮与权限**（`src/components/player/withdraw-button.tsx`）：玩家中心顶部余额右侧与 Deposit 并排；未实名 → 点击弹「Please complete identity verification first.」+ 去认证入口；可用余额 < 最低额 → 点击说明最低提现金额；两者都满足 → 金色高亮并打开提现弹窗。鼠标悬停 `title` 直接显示被拦原因。
- **黑金提现弹窗**（`src/components/player/withdraw-modal.tsx`）：提现通道下拉（通道名 + 后台维护的费率）→ 提现账号下拉（只列玩家已绑定、`accountType=bank` 且币种等于本站记账币种的账号，文案 `Maybank (1234) · 姓名`）→ 提现金额（最多两位小数）+「全部」→ 实时显示**预估手续费**与**预计到账**。没有可用银行账号时不出表单，只给「去绑定提现账号」。
- **纯法币、不做汇率换算**：金额 / 手续费 / 到账金额单位全部是 `Tenant.currency`（默认 MYR）。`src/lib/withdrawal-channels.ts` 是唯一口径：`calculateWithdrawalFee(amount, feeRate) = round2(amount × feeRate)`、`calculateWithdrawalReceive = amount − fee`，服务端与弹窗共用；通道列表与费率都由后台下发，前端不写死任何数字。
- **收款账号不由前端回传**：弹窗只提交 `{ gatewayId, accountId, amount }`；`accountId` 由服务端回查（校验 `playerId` + `tenantId`），法币拼成「银行 · 账号 · 持有人」写入 `Withdrawal.walletAddress`。列表接口里的银行账号是掩码，前端拿不到真实账号也改不了。
- **金额区间**：默认单笔 `10 ~ 1,000,000`，可用 `WITHDRAWAL_MIN_AMOUNT` / `WITHDRAWAL_MAX_AMOUNT` 覆盖；`parseWithdrawalAmount`（`src/lib/payment-gateway.ts`）是唯一口径，前端只做同口径提示。
- **可用余额 = 余额 − 在途提现单**：`pending`（人工待审）与 `processing`（自动出款中）都还没扣款，所以提单时必须用 `prisma.withdrawal.aggregate({ status: { in: inFlightWithdrawalStatusList() } })` 扣掉在途金额（集合定义只有一份：`src/lib/withdrawal-status.ts`），否则同一笔余额可以被连开多张在途单重复提走；超额返回 `409 insufficient_available_balance`。玩家中心同步展示 `summary.pendingWithdrawalAmount`。
- **币种一致性**：通道必须通过 `isFiatPayoutChannel()`（非加密 + 币种等于本站记账币种），否则 `400 channel_not_fiat`；`account.currency` 归一化后必须等于出款币种（`normalizePayoutCurrency`，脏数据 `RM` 视同 `MYR`），否则 `400 account_currency_mismatch`，避免 MYR 通道把钱打到 USDT 钱包。
- **前端遗留调用兼容**：`walletAddress` 仍然可用（商户代提 / 脚本），与 `accountId` 二选一。

#### 提现账号绑定：银行 / 支付方式用「带 logo 的自定义下拉」

- 原生 `<select>` 的 `<option>` 里放不下图片，玩家认不出收款银行，所以绑定表单改用
  `src/components/player/payout-method-select.tsx`（触发框 = logo + 名称，展开面板 = 左 logo 右名称 + 当前项打勾，
  点击面板外 / `Esc` 关闭，↑↓ / Home / End / Enter 可键盘操作）。
- 银行目录唯一事实来源是 `src/lib/payout-methods.ts` 的 `PAYOUT_METHODS`（FPX、Maybank、CIMB Bank、Public Bank、
  RHB Bank、Hong Leong Bank、Touch 'n Go eWallet、GrabPay、Boost），logo 自托管在 `public/banks/*.svg`，
  **不挂外站图床**（图床被墙 / 挂掉就是整排裂图），也不要在组件里散写图片地址。
- 落库值仍是「银行名称」纯文本（`PlayerWithdrawalAccount.bankName`），接口与表结构零改动；
  `findPayoutMethodByName()` 用别名（`MBB` / `Maybank2u` / `TnG` / `HLB`…）把历史手输值回填成「logo + 品牌名」，
  已绑定账号卡片也据此显示银行 logo。
- 玩家银行不在目录里 → 选最后一行「其他银行 / 手动输入」退化成文本框（`readBankName()` 口径不变），
  **不要**为了凑目录去改品牌名；logo 404 / 加载失败降级成黑金首字母方块（`payout-method-logo.tsx`）。

### 余额实时刷新 + 全站币种统一（RM / $ / ฿ / Rp）

提单只产生 `pending` 单（`Player.balance` 不变），但玩家看到的应该是**可用余额**，且符号必须来自租户配置——这两条是前端体验的硬要求：

- **唯一口径 `src/lib/player-balance.ts`**：`computeAvailableBalance(balance, pending)` / `availableBalanceToString(...)`；`availableBalance = balance − Σ(pending Withdrawal.amount)`，与服务端 `POST /api/withdrawal/create` 的判断完全一致。`src/lib/player-session.ts` 在解析会话时一次性查出 `pendingWithdrawalAmount` 与 `availableBalance`，所以 `/api/player/me`、大厅首屏、玩家中心拿到的是同一份数字。
- **大厅顶栏 BALANCE 显示可用余额**：`src/app/lobby-client.tsx` 顶栏用 `player.availableBalance`（充值成功时本地先按「新余额 − 在途」重算，避免等接口）。
- **跨页实时刷新 `src/lib/player-wallet-events.ts`**：提现 / 领取奖励成功后 `notifyPlayerWalletChanged()` 广播 `dbairs:player-wallet-changed`；大厅顶栏 `subscribePlayerWalletChanged(...)` 收到后立刻重新拉 `/api/player/me`。玩家中心自己再配合 `router.refresh()` 刷 Server Component，不需要手动刷新页面。
- **币种来自租户 `Tenant.currency`（默认 `MYR`）**：`src/lib/currency.ts` 是唯一符号表（MYR→`RM `、USD→`$`、USDT→`USDT `、THB→`฿`、IDR→`Rp `、VND 后缀 `₫`…），`formatCurrency(value, currency)` 输出形如 `RM 50.50`。**禁止**再写 `` `${formatAmount(x)}` `` 式的硬编码 `$`。
  - 玩家侧取值链：`PlayerSessionInfo.tenant.currency`（玩家中心）与 `StorefrontSettings.currency`（大厅，来自 `loadStorefront`）。
  - 已统一的位置：大厅顶栏 / Hero 奖池、玩家中心（顶部余额、可用余额卡、今日输赢、流水、充值/提现记录、注单、推广奖励、每日奖励）、提现按钮与弹窗、充值弹窗与支付页、`DepositDialog`。
  - 商户后台的财务流水（`/tenant/finance`）与提现审批（`/tenant/withdrawals`）已改走 `formatDisplayAmount`（币种取自 `Tenant.currency`）；平台视角的 `/admin` 汇总仍是 `$`，如需按租户币种请复用 `formatCurrency` 逐步替换。
- **表结构增量**：`prisma/tenant-currency.sql`（幂等，`ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "currency"`，默认 `MYR`）；正常 `npx prisma db push` 会自动建列，只跑 SQL 的环境可用 `npm run db:sql prisma/tenant-currency.sql`，随后 `npx prisma generate`（Supabase 连接池上 `db push` 有时会卡在 shadow database，这条路径更稳）。

### 法币专精：加密通道从源头断绝 + 开户国家锁定结算币种

老板点名的最后一条产品口径，四条硬规则（改代码前先读 AGENTS.md §13）：

- **只做法币**：加密货币（USDT / TRC20 / ERC20…）**永久禁用**。判定只有一份 `isFiatGatewayChannel()`（`src/lib/payment-gateway-constants.ts`），四个落点共用：`GET /api/deposit/gateways` 不下发、`POST /api/deposit/create` 造不出单（409）、`parseTenantGatewayInput()` 拦住商户后台新增 / 编辑（400）、玩家端充值 / 提现弹窗再兜底过滤一次。商户后台的「支付商」下拉只剩 `FIAT_GATEWAY_PROVIDER_TYPES`；编辑历史 USDT 通道会看到 `disabled` 占位项 + 红字提示，改成法币支付商才能保存。
- **开户国家 `Tenant.country` 联动锁定结算币种**：超管在【租户管理 → 新建 / 编辑】只选国家（马来西亚 / 泰国 / 印尼 / 越南 / 新加坡 / 印度 / 澳洲 / 香港 / 美国），币种由 `src/lib/tenant-country.ts` 的 `TENANT_COUNTRIES` 自动决定（MY→MYR、TH→THB、ID→IDR、VN→VND…），弹窗里只读展示（`RM · MYR`）。前端不传 `currency`，编辑时**只有国家真的变了才写币种** —— 老租户 `country` 是缺省 MY、币种可能是历史值，同值提交绝不能把 MYR 写进去。
- **玩家端符号永远来自 `Tenant.currency`**：`formatCurrency` / `formatDisplayAmount` 是唯一出口；充值弹窗在「还没有通道」时的兜底单位也回落到本站币种（历史上写死的 `?? "USDT"` 已删除）。
- **迁移顺序（缺一步就报错）**：`npx prisma db push`（新增 `country`，纯加成）→ `npm run db:sql prisma/tenant-country.sql`（按已有币种回填老租户国家）→ `npx prisma generate` → 重启 dev server。

### 前台排版模板（一套组件 + 5 组 layout token）

`/admin/storefront` 支持 5 种前台排版：`classic`（经典大厅）/ `cinema`（巨幕影院）/ `compact`（紧凑信息流）/ `bento`（卡片拼贴）/ `editorial`（双栏画报）。

- **一套组件，5 组 token**：模板定义在 `src/lib/storefront-presets.ts`（内容区宽度 / 模块间距 / 主视觉高度 / 面板圆角 / 卡片间距 / `mode`）；大厅组件树、数据流只有一份，**不存在 5 套独立布局**。
- **消费方式**：大厅根节点挂 `data-storefront-preset` + `--sf-shell-max` / `--sf-module-gap` / `--sf-hero-h(-sm/-lg)` / `--sf-panel-radius` / `--sf-game-gap`；组件用 `var(--sf-xxx, 默认值)` 取值。`bento` / `editorial` 的分栏规则在 `src/app/globals.css` 末尾（仅 `≥1024px` 生效，用 `:has()` 判断 Hero 是否存在，关掉 Hero 自动退回堆叠）。顶栏壳宽、Hero / 功能岛 / 品牌墙圆角、游戏网格间距**全部**只吃这几个 `var()`（禁止写死像素值），所以 2K / 4K 超宽屏不会错位、iPhone SE（320px）也不会撑破；品牌展馆 `/provider/[code]` 挂同一份 token，点进品牌馆不会「换个版式」。
- **存储**：`Tenant.layoutConfig.preset`（JSON 内字段，无需迁移）；老数据缺 `preset` 自动回落 `classic`，外观不变。保存仍走 `PUT /api/admin/storefront`（服务端逐字段归一化，脏值回落 `classic`）。
- **解耦红线**：模板只管排版；配色仍只由 `Tenant.themeColor` 决定，模块开关与顺序仍只由 `Tenant.layoutConfig.modules` 决定。

### 游戏封面风格（一套 GameCard + 3 组 token）

游戏封面风格由平台在**开站时**决定：入口是超管 `/admin/tenants` 的新建 / 编辑租户弹窗【Game Card Cover Style（游戏封面风格）】。它控制玩家大厅与品牌展馆的游戏卡片外观：

| 风格 | id | 视觉 |
| --- | --- | --- |
| 赛博霓虹（默认） | `cyberNeon` | 深色底 + 悬停青 / 粉双色荧光 + 高对比渐变 |
| 黑金尊享 | `royalGold` | 纯黑底 + 极细暗金边框 + 悬停金属扫光 + 全金文字 |
| 糖果明亮 | `candyPop` | 浅色糖果渐变 + 加宽圆角白边 + 深色文字，无扫光 |

- **一套组件，3 组 token**：token 表在 `src/lib/game-card-styles.ts`（`frame` / `texture` / `hairline` / `scrim` / `edge` / `title` / `provider` / `online` / `hot` / `sweep` / `play` / `veil` + `build(art)` 生成随卡片主色变化的渐变），组件只有 `src/components/lobby/game-card.tsx` 一份，卡片上带 `data-game-card-style="<id>"` 便于排查。
- **存储**：`Tenant.layoutConfig.gameCardStyle`（JSON 内字段，无需迁移）；老数据缺字段回落 `cyberNeon`（改造前外观不变）。
- **写入入口唯一**：`POST /api/tenants`、`PUT /api/tenants/[id]`。商户后台（`PATCH /api/tenant/settings`）与 `/admin/storefront` 都会**显式丢弃**该字段：装修页的【游戏封面风格】只读展示 + 跳转入口，`/api/admin/storefront` 的写白名单已剔除并 `delete layoutPatch.gameCardStyle`。
- **生效链路**：`normalizeStorefrontLayout` → `StorefrontSettings.gameCardStyle` → `LobbyClient` / `ProviderHallClient` 把 `style` 传给 `GameCard`。
- **AI 销冠发 Demo**：`buildGameCardStylePreviewGuide()` 把 3 个预览链接注入销冠的 System Prompt（链接域名跟随当前请求头，兜底 `APP_BASE_URL`）；预览页 `/demo/game-card-styles` 直接渲染真实 `GameCard`，不是截图。本地规则兜底（`src/lib/ai/fallback.ts`）也认「风格 / 皮肤 / 封面」关键词，同样发链接。
- **解耦红线**：风格不碰整站主色（`Tenant.themeColor`）与排版模板（`layoutConfig.preset`），三者互不影响。

### AI 助手喂养（知识库 RAG + 实时数据 Function Calling）

- **喂知识**：`/admin/ai-console` 的 FAQ 抽屉按 `agentType` 维护 `AgentFaq`（`tenantId=null` 为平台级，指定商户时可同时命中平台级 + 商户级）。`src/lib/ai/faqs.ts` 的 `findRelevantAgentFaqs()` 先 `contains` 召回候选、再按命中位置加权排序，最多注入 3 条（`buildFaqSystemPrompt()`）。
- **喂数据**：余额 / 注单 / 充提 / KYC 这类**实时数据不进 Prompt**，由模型发起 Function Calling，服务端在租户作用域内查库后回填（工具契约 `src/lib/ai/prompts.ts`，执行 `src/app/api/ai/chat/route.ts`，现有示例 `save_lead_failure_reason`）。
- **边界**：工具只读、白名单、必须带 `tenantId`；不提供改余额 / 审批出金 / 改配置的写工具；返回脱敏，不向用户暴露工具名与 System Prompt。

#### 只读数据工具 + 租户隔离（`src/lib/ai/tools.ts`）

| 工具 | 作用 | 返回 |
| --- | --- | --- |
| `get_player_balance` | 查某玩家余额 | `balance` / `pendingWithdrawalAmount` / `availableBalance` / `currency` |
| `list_recent_transactions` | 最近充提 / 下注流水（可按玩家、类型筛选，最多 20 条） | `items[]`（不含 `txHash`） |
| `get_ticket_status` | 按注单 ID / 上游单号查结算状态 | `betAmount` / `payoutAmount` / `status`（不含 GGR、点差） |

- **范围只来自会话**：`resolveAiToolScope()` 用登录会话算 `AiToolScope`。商户账号只能用 `AdminUser.tenantId`；平台账号必须显式选择商户（`/api/ai/chat` 的 `tenantId`），没选就不下发任何数据工具。
- **三道闸门**（顺序即安全顺序）：`AiToolScope` 为空 → 403 → 工具不在白名单 → 403 → 参数里出现别家 `tenantId`/`tenant`/`merchantId` → 403（都不查库）；只有全部通过才按 `where: { tenantId }` 查询。
- **跨租户结论**：按 ID 查到的记录归属不符 → 403；在当前租户内查不到 → 404（不做「是不是别家的」回查，避免用报错差异探测别家数据）。
- **对话循环**：`/api/ai/chat` 已改成通用工具循环（模型 → 执行 → 回填 → 再补全），最多 `AI_TOOL_MAX_ROUNDS=2` 轮；本地规则兜底时只执行工具、不再多调一次模型。
- **接口守卫统一**：`/api/tenant/*` 全部走 `guardTenantApi`（支付网关 3 个接口也已改造，同时支持超管代登录）；页面菜单、proxy、路由内复核共用 `src/lib/rbac.ts` 一套矩阵。
- **回归测试**：`npm run ai:isolation:check`（`scripts/check-ai-isolation.ts`）直接断言上面三道闸门 + 脱敏 + 工具下发，共 19 项，任一项失败即退出码 1。只读、不调模型、不需要 API Key，只依赖 `DATABASE_URL`（需 ≥2 个租户，否则直接失败而不是跳过）。改过 `src/lib/ai/tools.ts` 或任何 `where` 条件后跑一遍——红了就是漏风了。刻意**不**并入 `npm run check`：它要连库，塞进去会让无库环境（CI / 新克隆）假红。

### Telegram Bot 多群组接入（Webhook + `/命令` 多助手路由）

全平台只跑 **1 个 Bot**，同时服务多个商户群 + 平台内部群。群聊里直接问技术 / 财务 / 运营问题，
由对应的 AI 助手在群里值班；`/tech`、`/finance` 这类指令切换接待的助手。

| 文件 | 职责 |
| --- | --- |
| `src/app/api/telegram/webhook/route.ts` | Webhook 入口（`POST`，只接受 Telegram 回调；`GET` 仅探活） |
| `src/lib/telegram/dispatch.ts` | 编排：验签 → 解析 → 认群 → 幂等 → 路由 → 回复 |
| `src/lib/telegram/bindings.ts` | **认群**（`chat_id` → 商户 / 平台）+ 会话状态读写 |
| `src/lib/telegram/routing.ts` | 指令解析与路由决策（纯函数，脚本可断言） |
| `src/lib/telegram/agent.ts` | 调用 AI 助手（复用后台 AI 管线的同一套下游） |
| `src/lib/telegram/prompt.ts` | 把「商户群 / 平台群」作用域追加进 System Prompt |
| `src/lib/telegram/bot-api.ts` | `sendMessage`（只发纯文本，不打印带 token 的 URL） |
| `src/lib/telegram/constants.ts` / `types.ts` | 助手白名单、默认助手、文案、Update 解析 |

- **群身份只认 `chat_id`**：`Tenant.telegramChatId` = 商户专属群（`@unique`，数据范围强制锁定该 `tenantId`）；
  `AdminUser.telegramChatId` = 平台内部群（必须同时满足 `tenantId IS NULL` 且 `role = super_admin`）。
  两边都没命中 → 只回「⛔ 未授权群组，请联系平台客服。」，**不查任何业务表、不调用模型**。
- **助手白名单**：商户群 `support`（默认）/ `tech` / `finance`；平台内部群再加 `sales` / `audit` / `strategist`。
  在商户群发 `/sales` 会被拒绝（不能靠一条指令越权拿到平台助手）。
- **上下文隔离**：`AiChatLog.telegramChatId` + `agentType` + `TelegramChatSession.contextStartedAt`
  三段过滤，群聊历史与后台 AI 控制台互不可见，`/reset` 只移动上下文起点（不删历史，审计可回溯）。
- **幂等**：`TelegramChatSession.lastUpdateId` 用 `updateMany` 做 CAS（`IS NULL OR < 本次`）。
  Telegram 没收到 200 会重投，同一条群消息只会被回答一次，绝不重复扣模型额度。
- **群聊只读**：群消息没有线索上下文，写工具（`save_lead_failure_reason`）一律不下发；
  实时数据仍靠只读工具在租户作用域内查（见上一节）。

环境变量（缺 `TELEGRAM_WEBHOOK_SECRET` 时接口 fail-closed 返回 503，一条回调都不接）：

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...        # BotFather 给的 token
TELEGRAM_WEBHOOK_SECRET=换成随机串        # setWebhook 的 secret_token，必须一致
# TELEGRAM_API_BASE_URL=                 # 可选，本机联调指到 mock 时用
```

一次性接线（**绑定是运维操作，不在代码里做**）：

```bash
# 1) 表结构（幂等，可重复执行）
npm run db:sql prisma/telegram-bot.sql
npx prisma generate   # 不跑这一步旧的内存客户端看不到新列，Webhook 直接 500

# 2) 把群绑到商户（群 id 为负数，从 @getmyid_bot / getUpdates 里拿）
#    UPDATE "Tenant" SET "telegramChatId" = '-1001234567890' WHERE subdomain = 'abc';

# 3) 把平台内部群绑到超管（必须是 tenantId 为 NULL 的 super_admin）
#    UPDATE "AdminUser" SET "telegramChatId" = '-1009876543210'
#     WHERE role = 'super_admin' AND "tenantId" IS NULL LIMIT 1;

# 4) 注册回调
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<域名>/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message"]'

# 5) 群里发 /help 自检
```

群内指令：

| 指令 | 作用 |
| --- | --- |
| 直接发消息 | 由当前助手接待（默认综合客服），不用加指令 |
| `/support` `/tech` `/finance` | 切换助手（平台内部群另有 `/sales` `/audit` `/strategist`） |
| `/agent` | 查看当前接待的助手与本群可用列表 |
| `/reset` | 清空当前助手的群聊上下文（只移动起点） |
| `/help` | 帮助 |

> 群里指令带 `@BotName` 后缀（`/tech@DbaBot`）也能识别；未知指令回帮助而不是静默丢弃。
> 绑定前请确认 `Tenant.status = 'active'`：停用站点命中 `telegramChatId` 也按「未授权」处理。

回归测试（只读，不联网、不需要 Bot Token，共 35 项）：

```bash
npm run telegram:check
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
