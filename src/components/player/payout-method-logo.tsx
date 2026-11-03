"use client";

import { useState } from "react";

import type { PayoutMethod } from "@/lib/payout-methods";

/**
 * 银行 / 支付方式 logo 小方块（24px）。
 *
 * - 深色 UI 里银行 logo 常是透明底或白底，所以统一套一层浅色方块 + 细描边，
 *   保证「黄色 Maybank」与「深蓝 RHB」在同一行里的视觉重量接近；
 * - 图 404 / 被墙时**不留裂图**，降级成黑金首字母方块（与 TenantBrandLockup 的兜底同思路）；
 * - 图片是站内静态资源（`public/banks/*.svg`），不过 next/image 的域名白名单，故用原生 <img>。
 */
export function PayoutMethodLogo({
  method,
  className = "h-6 w-6 rounded-[7px] text-[11px]",
}: {
  method: PayoutMethod;
  /** 尺寸 / 圆角 / 字号由调用方给（列表行用小号，触发框用中号） */
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-deep via-brand to-brand-soft font-black text-brand-ink ring-1 ring-white/[0.08] ${className}`}
      >
        {method.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-white/[0.06] ring-1 ring-white/[0.08] ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={method.logo}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
        onError={() => setBroken(true)}
      />
    </span>
  );
}
