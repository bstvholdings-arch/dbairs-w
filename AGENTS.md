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

