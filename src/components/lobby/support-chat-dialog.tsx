"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_TOPICS,
  supportReplyKeyFor,
} from "@/lib/support-chat";

/**
 * 顶栏 AI 客服弹窗。
 *
 * 回复规则与「写入商户后台 AI 客服监控」的日志都由 /api/player/support/chat 负责
 * （服务端按同一份关键词表 src/lib/support-chat.ts 生成文案并落库）。
 * 网络或数据库异常时退回本地同规则文案，保证玩家侧客服窗口永远可用。
 */

type ChatMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

export function SupportChatDialog({
  open,
  playerName,
  onClose,
}: {
  open: boolean;
  playerName: string | null;
  onClose: () => void;
}) {
  const { language, t } = useLanguage();
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

  async function handleSend(raw: string) {
    const text = raw.trim();

    if (!text || typing) {
      return;
    }

    const replyKey = supportReplyKeyFor(text);

    setMessages((current) => [
      ...current,
      { id: nextMessageId.current++, role: "user", text },
    ]);
    setDraft("");
    setTyping(true);

    // 服务端生成回复并写入商户后台的 AI 客服监控；失败时用本地同规则文案兜底。
    let replyText = "";

    try {
      const response = await fetch("/api/player/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ message: text, language }),
      });

      if (response.ok) {
        const data = (await response.json().catch(() => null)) as {
          reply?: { content?: unknown };
        } | null;
        const content = data?.reply?.content;

        if (typeof content === "string" && content.trim()) {
          replyText = content.trim();
        }
      }
    } catch {
      // 断网 / 接口异常：保持原有本地客服体验，不向玩家抛错。
    }

    const timer = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId.current++,
          role: "assistant",
          text: replyText || t(replyKey),
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
                onClick={() => void handleSend(t(topic.labelKey))}
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
            void handleSend(draft);
          }}
          className="shrink-0 px-3.5 pb-2 pt-2.5"
        >
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
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
