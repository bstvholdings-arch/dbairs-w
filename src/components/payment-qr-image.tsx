"use client";

import { useState } from "react";

/**
 * 收款二维码图片（STATIC_QR 通道，商户在后台自行上传 / 填 URL）。
 *
 * 铁律：**任何情况下都不许出现浏览器的裂图图标**。
 * 商户换了图床、图片被删、URL 填了空格、外链被墙 —— 这些都不该让玩家
 * 看到一张「破图」。所以这里只有两种结果：
 * - 有可用图 → 渲染 <img>（失败时降级成占位框）；
 * - 没配 / 加载失败 → 黑金占位框 + 文案「收款码未配置，请联系客服获取」。
 *
 * 状态用「哪一张 URL 失败了」而不是布尔值：玩家换个通道重新下单时 URL 变了，
 * 组件会自动重试新图，不需要 useEffect 里同步 setState（会触发级联渲染，
 * 也踩 react-hooks/set-state-in-effect）。调用方也可以用 key={src} 强制重建。
 *
 * 大厅充值弹窗（player/deposit-modal）与玩家中心充值弹窗
 * （deposit-payment-modal）共用本组件，禁止各自再写一份 <img> + onError。
 */
export function PaymentQrImage({
  src,
  alt,
  /** 未配置 / 加载失败时显示的文案（各端自己传，词典见 src/locales） */
  missingText,
  /** 图片外框样式（含白底，二维码需要高对比度才扫得出） */
  frameClassName = "",
  imageClassName = "",
}: {
  src: string | null | undefined;
  alt: string;
  missingText: string;
  frameClassName?: string;
  imageClassName?: string;
}) {
  const url = src?.trim() ?? "";
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) {
    return (
      <div className="rounded-2xl border border-[#d4af37]/25 bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.14),transparent_65%)] px-4 py-7 text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[#d4af37]/35 bg-[#d4af37]/[0.08]"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6 text-[#f0d27c]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17.5 20.5H20.5v-3" />
          </svg>
        </span>
        <p className="mt-3 text-[11px] leading-5 text-[#e8cf8a]">
          {missingText}
        </p>
      </div>
    );
  }

  return (
    <div className={frameClassName}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        draggable={false}
        onError={() => setFailedUrl(url)}
        className={imageClassName}
      />
    </div>
  );
}
