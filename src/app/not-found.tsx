import type { Metadata } from "next";

import en from "@/locales/en.json";
import zh from "@/locales/zh.json";

/**
 * 全站 404 边界（根 segment）。
 *
 * 触发场景：玩家前台解析不到租户 —— 域名没绑定、`?tenant=` 指向不存在的商户、
 * 本地访问裸 `/`。多租户下这里**不能**显示任何商户品牌名，更不能回落到某个站点，
 * 一句「站点不存在」比「显示成别人家的大厅」安全得多。
 *
 * 两个实现约束：
 * 1. 服务端组件 + 直读词典（不走 useLanguage）：`notFound()` 是在响应开始流式输出
 *    之后才抛的，此时只有服务端已渲染的 HTML 能保证「不执行 JS 也能看到」，
 *    而且这类请求连租户都没确定，语言更无从判断 —— 所以中英并列。
 * 2. 文案仍以 zh.json 为唯一事实来源（en.json 同步），不在这里手写第二份。
 */
export const metadata: Metadata = {
  title: `${zh["site.notFound.title"]} | ${en["site.notFound.title"]}`,
  description: zh["site.notFound.description"],
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4 py-16 font-sans text-neutral-200">
      <div className="w-full max-w-lg rounded-2xl border border-[#d4af37]/15 bg-white/[0.02] p-6 text-center sm:p-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.38em] text-neutral-600">
          404
        </p>
        <h1 className="mt-3 text-2xl font-black text-neutral-50 sm:text-3xl">
          {zh["site.notFound.title"]}
        </h1>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">
          {en["site.notFound.title"]}
        </p>
        <p className="mt-4 text-sm leading-6 text-neutral-400">
          {zh["site.notFound.description"]}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-neutral-500">
          {en["site.notFound.description"]}
        </p>
        <p className="mt-4 rounded-xl border border-[#d4af37]/10 bg-[#d4af37]/[0.03] px-4 py-3 text-[11px] leading-5 text-neutral-500">
          {zh["site.notFound.hint"]}
        </p>
      </div>
    </main>
  );
}
