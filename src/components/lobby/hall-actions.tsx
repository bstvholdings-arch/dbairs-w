"use client";

/**
 * 顶部功能占位图标（纯 CSS + 内联 SVG，不依赖图片素材）。
 *
 * - 金牌：奖牌本体用 conic-gradient 模拟金属反光，外圈是一层呼吸光晕；
 *   光晕用 globals.css 的 halo-breathe 关键帧，尊重 prefers-reduced-motion。
 * - 礼盒：金色盒身 + 深金丝带 + 蝴蝶结，配两颗闪烁的星芒。
 */

export function MissionMedalIcon({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative flex h-9 w-9 items-center justify-center ${className}`}
    >
      {/* 呼吸光晕 */}
      <span
        aria-hidden="true"
        className="absolute inset-0 animate-[halo-breathe_2.6s_ease-in-out_infinite] rounded-full bg-brand-soft/45 blur-[7px] motion-reduce:animate-none"
      />
      {/* 缎带 */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-1/2 flex -translate-x-1/2 gap-[3px]"
      >
        <span className="h-2.5 w-1.5 origin-top rotate-[16deg] rounded-[1px] bg-gradient-to-b from-rose-400 to-rose-700" />
        <span className="h-2.5 w-1.5 origin-top -rotate-[16deg] rounded-[1px] bg-gradient-to-b from-sky-400 to-sky-700" />
      </span>
      {/* 金牌本体 */}
      <span
        aria-hidden="true"
        className="relative flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[conic-gradient(from_200deg,#fdf3c8,var(--sf-soft),#a97b1c,#fff6cf,#e3bd55,var(--sf-soft))] shadow-[0_0_12px_var(--sf-soft-a55)] ring-1 ring-inset ring-white/70"
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_34%_24%,#fff8da,#e5c163_58%,#a97b1c_100%)]">
          <svg
            viewBox="0 0 24 24"
            className="h-2.5 w-2.5 text-[#5c430f]"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7L12 3Z" />
          </svg>
        </span>
      </span>
    </span>
  );
}

export function ReferralGiftIcon({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative flex h-9 w-9 items-center justify-center ${className}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 animate-[halo-breathe_3.4s_ease-in-out_infinite] rounded-full bg-brand-soft/35 blur-[7px] motion-reduce:animate-none"
      />
      <svg
        viewBox="0 0 24 24"
        className="relative h-[19px] w-[19px]"
        aria-hidden="true"
      >
        {/* 盒身 */}
        <rect x="4.6" y="12.2" width="14.8" height="9" rx="1.6" fill="#c9a23e" />
        <rect x="4.6" y="12.2" width="14.8" height="2.2" rx="1.1" fill="#e3bd55" />
        {/* 丝带 */}
        <rect x="10.9" y="8.2" width="2.2" height="13" fill="#7a5a12" />
        <rect x="4.6" y="12.2" width="14.8" height="0.9" fill="#7a5a12" opacity="0.55" />
        {/* 盒盖 */}
        <rect x="3.4" y="7.6" width="17.2" height="4.6" rx="1.4" fill="var(--sf-soft)" />
        <rect x="3.4" y="7.6" width="17.2" height="1.5" rx="0.75" fill="#fff6cf" opacity="0.75" />
        {/* 蝴蝶结 */}
        <path
          d="M12 7.4c-2.4-3.4-5.8-2.8-5.8-.4 0 1.4 1.6 1.8 5.8.4Z"
          fill="var(--sf-pale)"
          stroke="#7a5a12"
          strokeWidth="0.5"
        />
        <path
          d="M12 7.4c2.4-3.4 5.8-2.8 5.8-.4 0 1.4-1.6 1.8-5.8.4Z"
          fill="var(--sf-pale)"
          stroke="#7a5a12"
          strokeWidth="0.5"
        />
        <circle cx="12" cy="7.2" r="1.05" fill="#fff6cf" />
        {/* 闪星 */}
        <path
          d="M20.2 3.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z"
          fill="#fff6cf"
          className="animate-[gift-sparkle_2.2s_ease-in-out_infinite] motion-reduce:animate-none"
        />
        <path
          d="M3.6 4.4l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4.4-1Z"
          fill="#fff6cf"
          className="animate-[gift-sparkle_2.8s_ease-in-out_infinite_0.6s] motion-reduce:animate-none"
        />
      </svg>
    </span>
  );
}

/**
 * 资金 / 账户类图标：充值、提现、登录注册。
 *
 * 和上面两个奖牌 / 礼盒不同，这三个不做多色金属渐变，统一走 currentColor，
 * 由父级 text-brand-soft 之类的类名控制颜色，方便整卡悬停时一起高亮，
 * 也避免多张卡片同时渲染时 <linearGradient id> 冲突。
 */
export function DepositIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 8.2v7.6M8.2 12h7.6" />
      <path d="M12 3.4v1.4M12 19.2v1.4" opacity="0.5" />
    </svg>
  );
}

export function WithdrawIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 钱包 */}
      <path d="M4 9.2A2.4 2.4 0 0 1 6.4 6.8h8.2a2.4 2.4 0 0 1 2.4 2.4" />
      <rect x="4" y="9.2" width="16" height="9.6" rx="2.6" />
      <path d="M15.6 14h1.8" />
      {/* 出金箭头 */}
      <path d="M12 16.6V5.4" />
      <path d="m9.2 8.2 2.8-2.8 2.8 2.8" />
    </svg>
  );
}

export function PlayerAuthIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="8.4" r="3.4" />
      <path d="M3.8 19.6c0-3.3 2.8-5.8 6.2-5.8 1.3 0 2.5.3 3.5 1" />
      {/* 右上角的「+」角标：注册入口 */}
      <path d="M17.4 5.2v4.4M15.2 7.4h4.4" />
    </svg>
  );
}

