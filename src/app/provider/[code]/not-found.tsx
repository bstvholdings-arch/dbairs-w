import Link from "next/link";

import { GameEmblem } from "@/components/lobby/game-emblem";

/**
 * 游戏商展馆的 404 边界。
 *
 * 说明：这里必须是 Server Component，不能调用 useLanguage()。
 * notFound() 抛出后应用会在根部的 __next_error__ 外壳里渲染这个文件，
 * 此时根布局里的 <LanguageProvider> 并不存在，任何 useLanguage() 都会
 * 直接抛错，结果被降级成 Next 默认的黑白 404（线上现象就是「找不到页面」）。
 * 因为语言偏好只存在 localStorage（服务端读不到），这里用中英双行文案兜底。
 */
export default function ProviderHallNotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#040404] px-4 py-16 font-sans text-neutral-200">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] rounded-full bg-[#d4af37]/10 blur-[140px]" />
        <div className="absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-[#8a6a1f]/15 blur-[160px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.78)_100%)]" />
      </div>

      <section className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#d4af37]/25 bg-[#080808]/95 px-6 py-10 text-center shadow-[0_30px_80px_-24px_rgba(0,0,0,0.95)] backdrop-blur sm:px-9">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f0d27c]/80 to-transparent"
        />

        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/25 to-transparent text-[#f0d27c]">
          <GameEmblem emblem="crown" className="h-9 w-9" />
        </div>

        <p className="mt-5 text-[9px] font-bold uppercase tracking-[0.3em] text-[#f0d27c]/75">
          404
        </p>
        <h1 className="mt-1.5 text-xl font-black tracking-tight text-white sm:text-2xl">
          This hall does not exist
        </h1>
        <p className="mt-1 text-[13px] font-semibold text-neutral-300">
          这个游戏商展馆不存在
        </p>
        <p className="mx-auto mt-2.5 max-w-[300px] text-[11px] leading-5 text-neutral-400">
          The brand link is wrong or the provider was taken offline. Head back to
          the lobby to pick another hall.
          <br />
          链接有误，或该游戏商已下架。回到大厅重新选择展馆吧。
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-6 text-[11px] font-black uppercase tracking-[0.12em] text-[#171105] shadow-[0_16px_36px_-16px_rgba(212,175,55,0.95)] transition-shadow hover:shadow-[0_20px_44px_-14px_rgba(212,175,55,0.85)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0d27c]/70"
        >
          Back to lobby · 返回大厅
        </Link>
      </section>
    </main>
  );
}
