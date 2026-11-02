"use client";

import type { ReactNode } from "react";

/**
 * 集成中心四个页签共用的卡片外壳（黑金风格）。
 *
 * flushTable = true 时内容区去掉左右内边距并允许横向滚动，
 * 用于整宽表格；默认保留 20px 内边距给列表 / 表单使用。
 */
export function IntegrationCard({
  title,
  hint,
  actions,
  flushTable = false,
  children,
}: {
  title: string;
  hint: string;
  actions?: ReactNode;
  flushTable?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-neutral-100">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-neutral-500">
            {hint}
          </p>
        </div>
        {actions}
      </div>
      <div className={flushTable ? "mt-4 -mx-5 -mb-5 overflow-x-auto" : "mt-4"}>
        {children}
      </div>
    </section>
  );
}
