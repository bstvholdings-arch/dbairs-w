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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
