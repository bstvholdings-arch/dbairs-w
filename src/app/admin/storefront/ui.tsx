/**
 * 装修页共用的小组件：区块标题 + 上下移动箭头。
 * 主色 / 模块 / 游戏商商标网格三块配置区都用同一套外观，避免视觉漂移。
 */

/** 配置区标题：左侧金色竖条 + 标题 + 一行灰色说明 */
export function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-0.5 h-3.5 w-1 shrink-0 rounded-full bg-gradient-to-b from-brand-soft to-brand-deep"
      />
      <div className="min-w-0">
        <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-soft">
          {title}
        </h2>
        <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-500">{hint}</p>
      </div>
    </div>
  );
}

/** 上移 / 下移按钮里的箭头 */
export function ArrowIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "up" ? <path d="m6 14 6-6 6 6" /> : <path d="m6 10 6 6 6-6" />}
    </svg>
  );
}
