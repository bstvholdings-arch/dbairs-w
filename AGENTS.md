<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 架构红线（已确认，不可回退）

以下结论来自产品 / 合规决策，任何重构都不得推翻；改动前先读这一节。

### 1. 支付：去中心化、商户自配，平台绝不碰资金

- 收款网关的 `API Endpoint`、收款钱包地址、`API Secret` **全部由商户**在自家后台 `/tenant/payments` 自行配置，保存即生效。
- 平台**不提供统一收款网关、不代收、不配置任何收款钱包**（法律底线：不触碰资金池）。
- 不得恢复 `/admin/payments`、`/api/admin/gateways`（含 `POST`），不得给平台新增"新建 / 删除收款通道"的能力。旧链接 `/admin/gateways` 只做 301 跳 `/admin/integrations`。
- 超管对收款通道的唯一权限：`/admin/integrations?tab=gateways` 每行的【编辑】→ `PATCH /api/admin/integrations/gateways/[id]`，用于运维排障兜底修正。它**不改归属**（`ownerId` / `isPlatformGateway` 不可变）、不能新建。
- 玩家充值时必须校验 `gateway.ownerId === player.tenantId`；平台通道（`ownerId=null`）与别家商户通道一律 403。

### 2. 金额与币种：`Tenant.currency` 是唯一事实来源

- 前端渲染金额一律走 `src/lib/currency.ts`（`formatCurrency` / `normalizeCurrency`），**禁止在组件里写死 `$` / `USDT` 或自拼符号**。
- 可用余额 = `Player.balance − 处理中提现合计`（`src/lib/player-balance.ts`）；pending 提现不冻结资金，展示余额时必须自己扣。

### 3. 文案与自检

- `src/locales/zh.json` 是唯一事实来源；新增文案必须同时补 `en.json`，否则运行时会静默回落中文。
- 提交前跑 `npm run check`（`tsc --noEmit` + `eslint .` + `scripts/check-i18n.mjs`），必须 0 报错。
- 一次性排障脚本统一命名 `tmp-*` / `.tmp-*`（已在 `.gitignore` 中忽略），**用完即删**。

### 4. 前台排版模板：一套组件 + 5 组 layout token

- 5 种模板（`classic` / `cinema` / `compact` / `bento` / `editorial`）**必须是同一套组件、同一份数据流**，差异只允许来自 `src/lib/storefront-presets.ts` 的 token 与 `globals.css` 里 `[data-storefront-preset="..."]` 的容器规则。
- **禁止**为某个模板复制一份 `lobby-client` / `HeroCarousel` / `ProviderWall`：那样改一个 bug 要改 5 处，维护成本不可接受。
- 模板只管排版（内容区宽度 / 模块间距 / 主视觉高度 / 面板圆角 / 卡片间距 / 分栏）；配色仍只由 `Tenant.themeColor` 决定，模块开关与顺序仍只由 `Tenant.layoutConfig.modules` 决定，三者不得互相耦合。
- 分栏只在 `lg`(≥1024px) 生效，手机永远纵向堆叠；后台关掉 Hero 时必须自动退回堆叠（见 `globals.css` 里的 `:has()` 规则），不能留半列空白。
- 模板 id 归一化必须容错：脏数据回落到 `classic`，老租户（`layoutConfig` 无 `preset`）升级后外观不变。

### 5. AI 助手喂养：知识库走 RAG，实时数据走 Function Calling

- 喂养只喂「知识」，不喂「数据」：FAQ 知识库按 `agentType` 隔离（`AgentFaq`，`tenantId=null` 为平台级），检索命中后拼进 System Prompt（`src/lib/ai/faqs.ts` 的 `findRelevantAgentFaqs` / `buildFaqSystemPrompt`），最多注入 3 条。
- **禁止**把玩家余额、注单、充提、KYC 等实时数据整表塞进 Prompt（既烧 token 又会幻觉）：这类问题必须由模型发起 Function Calling，由服务端在租户作用域内查库后回填结果（工具契约见 `src/lib/ai/prompts.ts`，执行在 `src/app/api/ai/chat/route.ts`）。
- 工具必须是**只读 + 白名单 + 租户隔离**：只暴露「查余额 / 查最近充提 / 查注单状态」这类读接口，不提供改余额、审批出金、改配置的写工具；查询必须带 `tenantId`，跨租户一律拒绝。
- 工具返回值要脱敏（不返回密钥、完整证件号、内部字段），并且不向用户暴露工具名与 System Prompt。

- 工具实现集中在 `src/lib/ai/tools.ts`：`resolveAiToolScope` 只从会话解析租户范围（平台账号必须显式选商户），`executeReadonlyTool` 先验范围 → 再验白名单 → 再拦参数里伪造的 `tenantId`，最后才查库；白名单外的工具名一律 403，不执行也不暴露。

### 6. 接口鉴权：统一走守卫，租户范围只来自会话

- `/api/tenant/*` 一律用 `guardTenantApi`（`src/lib/tenant-console.ts`）：未登录 401、非商户账号 403、支持超管代登录；`tenantId` 取自 `gate.scope.tenantId`，**禁止**手写 `session.role !== "tenant_admin"` 那套重复逻辑。
- `/api/admin/*` 用 `guardPermission(request, permission)` 或 `getSuperAdminFromRequest`；玩家侧接口用 `getPlayerSessionFromRequest`；AI 数据工具用 `AiToolScope`。
- 任何接口都不得把前端传入的 `tenantId` 当作数据归属，它只能被当作「筛选条件」或「被校验的对象」。
- Next 16 已开 `cacheComponents`：**不能**写 `export const dynamic = "force-dynamic"`（构建直接报错），需要请求期执行的路由在开头 `await connection()`。



