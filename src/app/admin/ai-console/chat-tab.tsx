"use client";

import { useEffect, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type {
  SerializedAiChatLog,
  SerializedLeadRecord,
} from "@/lib/ai/records";

import {
  LEAD_STATUS_LABEL_KEYS,
  type ChatMessage,
  type ChatResponse,
  type LogsResponse,
} from "./types";

/**
 * 「销售对话」Tab。
 *
 * - 未绑定线索时使用前端 history 作为上下文；
 * - 填写品牌 + 联系方式后，服务端会 upsert 线索并以数据库历史为准；
 * - AI 识别到战败时会调用工具写入 status=failed / failReason，这里给出提示；
 * - 所有消息由服务端脱敏后再落库，界面只负责展示。
 */
export function ChatTab({
  initialLogs,
  initialLead,
  onOpenWarRoom,
}: {
  initialLogs: SerializedAiChatLog[];
  initialLead: SerializedLeadRecord | null;
  onOpenWarRoom: () => void;
}) {
  const { t, language } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recentLogs, setRecentLogs] = useState(initialLogs);
  const [brandName, setBrandName] = useState(initialLead?.brandName ?? "");
  const [tgOrEmail, setTgOrEmail] = useState(initialLead?.tgOrEmail ?? "");
  const [leadId, setLeadId] = useState<string | null>(
    initialLead?.id ?? null,
  );
  const [boundLead, setBoundLead] = useState<SerializedLeadRecord | null>(
    initialLead,
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "warning";
    text: string;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const bound = Boolean(leadId || boundLead);

  // 从看板「去对话」进来时，把该线索的历史消息铺到聊天窗口。
  useEffect(() => {
    if (!initialLead) {
      return;
    }

    let cancelled = false;
    const query = new URLSearchParams({
      agentType: "sales",
      leadId: initialLead.id,
      take: "40",
    });

    void (async () => {
      try {
        const response = await fetch(`/api/ai/log?${query.toString()}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as LogsResponse;

        if (!cancelled && response.ok && data.logs) {
          setMessages(
            data.logs
              .slice()
              .reverse()
              .map((log) => ({
                id: log.id,
                role: log.role === "user" ? "user" : "assistant",
                content: log.content,
                createdAt: log.createdAt,
              })),
          );
        }
      } catch {
        // 历史加载失败不影响新对话，服务端仍会带上数据库上下文。
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialLead]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();

    if (!text || sending) {
      return;
    }

    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const history = messages
      .filter((message) => message.content.trim())
      .slice(-20)
      .map((message) => ({ role: message.role, content: message.content }));

    setMessages((previous) => [...previous, optimistic]);
    setRecentLogs((previous) => [
      {
        id: optimistic.id,
        role: "user",
        content: text,
        agentType: "sales",
        leadId,
        createdAt: optimistic.createdAt,
      },
      ...previous,
    ]);
    setInput("");
    setSending(true);
    setError(null);
    setNotice(null);

    try {
      const body: Record<string, unknown> = {
        message: text,
        agentType: "sales",
        history,
      };

      if (leadId) {
        body.leadId = leadId;
      } else if (brandName.trim() && tgOrEmail.trim()) {
        body.brandName = brandName.trim();
        body.tgOrEmail = tgOrEmail.trim();
      }

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as ChatResponse;

      if (!response.ok || !data.reply) {
        throw new Error(data.error ?? t("aiConsole.chat.error"));
      }

      const reply = data.reply;
      const assistantMessage: ChatMessage = {
        id: reply.id,
        role: "assistant",
        content: reply.content,
        createdAt: reply.createdAt,
        fallback: data.fallback,
      };

      setMessages((previous) => [...previous, assistantMessage]);
      setRecentLogs((previous) => [
        {
          id: reply.id,
          role: "assistant",
          content: reply.content,
          agentType: "sales",
          leadId: reply.leadId,
          createdAt: reply.createdAt,
        },
        ...previous,
      ]);

      if (data.lead) {
        setLeadId(data.lead.id);
        setBoundLead(data.lead);
        setBrandName((previous) => previous || data.lead?.brandName || "");
        setTgOrEmail((previous) => previous || data.lead?.tgOrEmail || "");
      }

      if (data.failureReasonSaved && data.failReason) {
        setNotice({
          kind: "success",
          text: t("aiConsole.chat.failSaved", { reason: data.failReason }),
        });
      } else if (data.warning) {
        setNotice({ kind: "warning", text: data.warning });
      }
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : t("aiConsole.chat.error"),
      );
    } finally {
      setSending(false);
    }
  }

  function resetConversation() {
    setMessages([]);
    setLeadId(null);
    setBoundLead(null);
    setBrandName("");
    setTgOrEmail("");
    setInput("");
    setError(null);
    setNotice(null);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">
            {t("aiConsole.chat.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-neutral-500">
            {t("aiConsole.chat.subtitle")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onOpenWarRoom}
            className="h-9 rounded-xl border border-white/[0.08] px-3 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/25 hover:text-neutral-200"
          >
            {t("aiConsole.tab.warRoom")}
          </button>
          <button
            type="button"
            onClick={resetConversation}
            className="h-9 rounded-xl border border-white/[0.08] px-3 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/25 hover:text-neutral-200"
          >
            {t("aiConsole.chat.newConversation")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.015]">
          <div
            ref={listRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5"
            style={{ maxHeight: "58vh" }}
          >
            {messages.length === 0 ? (
              <ChatEmpty onPick={(text) => void sendMessage(text)} />
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  locale={locale}
                  fallbackLabel={t("aiConsole.chat.fallback")}
                />
              ))
            )}
            {sending ? <TypingBubble label={t("aiConsole.chat.sending")} /> : null}
          </div>

          {notice ? (
            <div
              className={`mx-4 mb-2 rounded-xl border px-3 py-2 text-[11px] leading-5 sm:mx-5 ${
                notice.kind === "success"
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                  : "border-amber-400/20 bg-amber-400/10 text-amber-200"
              }`}
            >
              {notice.text}
            </div>
          ) : null}

          {error ? (
            <div className="mx-4 mb-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] leading-5 text-red-200 sm:mx-5">
              {error}
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage();
            }}
            className="border-t border-white/[0.06] bg-black/10 p-3 sm:p-4"
          >
            <textarea
              value={input}
              rows={3}
              maxLength={4000}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={t("aiConsole.chat.inputPlaceholder")}
              className="w-full resize-none rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5 text-xs leading-5 text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-[#d4af37]/30"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-[70%] text-[9px] leading-4 text-neutral-600">
                {t("aiConsole.chat.privacy")}
              </p>
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="h-9 shrink-0 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-[11px] font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending
                  ? t("aiConsole.chat.sending")
                  : t("aiConsole.chat.send")}
              </button>
            </div>
          </form>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-neutral-200">
                  {t("aiConsole.chat.contextTitle")}
                </h3>
                <p className="mt-1 text-[10px] leading-4 text-neutral-600">
                  {t("aiConsole.chat.contextHint")}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${
                  bound
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                    : "border-white/10 bg-white/[0.03] text-neutral-500"
                }`}
              >
                {bound
                  ? t("aiConsole.chat.bound")
                  : t("aiConsole.chat.unbound")}
              </span>
            </div>

            {boundLead ? (
              <div className="mt-3 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.06] px-3 py-2.5">
                <p className="text-xs font-medium text-neutral-100">
                  {boundLead.brandName}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-neutral-400">
                  {boundLead.tgOrEmail}
                </p>
                <span
                  className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[9px] ${leadStatusClass(
                    boundLead.status,
                  )}`}
                >
                  {t(LEAD_STATUS_LABEL_KEYS[boundLead.status])}
                  {boundLead.failReason ? ` · ${boundLead.failReason}` : ""}
                </span>
              </div>
            ) : null}

            <label className="mt-4 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                {t("aiConsole.chat.brand")}
              </span>
              <input
                value={brandName}
                disabled={Boolean(leadId)}
                onChange={(event) => setBrandName(event.target.value)}
                placeholder={t("aiConsole.chat.brandPlaceholder")}
                className="mt-1.5 h-9 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[#d4af37]/30 disabled:opacity-60"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                {t("aiConsole.chat.contact")}
              </span>
              <input
                value={tgOrEmail}
                disabled={Boolean(leadId)}
                onChange={(event) => setTgOrEmail(event.target.value)}
                placeholder={t("aiConsole.chat.contactPlaceholder")}
                className="mt-1.5 h-9 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[#d4af37]/30 disabled:opacity-60"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4">
            <h3 className="text-xs font-semibold text-neutral-200">
              {t("aiConsole.chat.recent")}
            </h3>
            {recentLogs.length === 0 ? (
              <p className="mt-3 text-[10px] text-neutral-600">
                {t("aiConsole.chat.recentEmpty")}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {recentLogs.slice(0, 8).map((log) => (
                  <li
                    key={log.id}
                    className="rounded-lg border border-white/[0.04] bg-white/[0.02] px-2.5 py-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-[9px] text-neutral-600">
                      <span
                        className={
                          log.role === "user"
                            ? "text-[#f0d27c]"
                            : "text-emerald-300"
                        }
                      >
                        {log.role === "user" ? "USER" : "AI"}
                      </span>
                      <span>{formatTime(log.createdAt, locale)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 break-words text-[10px] leading-4 text-neutral-500">
                      {log.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

const SUGGESTION_KEYS = [
  "aiConsole.chat.suggestionPrice",
  "aiConsole.chat.suggestionTraffic",
  "aiConsole.chat.suggestionTrust",
] as const;

function ChatEmpty({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useLanguage();

  return (
    <div className="flex h-full min-h-[340px] flex-col items-center justify-center gap-3 px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#d4af37]/25 bg-[#d4af37]/10 font-mono text-xs font-bold text-[#f0d27c]">
        AI
      </span>
      <h3 className="text-sm font-semibold text-neutral-100">
        {t("aiConsole.chat.emptyTitle")}
      </h3>
      <p className="max-w-md text-[11px] leading-5 text-neutral-500">
        {t("aiConsole.chat.emptyHint")}
      </p>
      <div className="mt-2 flex w-full max-w-md flex-col gap-2">
        {SUGGESTION_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(t(key))}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left text-[11px] leading-5 text-neutral-400 transition-colors hover:border-[#d4af37]/25 hover:text-neutral-200"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  locale,
  fallbackLabel,
}: {
  message: ChatMessage;
  locale: "zh-CN" | "en-US";
  fallbackLabel: string;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 font-mono text-[9px] font-bold text-[#f0d27c]">
          AI
        </span>
      ) : null}
      <div
        className={`max-w-[85%] rounded-2xl border px-3.5 py-2.5 ${
          isUser
            ? "border-[#d4af37]/20 bg-[#d4af37]/10"
            : "border-white/[0.06] bg-white/[0.03]"
        }`}
      >
        <div className="flex items-center justify-between gap-4 text-[9px] text-neutral-600">
          <span className={isUser ? "text-[#f0d27c]" : "text-emerald-300"}>
            {isUser ? "USER" : "AI"}
          </span>
          <span>{formatTime(message.createdAt, locale)}</span>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-neutral-200">
          {message.content}
        </p>
        {message.fallback ? (
          <span className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[9px] text-neutral-500">
            {fallbackLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TypingBubble({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 font-mono text-[9px] font-bold text-[#f0d27c]">
        AI
      </span>
      <span className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[10px] text-neutral-500">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d4af37]" />
        {label}
      </span>
    </div>
  );
}

function formatTime(value: string, locale: "zh-CN" | "en-US") {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function leadStatusClass(status: string) {
  switch (status) {
    case "success":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
    case "failed":
      return "border-red-400/20 bg-red-400/10 text-red-300";
    default:
      return "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]";
  }
}
