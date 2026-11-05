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
- **主视觉（Hero）高度统一，不参与模板差异化**（`HERO_HEIGHT_TOKENS`：手机 200 / 平板 290 / 桌面 400px）。原因：Hero 铺的是商户自己上传的活动海报，高度一浮动，同一张图在 `compact` 与 `cinema` 下就会裁出两张完全不同的画面，运营无法「一次出图、全模板可用」。模板差异由宽度 / 间距 / 圆角 / 分栏承担。
- **Hero 高度只能由 `globals.css` 的 `[data-hero-stage]` 给**（`clamp(200–220px)` / `clamp(240–320px)` / `clamp(350–450px)`，配 `min-height` + `overflow: hidden` 兜底）。组件里**禁止**再写 `h-[var(--sf-hero-h…)]` —— 两处给高度时谁生效取决于打包顺序，正是「图片忽高忽低」的来源。两端渲染口径见下一条；文字版 Hero 的 `background-image` 是装饰蒙版，仍用 `bg-cover bg-top`。
- **两端两套口径，一套渲染引擎**：`src/components/lobby/hero-poster-image.tsx`。**手机（<768px）= 精致圆角卡片**：横向留白 16px（`main` 的 `px-3` + 模块的 `mx-1`）、固定 200px 高、`rounded-2xl`，卡片内部**只有一层** `object-cover + object-[center_30%]`（裁切重心压在上三分之一，保住人物面部与主标题），**禁止**模糊底 / 黑色蒙版 / 撑满手机屏幕 / 让 Hero 吃掉首屏。**电脑（≥768px）= 大气满版双层**：底层 `object-cover object-top + blur-xl + scale-110 + 黑色遮罩` 把舞台填满（空出来的是模糊底色，不是黑边），顶层 `object-contain` 等比完整露出、**永不裁剪 / 永不拉伸** —— 保证「传一张图，电脑端 5 套模板都不裁头」。电脑端**禁止**退回单层 `object-cover`（竖图 / 方图会切掉人物头部与标题），也**禁止**单层 `object-contain`（比例不匹配时留出生硬黑边）；玩家端轮播（`promo-hero-carousel.tsx`）、后台弹窗预览、后台活动列表缩略图必须复用同一个组件，不许各写一份 `<img>` 叠加逻辑。上传处必须醒目提示「推荐 1920 × 600（或 16:9 / 21:9 超宽横图）」，并做现场比例检测（方图 / 竖图给红字警告，**只提示不阻断保存**）。
- **双图分离（手机专用海报）**：`PromotionBanner.mobileImageUrl`（可选）+ 上面同一个组件的 `mobileSrc`。手机卡片只有 200px 高、约 1.8:1，1920 × 600 的宽图缩下去字就看不清，所以允许商户单独传一张手机图：`<768px` 且有专用图 → 用专用图 `object-cover` **铺满卡片**（专用图本就按手机比例出，裁得最少）；`<768px` 无专用图 → 用**电脑图铺满卡片**（cover + `center 30%`：比例差多少裁多少，但绝不留黑边、绝不出现模糊底）；`≥768px` → 永远电脑图 + 双层（顶层 `object-contain`）。三条硬规则：① 取图必须用 `<picture>` + `<source media="(max-width: 767px)">`，断点与 Tailwind `md` 严格对齐，**禁止**用「两个 `<img>` + `md:hidden`」——那会让手机把电脑大图也下一遍，首屏 LCP 直接崩（桌面模糊层在手机上 `hidden` 不额外下载：两层是同一个 `<picture>/<source>`，URL 相同浏览器会去重）；② 顶层的 `object-fit` / `object-position` 只能走 class（`object-cover object-[center_30%] md:object-contain md:object-center`），**禁止**写内联 `style.objectFit` / `style.objectPosition`（会盖掉断点切换）；③ `PATCH /api/tenant/promotions/banners/[id]` 是「整对象覆盖」口径，任何调用方漏传 `mobileImageUrl` 都等于清空手机图 —— 启停活动这类操作必须把字段原样带上。手机图的比例体检用 `classifyMobileBannerAspectRatio`（安全区间 1.2–3.2，离手机卡片越远裁得越多），同样**只提示不阻断**；后台弹窗用 `forceMobile` 在电脑上预览手机端真实画面。

- **前台排版流不许乱**：正常顺序是 ① 顶部 Header → ② Hero 卡片 → ③ Quick Access 功能岛 → ④ 品牌墙 → ⑤ 游戏列表（顺序与开关仍只由 `Tenant.layoutConfig.modules` 决定，默认就是这个顺序）。手机端 Hero 是卡片，**不占满屏、不遮挡任何模块**；模块之间手机上至少 16px（`gap-4`，模板 token 只在 `sm` 以上生效，防止 `compact` 的 10px 把手机挤在一起），模块区与游戏列表之间 `mt-6`，底部导航留白由 `main` 的 `pb-28` 兜住。改这几个间距必须同时在手机（390px）上看一遍，不允许出现重叠、挤压或半截内容。

### 4.1 主题背景色：一套 GameCard + 15 组色值（永远深色底）

- 15 种主题背景色（`obsidian` 经典暗黑 / `royalPurple` 皇家紫 / `deepSea` 深海蓝 / `cyberCyan` 赛博青 / `roseGold` 玫瑰金 / `emerald` 翡翠绿 / `bloodRed` 血月红 / `neonPink` 霓虹粉 / `moltenOrange` 熔岩橙 / `champagne` 香槟金 / `titanium` 钛金灰 / `abyssTeal` 幽潭青 / `arcticSilver` 极地银 / `solarYellow` 烈日金 / `midnightIndigo` 午夜靛蓝）**必须是同一个 `src/components/lobby/game-card.tsx`**，差异只允许来自 `src/lib/theme-backgrounds.ts` 的 `base`（深色底）+ `accent`（点缀色）两个色值。
- **站点永远是深色 / 黑底**：主题色只允许三处落点 —— 大厅环境光晕（`.tb-aura` 呼吸动画）、卡片封面的悬停 / 聚焦光晕（`.tb-card__cover` 边框光）、浮层小胶囊（在线人数 / HOT / 游戏商）的描边。**禁止**任何浅色 / 白色不透明底板（曾经的 `candyPop` 白卡就是这么来的）。
- **卡片是无边框图片卡（产品明确设计，不许再加回边框 / 底色 / 文字底板）**：卡片容器 `bg-transparent`、`border: 0`，**没有** `.tb-card__plate` 这类底部文字底板；视觉主体只有 `aspect-square` + `rounded-xl` 的封面图（`object-cover` 铺满），游戏名是**图片下方**的一行白字（`mt-1.5`，无背景板）。三个浮层胶囊固定位置：左上角在线人数、右上角 HOT、左下角游戏商 —— 都是半透明黑底 `rgb(0 0 0 / .6)`。
- **颜色不进组件 prop**：根节点用 `buildThemeBackgroundStyle()` 注入 `--tb-base` / `--tb-accent` / `--tb-rgb`，卡片只吃 `.tb-card` / `.tb-card__cover` / `.tb-card__name` / `.tb-card__provider` / `.tb-card__online` / `.tb-card__hot` / `.tb-card__play` 这几个固定 class（规则见 `globals.css` 的「主题背景色」区块）。加一种颜色 = 改色表一行，不碰组件、不碰 CSS、不写 `if (id === "...")`。
- **游戏主图是卡片主体，任何主题色都不许动它**：卡片渲染 `card.imageUrl`（来源优先级：`Game.iconUrl` → 示例封面池 `src/lib/game-cover-catalog.ts`，经 `buildCardsFromRecords` 里的 `readGameImageUrl()` 白名单校验），`object-cover` 铺满正方形封面、原图直出 —— **禁止**在 `<img>` 上叠纯色底 / 渐变 / 半透明遮罩 / `filter`。渐变 + 品类图形只在「没有封面图 / 图 404」时兜底。
- **示例封面池只做兜底、一处维护**：`src/lib/game-cover-catalog.ts` 是内置 Mock 目录 / 回退大厅 / 主题色演示页共用的真实照片表（Unsplash，可商用免署名），`Game.iconUrl` 有值时永远用真实封面。真实接入游戏商后整表可删，**禁止**把图片地址散落到组件或页面里。
- 主题色只管环境光与卡片；整站主色仍只由 `Tenant.themeColor` 决定，排版仍只由 `layoutConfig.preset` 决定，数据与交互（在线人数跳动、点开游戏）一份。
- 存储：`Tenant.layoutConfig.themeBackground`（JSON 内字段，无需迁移）；脏数据 / 老租户缺字段回落 `obsidian`；老的 `layoutConfig.gameCardStyle`（`cyberNeon` / `royalGold` / `candyPop`）由 `normalizeThemeBackground` 做**深色化迁移**（→ `cyberCyan` / `obsidian` / `neonPink`），老站点不会再出现白卡。
- 弹窗里用 **15 张单选色卡**（真实 `<input type="radio">` + 常显深色底 / 点缀色两个色点 + 现场 `.tb-*` 实时预览）而不是原生 `<select>`：原生下拉依赖浏览器弹层，弹层被上层元素遮挡 / 弹窗被祖先 `transform` 裁切时表现为「点了没反应」，且失焦即关、看不到配色。弹窗本身走 `createPortal` 挂到 `document.body`，不要改回直接 `fixed` 渲染。
- **配置权限已收回平台（不可回退）**：唯一写入口是超管【租户管理 → 新建 / 编辑租户】弹窗（`POST /api/tenants`、`PUT /api/tenants/[id]` 的 `themeBackground`）。商户后台（`PATCH /api/tenant/settings` 的 `layout` patch）与装修页（`PUT /api/admin/storefront`）**必须显式忽略 `themeBackground` 与历史字段 `gameCardStyle`**，页面也只做只读展示；否则等于给商户开了绕过权限的后门。
- 卖站阶段由 AI 销冠发 Demo：`src/lib/ai/prompts.ts` 的 `buildThemeBackgroundPreviewGuide()` 在销冠 System Prompt 里注入 15 个真实渲染的预览链接（`/demo/theme-backgrounds#<id>`，`src/app/demo/theme-backgrounds/` 复用同一个 `GameCard`），并明确「选好后由平台开站时配置」；旧路径 `/demo/game-card-styles` 必须继续跳转到新页面（客户手里的老链接不能 404）。
- 大厅 `/` 与品牌展馆 `/provider/[code]` 必须共用同一个 `StorefrontSettings.themeBackground`，否则玩家点进品牌馆会「换了个底色」。

### 4.2 品牌 Logo：只有超管能上传，前台永远「有图显示图、没图首字母」

- 唯一事实来源是 `Tenant.logoUrl`：http(s) 绝对地址，或以 `/` 开头的站内路径（上传接口返回的 `/api/tenant-logos/<uuid>.png` 就属于后者）。所有读写都必须过 `src/lib/storefront.ts` 的 `normalizeTenantLogoUrl()`，认不出来的值一律当「未配置」（`javascript:` / `data:` / `//host/x.png` 会被拒，因为它们最终直接进 `<img src>`）。
- **唯一写入口**：超管【租户管理 → 新建 / 编辑租户】弹窗里的 Tenant Logo 组件 → `POST /api/admin/tenant-logos/upload`（超管会话；PNG / JPG / WEBP，≤ 2MB，按文件头嗅探，**不收 SVG**，否则等于开放存储型 XSS）拿到 `/api/tenant-logos/<uuid>.png`，再随 `POST /api/tenants` / `PUT /api/tenants/[id]` 落库。
- **Logo 显示位置 `Tenant.logoPosition`**（`left` 默认 / `center`）：同一权限口径，也只能在上面那个弹窗里选（单选卡片，标签见 `LOGO_POSITION_OPTIONS`）。
  - 读侧一律过 `normalizeTenantLogoPosition()`，脏数据 / 老租户回落 `left`（= 改造前的排版，升级后老站点外观不变）。
  - 大厅顶栏**只有一份** `TenantBrandLockup`：`left` 用原来的 flex-wrap（品牌在最左），`center` 用三列栅格 `[1fr_auto_1fr]`（左槽菜单按钮 / 中槽 Logo / 右槽搜索 + 语言 + 余额），左右等宽才能保证 Logo 精确落在屏幕中线。
  - **禁止**为了居中在左侧再渲染一个 Logo，也**禁止**为两种位置各复制一份 Header 组件；位置差异只能来自 Grid 的列 / `display: contents` 与 `Tenant.logoPosition`。
  - 手机（<lg）放不下等宽三列：中槽是 `1fr`，品牌在「菜单 + 图标组」之间居中，第二排整行留给余额 + 搜索 —— 宁可略有偏移，也不挤压任何控件。
  - 商户后台（`PATCH /api/tenant/settings` / `saveTenantSiteSettings`）与装修页（`PUT /api/admin/storefront`）**都不认这个字段**，进了 `layoutConfig` 也不行（它是 `Tenant` 上的独立列）。
- **商户端零写入能力（不可回退）**：`/tenant/settings` 不渲染任何 Logo 组件、按钮、输入框或说明文案；`PATCH /api/tenant/settings` 与 `saveTenantSiteSettings` 的签名里都没有 `logoUrl`，商户构造请求也改不动。不要以「方便商户」为由把入口加回来 —— 与 `themeBackground` 同一权限口径。
- 玩家面所有露出品牌名的地方（大厅、`/provider/[code]`、登录 / 注册、玩家中心、实名认证、活动页）必须复用 `src/components/brand/tenant-brand.tsx` 的 `TenantBrandLockup`：`logoUrl` 有值显示图，加载失败或未配置降级成商户名首字母金色方块。**禁止**各页面自写 `<img>` + 品牌名。
- 存储走 `src/lib/tenant-logo-storage.ts`（演示实现落盘 `.tenant-logo-storage/`，已在 `.gitignore`）；生产环境只把 `saveTenantLogo` 换成 Supabase Storage / S3 上传并返回 CDN 直链，`/api/tenant-logos/[key]` 可整段删掉，前端组件与 `Tenant.logoUrl` 口径不变。

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

### 7. 前台租户上下文：只认 `?tenant=` / 域名 / 会话 / 代登录票据，找不到就 404

- 玩家可见页面（`/`、`/provider/[code]`、`/player/*`）一律用 `src/lib/storefront-data.ts` 的 `requireStorefront()`；解析顺序：`?tenant=` → 访问域名/子域名 → 商户会话 → 超管代登录票据 → `.env` 的 `DEFAULT_TENANT` → **都没有就 `notFound()`**。
- `?tenant=` 传了就**必须**命中，命中不了直接「站点不存在」，**禁止**回落到「最早创建的 active 租户」——「代登录 abc 点【预览前台】却看到 winvora」就是这么来的。
- 禁止任何硬编码商户名兜底（`winvora` 等只允许出现在注释 / 示例 / README 里）；`resolvePlayerTenant()`（注册 / 登录）同样不得回落到任意租户，否则会把玩家注册进别家商户。
- 商户后台 Header 的【预览前台】必须带 `/?tenant=<subdomain || id>`（`ConsoleShell` 的 `previewTenantKey` 由 `tenant/(console)/layout.tsx` 下发）；平台范围后台没有归属租户，不渲染该入口。预览模式下大厅的所有站内跳转（品牌馆 / 登录 / 注册 / 玩家中心）都要透传 `?tenant=`。
- `loadStorefront()` 只允许后台页面使用（需要「默认选中某个租户」，允许回落最早 active 租户），玩家面不得调用。
- 流式渲染下 `notFound()` 的 HTTP 状态可能是 200 + `noindex`（Next 官方行为），这是已知取舍；文案见 `src/app/not-found.tsx`（`site.notFound.*`，中英并列，不依赖 `useLanguage`）。

### 8. 多域名池与防封自动切换：备用域名必须等于「同一个站」

- 数据只在 `Tenant.backupDomains`（`String[]`，0-5 条）。写入前一律走 `src/lib/tenant-domains.ts` 的 `readBackupDomainsInput()`：小写、去协议、去路径、去重；**格式 / 数量错了整批拒绝**，不做「猜一个能用的」。
- **备用域名必须同时被 `requireStorefront()` 认出来**（`storefront-data.ts` 的 `findTenantByDomain` 会查 `backupDomains`）。否则 `DomainGuard` 一跳过去就是「站点不存在」——比不跳更糟。改解析逻辑时必须一起跑这条链路。
- **备用域名跨租户唯一**：写入侧（超管 `POST/PUT /api/tenants`、商户 `PATCH /api/tenant/settings`）统一用 `src/lib/tenant-domain-service.ts` 的 `findBackupDomainConflict()` 拦：已作为别家主域名 / 备用域名 / 子域名前缀的都拒绝。商户可以自助维护自己的池子，但**不能把别家的域名填进来**（那等于抢站）。
- 跳转顺序只有一份实现：`buildFailoverTargets()`。规则是「当前在主域名就依次试备用域名；当前已经在某个备用域名上，就**先试别的备用域名，最后才回主域名**」——主域名刚才是因为打不开才跳走的，立刻跳回去只会来回抖。
- 客户端 `<DomainGuard />`（`src/components/domain-guard.tsx`，挂在 root layout）只做三件事：每 30 秒打 `/api/ping`、**连续 2 次**失败才跳、跳转保留 path / query / hash 并写 2 分钟冷却。它**不做判断**：候选列表由 `/api/domain-guard` 按 Host 解析后下发（只看访问域名，不认 `?tenant=` / 会话 / 代登录票据，所以平台后台永远拿到空列表）。两条硬规则：玩家自己断网（`navigator.onLine === false`）不跳；标签页在后台时不跳（定时器被节流，结果不可信）。
- `/api/ping` **绝对不许查库 / 鉴权 / 读 cookie**，并且 `await connection()` + `Cache-Control: no-store`：一次慢查询就会被判成「线路故障」，把好端端的玩家踢到备用域名上。
- 已知边界（不要试图在客户端解决）：域名在 DNS / SNI 层已被封时，页面根本打不开，这段脚本没有机会执行。那种情况只能靠「开站时把多个域名链接一起发给客户」+ 备用域名提前配好 DNS 兜住；不要为了「连页面都打不开也要跳」去搞隐形 iframe / 第三方探针，误判代价是把正常玩家弹走。
- 商户后台 `/tenant/settings` 与超管【编辑租户】弹窗共用同一份输入框口径（一行一个 / 逗号分隔、实时计数、最多 5 个）；新增文案必须同时补 `zh.json` 与 `en.json`。

### 9. 提现：纯法币同币种（MYR → MYR），禁止汇率换算

- 玩家提现是**等值法币出款**：提现金额 / 手续费 / 到账金额单位全部是 `Tenant.currency`（默认 MYR）。**禁止**再引入 USDT / TRC20 / 汇率折算那一套（历史上存在过「MYR 余额提现成 USDT」的口径，已彻底移除，不得回退）。
- 通道白名单只认「非加密 + 币种等于本站记账币种」：唯一判定是 `src/lib/withdrawal-channels.ts` 的 `isFiatPayoutChannel()`（`usdt_*` / `crypto_*` / `coin_*` 前缀一律排除）；`/api/player/withdrawal-gateways` 与 `POST /api/withdrawal/create` 必须用同一份判定，前者下发的集合就是后者接受的集合。
- 费率由后台按通道维护（`PaymentGateway.payoutSellRate`），前端只渲染 `GET /api/player/withdrawal-gateways` 下发的 `feeRate`，**禁止**在组件里写死费率或通道列表。手续费口径固定为 `calculateWithdrawalFee(amount, feeRate)`（四舍五入到分）+ `calculateWithdrawalReceive(amount, feeRate)`，服务端与弹窗共用，不要各写一份。
- 收款账号只允许「银行账号 + 同币种」：`isFiatPayoutAccount()`；弹窗只提交 `{ gatewayId, accountId, amount }`，真实账号由服务端回查拼装，银行账号在前端永远是掩码。
- 币种归一化只走 `normalizePayoutCurrency()`（脏数据 `RM` 视同 `MYR`）；`Withdrawal.currency` 落库时写入归一化后的记账币种，**禁止**把网关上的原始字符串直接写进流水。
- 提现金额输入最多两位小数（法币只到「分」）；`parseWithdrawalAmount` 仍兼容 6 位是为了历史数据，不要因此放宽前端校验。

### 10. 自动出款（Auto Payout）：能自动就自动，不能自动就一定能人工

- **判定只写一次**：`src/lib/auto-payout.ts` 的 `evaluateAutoPayoutRoute()`（纯函数）+ `evaluateWithdrawalRouting()`（查库版）。顺序固定为「有没有代付 API → 开关 → KYC → 红利流水 → 单笔上限 → 当日额度熔断」，任何一项不满足就产出一个 `manual_*` 原因并落 `pending`。**禁止**在路由文件、页面或组件里另写一套判断。
- **没有代付 API 时，人工审批按钮必须绝对存在**：`/tenant/withdrawals` 的 `Approve` / `Reject` 对每一条 `pending` 单**无条件渲染**，不得改成「有代付 API 才显示」或任何条件渲染。自动打款失败的单会退回 `pending`（`riskStatus=auto_payout_failed`），靠的就是这两个按钮。
- **记账只有一份实现**：`src/lib/withdrawal-settlement.ts`（`settleWithdrawalSuccess` / `markWithdrawalFailed` / `returnWithdrawalToManualReview`）。代付回调 `/api/withdrawal/callback`、商户人工审批 `reviewTenantWithdrawal`、自动出款 `runAutoPayout` 三条路径必须共用；靠 `updateMany({ where: { status: { in: [...] } } })` 做数据库层 CAS，**禁止**再复制一份「扣余额 + 写流水」。
- **状态机固定四态**：`pending`（人工待审）/ `processing`（自动出款在途）/ `success`（已出款）/ `failed`（驳回或出款失败）。`processing` 单**不接受**人工审批（`reviewTenantWithdrawal` 返回 409），页面也不出按钮 —— 否则就是「自动打一次 + 人工再打一次」。
- **在途金额口径唯一**：可用余额 / 玩家中心 / AI 工具 / 平台大盘一律用 `src/lib/withdrawal-status.ts` 的 `IN_FLIGHT_WITHDRAWAL_STATUSES`（`pending` + `processing`）。只算 `pending` 会让自动出款在途的钱被再提一次。
- **熔断不靠定时任务**：当日 `isAuto=true` 且 `status in (processing, success)` 的合计 ≥ `Tenant.autoPayoutConfig.dailyAutoLimit` 时，本单当场转人工（用「已出 + 本单」比较，永不超发）；按自然日（服务器本地 00:00）重置。
- **代付地址只能挂在商户自有通道**：唯一写入口是 `PATCH /api/tenant/payout-engine`，`where` 必须带 `ownerId=本站 + isPlatformGateway=false`。平台通道（`ownerId=null`）**永远**判成「没有代付 API」→ 人工，与第 1 条「平台绝不碰资金」一致，不得开任何后门。
- **出站请求契约**（`requestGatewayPayout`）：`POST {PaymentGateway.payoutEndpoint}`，头带 `x-gateway-signature: sha256=HMAC-SHA256(rawBody, gateway.apiKey)` 与 `x-idempotency-key: 提现单号`，15s 超时；返回非 2xx / `success!==true` 一律转人工。签名复用回调那套 `createCallbackSignature`，不许另造算法。
- **配置读侧 fail-closed**：`normalizeAutoPayoutConfig()` 遇到 `null` / 脏数据 / 非数字一律回落「关闭 + 默认限额」；商户提交非法值（负数、超上限、开关打开但限额 0）直接 400 拒绝，不猜。老租户升级后 = 全部人工，行为不变。
- 增量 SQL：`prisma/auto-payout.sql`（幂等，`npm run db:sql prisma/auto-payout.sql`），改完记得 `npx prisma generate`。

### 11. 前台充值弹窗：一套组件 + 四种 `gatewayType` 分支，不许「一律二维码」

- **唯一组件是 `src/components/player/deposit-modal.tsx`**，形态判定只看「当前选中通道的 `gatewayType`」（下单后只看接口回传的 `gatewayType`），**禁止**用币种 / `gatewayKind` / 是否有金额去反推形态，也**禁止**为某个形态复制一份弹窗。
- **STATIC_QR**：只渲染大图收款码 + 「请使用手机银行扫码支付」；商户配的是远程图片（http(s) / 站内路径）时**下单前**就展示（`/api/deposit/gateways` 下发 `staticQrImageUrl`），base64 大图不下发列表、下单后再展示（避免把列表接口撑成 MB 级）。
- **REDIRECT_URL**：**先选银行 → 输入金额 → 下单 → `window.location.assign(paymentUrl)` 整页跳转**，并且**任何情况下都不渲染二维码**。必须同标签页跳转（手机浏览器拦 `window.open` 弹窗，玩家会以为「点了没反应」）；跳转前后都要能兜住「浏览器拦了 / 链接打不开」——已经 `setCreated`，页面显示「正在跳转…」+ 手动前往按钮。
- **BANK_TRANSFER**：只渲染收款银行 / 户名 / 账号 + 逐行【复制】+ 一键复制全部，**任何情况下都不渲染二维码**。
- **DYNAMIC_QR**：USDT 钱包地址 + 现场生成二维码；非 USDT 支付商优先用接口下发的 `qrCodeData` 生成。
- **只有 1 条通道时不渲染 `<select>`**（直接显示通道卡片 + 形态标签）；多条通道才出下拉框，切换通道要清空已选银行（银行列表是通道级的）。
- **银行列表只有一个事实来源**：`PaymentGateway.supportedBanks String[]` + `src/lib/payment-gateway-banks.ts`（`normalizeSupportedBanks` / `gatewayBankLabel` / `resolveDepositBankSelection`）。商户在 `/tenant/payments` 勾选内置银行或手填目录外银行（上限 20 家），玩家端只渲染，**服务端 `POST /api/deposit/create` 必须再校验一遍白名单**（没选 / 不在列表 → 400），通过后把 `bank=<code>` 拼到支付商跳转地址上。列表为空 = 不做银行选择，交给支付商收银台。
- **`tenantGatewayWriteData` 是整对象覆盖**：任何新增 / 既有调用方（`POST|PUT /api/tenant/gateways`、超管 `PATCH /api/admin/integrations/gateways/[id]`）都必须把 `supportedBanks` 带上，否则等于把商户配好的银行卡片清空；非 `REDIRECT_URL` 形态一律写 `[]`。
- 增量 SQL：`prisma/gateway-supported-banks.sql`（幂等），改完 `npx prisma generate` 并**重启 dev server**（旧的内存客户端看不到新字段）。




