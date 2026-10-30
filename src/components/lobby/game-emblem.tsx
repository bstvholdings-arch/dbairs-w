import type { ReactNode } from "react";

import type { LobbyGameEmblem } from "@/lib/lobby-games";

/**
 * 大厅封面图形。
 *
 * 全部是内联 SVG：不请求任何外部图片，离线可用、缩放不糊，
 * 也避免了「风景照 / 建筑照」那种和博彩内容完全无关的占位图。
 * 描边统一走 currentColor，外圈再叠一层同色模糊光晕（由调用方控制）。
 */
const EMBLEMS: Record<LobbyGameEmblem, ReactNode> = {
  // 老虎机：机身 + 三格滚轮 + 右下摇杆
  reels: (
    <>
      <rect x="8" y="7" width="27" height="30" rx="5" />
      <rect x="12" y="12" width="19" height="13" rx="2.5" />
      <path d="M18.3 12v13M24.7 12v13" />
      <path d="M17 19.5h1.2M23.4 19.5h1.2M29.8 19.5H31" />
      <path d="M15 29.5h13" />
      <path d="M35 12.5h2.4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H35" />
      <path d="M38.4 20.5v4" />
      <path d="M13 37h17" />
    </>
  ),
  // 扑克牌：两张叠放的牌，正面是黑桃
  cards: (
    <>
      <rect x="9" y="12" width="18" height="25" rx="3" transform="rotate(-12 18 24.5)" />
      <rect x="21" y="10" width="18" height="25" rx="3" />
      <path d="M30 17.5c1.9 2.2 3.4 3.4 3.4 5.2a3.4 3.4 0 1 1-6.8 0c0-1.8 1.5-3 3.4-5.2Z" />
      <path d="M30 25.5v4" />
    </>
  ),
  // 斗鸡：鸡冠 + 喙 + 肉垂 + 尾羽
  rooster: (
    <>
      <path d="M22 12.5c1.4-2 3.2-2.6 4.4-1 .9 1.2.8 2.5.3 4" />
      <path d="M28.5 10.5c1.9-1.2 3.6-.6 4 1.3.3 1.4-.4 2.6-1.2 3.6" />
      <circle cx="24.5" cy="21" r="7.5" />
      <path d="M32 19.5h4.2l-4.2 3" />
      <path d="M26.6 28.2c-.4 2.4.9 3.6 3 3.6s3.4-1.4 3.4-3.2" />
      <path d="M17.5 22.5c-3.5 1.6-5.4 4.8-5.4 8.4 0 4.1 2.9 7.1 7 7.1 3 0 5.4-1.4 6.6-3.6" />
      <path d="M15 30c-3.2-.4-5.6-2.4-7-5.4" />
      <path d="M14.2 34.2c-3.2.2-5.8-1-7.4-3.4" />
      <circle cx="26.4" cy="20.6" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  // 麻将牌：牌面 + 一筒 + 边注
  mahjong: (
    <>
      <rect x="9" y="7" width="30" height="34" rx="5" />
      <rect x="12.5" y="10.5" width="23" height="27" rx="3.2" opacity="0.45" />
      <circle cx="24" cy="21" r="3.2" />
      <circle cx="24" cy="21" r="1.2" fill="currentColor" stroke="none" />
      <path d="M17.5 29.5h13M17.5 33h13" />
    </>
  ),
  // 龙：折线龙首 + 龙须 + 火焰
  dragon: (
    <>
      <path d="M12 14.5c1.6-2.6 4.4-4 8.4-4h7.2c5.4 0 8.4 2.4 8.4 6.5 0 3.2-1.8 5.4-4.8 6.4v3.2" />
      <path d="M31.2 26.6c0 4.8-3.4 8.2-8.2 8.2-3.6 0-6.4-1.6-8-4.2" />
      <path d="M12 14.5c -2.2 .6 -3.4 2 -3.6 4.2 -2.4 .4 -3.8 1.8 -4 4" />
      <path d="M15 22.5c-3.6 .6 -6 2.6 -7.2 6" />
      <path d="M19.5 17.5h1.2M25.5 17.5h1.2" />
      <path d="M36 12c1.8-1.6 3.8-2.2 6-1.6-1.2 1.6-1.6 3.2-1.2 4.8" />
      <path d="M35.6 30.2c1.8 1 3 2.6 3.4 4.6" />
      <circle cx="21" cy="18.6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="27" cy="18.6" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // 捕鱼：鱼身 + 尾鳍 + 鱼鳍 + 气泡
  fish: (
    <>
      <path d="M7 24c5.6-7.4 12.4-11 20-11 5.4 0 9.8 4.2 12.6 11-2.8 6.8-7.2 11-12.6 11-7.6 0-14.4-3.6-20-11Z" />
      <path d="M39.6 24c1.8-2.6 3-5 3.6-7.2v14.4c-.6-2.2-1.8-4.6-3.6-7.2Z" />
      <path d="M20.5 18.5c1.4 2.4 1.4 8.6 0 11" />
      <circle cx="30.5" cy="22" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15.5" r="1.6" opacity="0.7" />
      <circle cx="16" cy="11.5" r="1.1" opacity="0.5" />
    </>
  ),
  // 骰子：立体骰盅 + 点数
  dice: (
    <>
      <rect x="8.5" y="12.5" width="24" height="24" rx="5" />
      <path d="M32.5 19.5l7 3.4v12.6a1 1 0 0 1-1 1H32.5a1 1 0 0 1-1-1V19.5" opacity="0.55" />
      <circle cx="15" cy="19.2" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="26" cy="19.2" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="24.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="30" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="26" cy="30" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  // 金币：双圈 + 星芒
  coin: (
    <>
      <circle cx="24" cy="24" r="15.5" />
      <circle cx="24" cy="24" r="11.2" opacity="0.5" />
      <path d="M24 16.2l2.3 4.9 5.3.7-3.9 3.7 1 5.3-4.7-2.6-4.7 2.6 1-5.3-3.9-3.7 5.3-.7 2.3-4.9Z" />
    </>
  ),
  // 皇冠：三峰 + 宝石
  crown: (
    <>
      <path d="M8 18.5l6.4 5.2L24 11l9.6 12.7 6.4-5.2-2.6 17.5H10.6L8 18.5Z" />
      <path d="M11.4 33.6h25.2" />
      <circle cx="24" cy="16.4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="14.6" cy="24.4" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="33.4" cy="24.4" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="24" cy="29.4" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  // 四叶草：幸运符号
  clover: (
    <>
      <path d="M24 24c-4.4-1.2-7-3.4-7-6.6a4.6 4.6 0 0 1 7-3.9 4.6 4.6 0 0 1 7 3.9c0 3.2-2.6 5.4-7 6.6Z" />
      <path d="M24 24c1.2 4.4 3.4 7 6.6 7a4.6 4.6 0 0 0 3.9-7 4.6 4.6 0 0 0-3.9-7" />
      <path d="M24 24c-1.2 4.4-3.4 7-6.6 7a4.6 4.6 0 0 1-3.9-7" />
      <path d="M24 24v13" />
      <path d="M24 30c2.6.4 4.4 1.8 5.4 4" />
    </>
  ),
  // 体育：足球 + 五边形斑块 + 速度线
  ball: (
    <>
      <circle cx="23" cy="25" r="14" />
      <path d="M23 17.6l4.6 3.4-1.7 5.4h-5.8l-1.7-5.4L23 17.6Z" />
      <path d="M13.6 18.6l4.4 2.4M32.4 18.6l-4.4 2.4M16.4 34.6l1-5.6M29.6 34.6l-1-5.6" opacity="0.6" />
      <path d="M8 11.5h6M5 16.5h5M9 21.5h3.5" opacity="0.45" />
    </>
  ),
  // 电竞：手柄 + 十字键 + 双摇杆
  gamepad: (
    <>
      <path d="M16 17.5h16c4.4 0 7.4 3.4 8 8.2.6 4.6-1 8.3-3.8 8.3-2 0-3.2-1.2-4.6-2.6-1-1-2-1.8-3.4-1.8h-8.4c-1.4 0-2.4.8-3.4 1.8-1.4 1.4-2.6 2.6-4.6 2.6-2.8 0-4.4-3.7-3.8-8.3.6-4.8 3.6-8.2 8-8.2Z" />
      <path d="M17 21.5v5.4M14.3 24.2h5.4" />
      <circle cx="30.4" cy="22.6" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="34.2" cy="26.4" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
};

export function GameEmblem({
  emblem,
  className,
}: {
  emblem: LobbyGameEmblem;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {EMBLEMS[emblem]}
    </svg>
  );
}
