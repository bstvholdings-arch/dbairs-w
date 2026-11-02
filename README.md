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
- **提现（代付）暂未改动**：`/api/player/withdrawal-gateways` 仍允许「平台历史通道 + 本商户通道」，避免存量代付通道立刻失效；后续可按同一模式整体下放。
- **集成中心四个页签都是深链接**：`/admin/integrations?tab=global|providers|gateways|merchants`（`readIntegrationTab` 收敛非法值，统一回落到 `global`），页面内部切页签不触发路由跳转，未提交的 IP 白名单文本与搜索词不会丢。


### 充值（Deposit）全链路：下单 → 收款 → 回调验签 → 自动上分

| 接口 | 说明 |
| --- | --- |
| `POST /api/deposit/create` | 统一下单：校验玩家身份（玩家 Cookie / 商户代下单）、金额区间与网关可用性，落库 `DepositOrder(status=pending)`，返回 `orderNo` 与 `paymentInstructions` |
| `GET /api/deposit/gateways` | 收银台下拉数据：**只返回当前登录玩家所属商户（tenantId）自己配置的通道**（`isActive` + `ownerId = tenantId` + 校验通过），附 `merchantConfigured` 与 `amountLimits`；平台公用通道（`ownerId=null`）一律不返回 |
| `POST /api/deposit/callback/[gatewayCode]` | **真实支付商回调主入口**：`x-signature` 验签 → 按 `orderNo` 回查 → 状态幂等 → 金额核对 → 事务上分 |
| `POST /api/deposit/callback` | 旧版回调（按本系统订单主键 `orderId`，供历史联调脚本使用），与新接口共用同一份上分实现 |
| `POST /api/deposit/test-callback` | 前端「我已完成支付（测试）」，仅非生产环境 / `DEPOSIT_ALLOW_TEST_CALLBACK=true` 开放，复用正式状态机 |

- **订单号**：`DEP_<毫秒时间戳>_<6 位十六进制随机>`（`src/lib/deposit-order.ts`，`crypto.randomInt` 生成）。服务端生成、唯一索引兜底、撞号自动重试；第三方回调带回 `orderNo` 即可定位订单，历史订单仍可用主键 `id` 回查。
- **金额区间**：默认单笔 `10 ~ 50,000`，可用 `DEPOSIT_MIN_AMOUNT` / `DEPOSIT_MAX_AMOUNT` 覆盖；服务端 `parseDepositAmount` 为唯一口径，前端只做同口径提示。
- **收款指令**：`gatewayKind=CRYPTO`（`usdt_trc20` / `usdt_erc20` 或币种为 USDT）返回钱包地址 + 链网络 + 二维码内容；`gatewayKind=FIAT` 返回银行账号明细 / 静态收款图 / 跳转收银台地址。
- **回调三条防线**（`src/app/api/deposit/callback/[gatewayCode]/route.ts`）：
  1. 验签：`x-signature`（兼容 `x-pay-signature` / `x-gateway-signature`）= `hex(HMAC-SHA256(rawBody, gateway.apiKey))`，`apiKey` 即支付商后台的 `API_SECRET`；默认所有环境强制校验，可用 `PAYMENT_CALLBACK_REQUIRE_SIGNATURE=false` 仅在本机关闭；
  2. 防重放：订单已 `success` 直接 `replayed:true` 返回，绝不重复加钱；`failed` 拒绝再入账；`DepositOrder @@unique([gatewayId, txHash])` 挡住「同一交易号刷多单」；
  3. 金额核对：回调 `amount` 必须与数据库订单金额一致（Decimal 比较），不一致打印 `[ALARM][deposit-callback]` 结构化日志并拒绝入账。
- **上分事务**（`src/lib/deposit-settlement.ts`）：`updateMany({ where: { id, status: "pending" } })` 条件更新抢状态 → `Player.balance` 原子 increment → 写 `Transaction(type=deposit)` → 首充返佣，任一步失败整体回滚。
- **前端弹窗**：`src/components/player/deposit-modal.tsx`（大厅黑金风格，金额 + 网关下拉 → 展示 USDT 地址/一键复制/二维码或法币银行账号，提示「1-3 分钟内自动到账」）。
- **表结构增量**：`prisma/deposit-order-no.sql`（幂等，补 `DepositOrder.orderNo` + 唯一索引）；`npx prisma db push` 正常时也可直接用 schema。

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
| `GET /api/player/withdrawal-gateways` | 玩家提现弹窗的通道列表：只返回 `isActive` + `APPROVED` + （平台公用或本租户）的网关，附 `feeRate`（`payoutSellRate`）与 `amountLimits` |
| `POST /api/withdrawal/create` | 玩家提单：玩家 Cookie 身份 → KYC 闸门 → 金额区间 → 收款账号解析 → 通道币种核对 → 可用余额校验 → 落库 `Withdrawal(status=pending)` |
| `POST /api/withdrawal/callback` | 代付商回调：`pending → success` 条件更新成功者才扣 `Player.balance` 并写 `Transaction(type=withdraw)`；`failed` 只改状态 |

- **按钮与权限**（`src/components/player/withdraw-button.tsx`）：玩家中心顶部余额右侧与 Deposit 并排；未实名 → 点击弹「Please complete identity verification first.」+ 去认证入口；可用余额 < 最低额 → 点击说明最低提现金额；两者都满足 → 金色高亮并打开提现弹窗。鼠标悬停 `title` 直接显示被拦原因。
- **黑金提现弹窗**（`src/components/player/withdraw-modal.tsx`）：提现通道下拉（显示代付费率）→ 提现钱包下拉（只列玩家已绑定的收款账号，加密账号显示网络 + 缩略地址，法币显示银行 + 掩码账号）→ 金额输入 + 「全部」→ 实时显示**预估手续费**与**预计到账**。没有匹配币种的账号时不出表单，只给「去绑定提现账号」。
- **收款账号不由前端回传**：弹窗只提交 `{ gatewayId, accountId, amount }`；`accountId` 由服务端回查（校验 `playerId` + `tenantId`），加密货币取真实钱包地址、法币拼成「银行 · 账号 · 持有人」写入 `Withdrawal.walletAddress`。列表接口里的银行账号是掩码，前端拿不到真实账号也改不了。
- **金额区间**：默认单笔 `10 ~ 1,000,000`，可用 `WITHDRAWAL_MIN_AMOUNT` / `WITHDRAWAL_MAX_AMOUNT` 覆盖；`parseWithdrawalAmount`（`src/lib/payment-gateway.ts`）是唯一口径，前端只做同口径提示。
- **可用余额 = 余额 − 处理中的提现单**：`pending` 阶段不扣款（扣款发生在代付成功回调），所以提单时必须用 `prisma.withdrawal.aggregate({ status: "pending" })` 扣掉在途金额，否则同一笔余额可以被连开多张 pending 单重复提走；超额返回 `409 insufficient_available_balance`。玩家中心同步展示 `summary.pendingWithdrawalAmount`。
- **币种一致性**：`account.currency` 必须等于 `gateway.currency`，否则 `400 account_currency_mismatch`，避免 USDT 通道把钱打到 MYR 银行卡。
- **前端遗留调用兼容**：`walletAddress` 仍然可用（商户代提 / 脚本），与 `accountId` 二选一。

### 余额实时刷新 + 全站币种统一（RM / $ / ฿ / Rp）

提单只产生 `pending` 单（`Player.balance` 不变），但玩家看到的应该是**可用余额**，且符号必须来自租户配置——这两条是前端体验的硬要求：

- **唯一口径 `src/lib/player-balance.ts`**：`computeAvailableBalance(balance, pending)` / `availableBalanceToString(...)`；`availableBalance = balance − Σ(pending Withdrawal.amount)`，与服务端 `POST /api/withdrawal/create` 的判断完全一致。`src/lib/player-session.ts` 在解析会话时一次性查出 `pendingWithdrawalAmount` 与 `availableBalance`，所以 `/api/player/me`、大厅首屏、玩家中心拿到的是同一份数字。
- **大厅顶栏 BALANCE 显示可用余额**：`src/app/lobby-client.tsx` 顶栏用 `player.availableBalance`（充值成功时本地先按「新余额 − 在途」重算，避免等接口）。
- **跨页实时刷新 `src/lib/player-wallet-events.ts`**：提现 / 领取奖励成功后 `notifyPlayerWalletChanged()` 广播 `dbairs:player-wallet-changed`；大厅顶栏 `subscribePlayerWalletChanged(...)` 收到后立刻重新拉 `/api/player/me`。玩家中心自己再配合 `router.refresh()` 刷 Server Component，不需要手动刷新页面。
- **币种来自租户 `Tenant.currency`（默认 `MYR`）**：`src/lib/currency.ts` 是唯一符号表（MYR→`RM `、USD→`$`、USDT→`USDT `、THB→`฿`、IDR→`Rp `、VND 后缀 `₫`…），`formatCurrency(value, currency)` 输出形如 `RM 50.50`。**禁止**再写 `` `${formatAmount(x)}` `` 式的硬编码 `$`。
  - 玩家侧取值链：`PlayerSessionInfo.tenant.currency`（玩家中心）与 `StorefrontSettings.currency`（大厅，来自 `loadStorefront`）。
  - 已统一的位置：大厅顶栏 / Hero 奖池、玩家中心（顶部余额、可用余额卡、今日输赢、流水、充值/提现记录、注单、推广奖励、每日奖励）、提现按钮与弹窗、充值弹窗与支付页、`DepositDialog`。
  - 后台控制台（`/admin`、`/tenant` 的财务汇总）仍是平台视角的 `$` 展示，如需按租户币种请复用 `formatCurrency` 逐步替换。
- **表结构增量**：`prisma/tenant-currency.sql`（幂等，`ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "currency"`，默认 `MYR`）；正常 `npx prisma db push` 会自动建列，只跑 SQL 的环境可用 `npm run db:sql prisma/tenant-currency.sql`，随后 `npx prisma generate`（Supabase 连接池上 `db push` 有时会卡在 shadow database，这条路径更稳）。

### 前台排版模板（一套组件 + 5 组 layout token）

`/admin/storefront` 支持 5 种前台排版：`classic`（经典大厅）/ `cinema`（巨幕影院）/ `compact`（紧凑信息流）/ `bento`（卡片拼贴）/ `editorial`（双栏画报）。

- **一套组件，5 组 token**：模板定义在 `src/lib/storefront-presets.ts`（内容区宽度 / 模块间距 / 主视觉高度 / 面板圆角 / 卡片间距 / `mode`）；大厅组件树、数据流只有一份，**不存在 5 套独立布局**。
- **消费方式**：大厅根节点挂 `data-storefront-preset` + `--sf-shell-max` / `--sf-module-gap` / `--sf-hero-h(-sm/-lg)` / `--sf-panel-radius` / `--sf-game-gap`；组件用 `var(--sf-xxx, 默认值)` 取值。`bento` / `editorial` 的分栏规则在 `src/app/globals.css` 末尾（仅 `≥1024px` 生效，用 `:has()` 判断 Hero 是否存在，关掉 Hero 自动退回堆叠）。
- **存储**：`Tenant.layoutConfig.preset`（JSON 内字段，无需迁移）；老数据缺 `preset` 自动回落 `classic`，外观不变。保存仍走 `PUT /api/admin/storefront`（服务端逐字段归一化，脏值回落 `classic`）。
- **解耦红线**：模板只管排版；配色仍只由 `Tenant.themeColor` 决定，模块开关与顺序仍只由 `Tenant.layoutConfig.modules` 决定。

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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
