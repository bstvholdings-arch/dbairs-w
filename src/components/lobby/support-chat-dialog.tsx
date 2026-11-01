"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 顶栏 AI 客服弹窗。
 *
 * 当前没有对玩家开放的 AI / 人工坐席接口（/api/ai/chat 仅限后台且需要员工权限），
 * 所以这里是一个纯前端的客服助手：按关键词匹配常见问题并即时给出对应答复，
 * 需要人工处理时引导玩家联系在线客服。等玩家侧接口上线后，只需把
 * `handleSend` 里的本地回复替换成 fetch 即可，UI 与状态机不用改。
 */

type ChatMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

type SupportTopic = {
  id: string;
  labelKey: TranslationKey;
  replyKey: TranslationKey;
  pattern: RegExp;
};

const SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: "human",
    labelKey: "lobby.support.quick.human",
    replyKey: "lobby.support.reply.human",
    pattern: /人工|真人客服|专员|客服电话|human|agent|representative|live chat/i,
  },
  {
    id: "deposit",
    labelKey: "lobby.support.quick.deposit",
    replyKey: "lobby.support.reply.deposit",
    pattern: /充值|存款|入账|到账|deposit|top.?up|credit/i,
  },
  {
    id: "withdraw",
    labelKey: "lobby.support.quick.withdraw",
    replyKey: "lobby.support.reply.withdraw",
    pattern: /提现|出金|出款|取款|withdraw|payout|cash.?out/i,
  },
  {
    id: "bonus",
    labelKey: "lobby.support.quick.bonus",
    replyKey: "lobby.support.reply.bonus",
    pattern: /彩金|红利|优惠|奖励|返水|活动|bonus|promotion|rebate|reward|free spin/i,
  },
  {
    id: "account",
    labelKey: "lobby.support.quick.account",
    replyKey: "lobby.support.reply.account",
    pattern: /账号|账户|登录|密码|注册|验证|account|login|password|sign.?up|verify/i,
  },
  {
    id: "game",
    labelKey: "lobby.support.quick.game",
    replyKey: "lobby.support.reply.game",
    pattern: /游戏|卡住|掉线|加载|老虎机|game|stuck|lag|load|slot/i,
  },
];

const FALLBACK_REPLY_KEY: TranslationKey = "lobby.support.reply.fallback";

function resolveSupportTopic(message: string): SupportTopic | null {
  return (
    SUPPORT_TOPICS.find((topic) => topic.pattern.test(message.trim())) ?? null
  );
}

export function SupportChatDialog({
  open,
  playerName,
  onClose,
}: {
  open: boolean;
  playerName: string | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const replyTimers = useRef<number[]>([]);
  const nextMessageId = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);

  const greeting = playerName
    ? t("lobby.support.greeting", { name: playerName })
    : t("lobby.support.greetingGuest");

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 120);

    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const node = listRef.current;

    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, typing, open]);

  useEffect(
    () => () => {
      replyTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  function handleSend(raw: string) {
    const text = raw.trim();

    if (!text || typing) {
      return;
    }

    const topic = resolveSupportTopic(text);
    const replyKey = topic?.replyKey ?? FALLBACK_REPLY_KEY;

    setMessages((current) => [
      ...current,
      { id: nextMessageId.current++, role: "user", text },
    ]);
    setDraft("");
    setTyping(true);

    const timer = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId.current++,
          role: "assistant",
          text: t(replyKey),
        },
      ]);
      setTyping(false);
      inputRef.current?.focus();
    }, 650);

    replyTimers.current.push(timer);
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[115] flex items-end justify-center sm:justify-end sm:p-6">
      <button
        type="button"
        aria-label={t("lobby.support.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/75 backdrop-blur-sm sm:bg-black/55"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden border border-brand/25 bg-[#080808] shadow-[0_40px_120px_-30px_var(--sf-a65)] sm:h-[min(640px,calc(100dvh-3rem))] sm:w-[400px] sm:rounded-2xl"
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-brand-soft to-transparent"
        />


        {/* 头部：助手信息 + 在线状态 + 关闭 */}
        <header className="flex shrink-0 items-center gap-2.5 border-b border-white/[0.06] bg-gradient-to-r from-brand/15 via-[#0c0b08] to-[#080808] px-3.5 py-3">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand/35 bg-gradient-to-br from-brand-soft via-brand to-brand-deep text-brand-ink shadow-[0_0_20px_-6px_var(--sf-a90)]">
            <SupportAgentIcon className="h-4.5 w-4.5" />
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#080808] bg-emerald-400"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-[12px] font-bold text-neutral-100"
            >
              {t("lobby.support.title")}
            </h2>
            <p className="mt-0.5 flex items-center gap-1 text-[9px] text-neutral-500">
              <span
                aria-hidden="true"
                className="h-1 w-1 rounded-full bg-emerald-400"
              />
              {t("lobby.support.online")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("lobby.support.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] text-neutral-500 transition-colors hover:border-brand/30 hover:text-brand-soft"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* 消息区 */}
        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(ellipse_at_top,var(--sf-a10),transparent_60%)] px-3.5 py-4"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand/25 bg-brand/10 text-brand-soft">
              <SupportAgentIcon className="h-3 w-3" />
            </span>
            <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.05] px-3 py-2 text-[11px] leading-5 text-neutral-200">
              {greeting}
            </div>
          </div>

          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-gradient-to-br from-brand-soft to-brand-deep px-3 py-2 text-[11px] font-medium leading-5 text-brand-ink shadow-[0_10px_24px_-16px_var(--sf-a95)]">
                  {message.text}
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand/25 bg-brand/10 text-brand-soft">
                  <SupportAgentIcon className="h-3 w-3" />
                </span>
                <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.05] px-3 py-2 text-[11px] leading-5 text-neutral-200">
                  {message.text}
                </div>
              </div>
            ),
          )}

          {typing ? (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand/25 bg-brand/10 text-brand-soft">
                <SupportAgentIcon className="h-3 w-3" />
              </span>
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.05] px-3 py-2.5">
                <span className="sr-only">{t("lobby.support.typing")}</span>
                <span className="h-1 w-1 animate-bounce rounded-full bg-brand-soft [animation-delay:0ms] motion-reduce:animate-none" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-brand-soft [animation-delay:140ms] motion-reduce:animate-none" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-brand-soft [animation-delay:280ms] motion-reduce:animate-none" />
              </div>
            </div>
          ) : null}
        </div>


        {/* 快捷问题 */}
        <div className="shrink-0 border-t border-white/[0.06] px-3.5 pt-2.5">
          <p className="text-[8px] uppercase tracking-[0.2em] text-neutral-600">
            {t("lobby.support.quickLabel")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SUPPORT_TOPICS.map((topic) => (
              <button
                key={topic.id}
                type="button"
                disabled={typing}
                onClick={() => handleSend(t(topic.labelKey))}
                className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[9px] text-neutral-400 transition-colors hover:border-brand/35 hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t(topic.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* 输入框 */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSend(draft);
          }}
          className="shrink-0 px-3.5 pb-2 pt-2.5"
        >
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={500}
              disabled={typing}
              autoComplete="off"
              placeholder={t("lobby.support.placeholder")}
              aria-label={t("lobby.support.placeholder")}
              className="h-9 min-w-0 flex-1 rounded-full border border-white/[0.08] bg-black/45 px-3 text-[11px] text-neutral-100 placeholder:text-neutral-600 focus:border-brand/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/30 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!draft.trim() || typing}
              aria-label={t("lobby.support.send")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-soft via-brand to-brand-deep text-brand-ink shadow-[0_10px_24px_-12px_var(--sf-a95)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[8px] leading-4 text-neutral-600">
            {t("lobby.support.disclaimer")}
          </p>
        </form>
      </section>
    </div>
  );
}

function SupportAgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4.5 13.5v-1.7a7.5 7.5 0 0 1 15 0v1.7" />
      <rect x="3" y="13" width="4" height="6" rx="1.6" />
      <rect x="17" y="13" width="4" height="6" rx="1.6" />
      <path d="M19 19a3 3 0 0 1-3 2.4h-2" />
      <circle cx="13" cy="21.4" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m4 11.6 15.5-7.2-4.9 15.2-3.2-6.3L4 11.6Z" />
      <path d="m11.4 13.3 3.6-3.6" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
