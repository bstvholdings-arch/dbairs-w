"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  AI_CONSOLE_AGENT_TYPES,
  MAX_CHAT_MESSAGE_LENGTH,
  modelLabel,
  type AiConsoleAgentName,
  type AiProviderValue,
} from "@/lib/ai/constants";
import type { AgentFaqTenantOption } from "@/lib/ai/faq-types";
import type {
  AgentChatLogMap,
  AiAgentConfigSnapshot,
} from "@/lib/ai/records";
import type { TranslationKey } from "@/lib/i18n-types";

import { FaqDrawer } from "./faq-drawer";
import {
  AGENT_COPY_KEYS,
  type ChatMessage,
  type ChatResponse,
} from "./types";

type AgentMessageMap = Record<AiConsoleAgentName, ChatMessage[]>;
type AgentStringMap = Record<AiConsoleAgentName, string>;
type AgentBooleanMap = Record<AiConsoleAgentName, boolean>;
type AgentFeedbackMap = Record<
  AiConsoleAgentName,
  { kind: "warning" | "error"; text: string } | null
>;

type AgentTheme = {
  emoji: string;
  avatar: string;
  active: string;
};

const AGENT_THEME: Record<AiConsoleAgentName, AgentTheme> = {
  sales: {
    emoji: "💼",
    avatar: "border-[#d4af37]/35 bg-[#d4af37]/15 text-[#f0d27c]",
    active: "border-[#d4af37]/40 bg-[#d4af37]/[0.09]",
  },
  tech: {
    emoji: "🔧",
    avatar: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    active: "border-sky-400/35 bg-sky-400/[0.08]",
  },
  finance: {
    emoji: "💰",
    avatar: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    active: "border-emerald-400/35 bg-emerald-400/[0.08]",
  },
  audit: {
    emoji: "🛡️",
    avatar: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    active: "border-rose-400/35 bg-rose-400/[0.08]",
  },
  strategist: {
    emoji: "🧭",
    avatar: "border-violet-400/30 bg-violet-400/10 text-violet-200",
    active: "border-violet-400/35 bg-violet-400/[0.08]",
  },
};

const AGENT_STARTER_KEYS: Record<AiConsoleAgentName, TranslationKey> = {
  sales: "aiConsole.assistants.starter.sales",
  tech: "aiConsole.assistants.starter.tech",
  finance: "aiConsole.assistants.starter.finance",
  audit: "aiConsole.assistants.starter.audit",
  strategist: "aiConsole.assistants.starter.strategist",
};

function emptyByAgent<T>(value: T): Record<AiConsoleAgentName, T> {
  return AI_CONSOLE_AGENT_TYPES.reduce(
    (accumulator, agentName) => {
      accumulator[agentName] = value;
      return accumulator;
    },
    {} as Record<AiConsoleAgentName, T>,
  );
}

function messagesFromLogs(logs: AgentChatLogMap): AgentMessageMap {
  return AI_CONSOLE_AGENT_TYPES.reduce(
    (accumulator, agentName) => {
      accumulator[agentName] = logs[agentName]
        .slice()
        .reverse()
        .map((log) => ({
          id: log.id,
          role: log.role === "user" ? "user" : "assistant",
          content: log.content,
          createdAt: log.createdAt,
        }));
      return accumulator;
    },
    {} as AgentMessageMap,
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

export function AssistantChat({
  agents,
  initialLogsByAgent,
  tenants,
  cloudEnabled,
  runtimeModel,
  runtimeProvider,
}: {
  agents: AiAgentConfigSnapshot[];
  initialLogsByAgent: AgentChatLogMap;
  tenants: AgentFaqTenantOption[];
  cloudEnabled: boolean;
  runtimeModel: string | null;
  runtimeProvider: AiProviderValue;
}) {
  const { t, language } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [activeAgent, setActiveAgent] =
    useState<AiConsoleAgentName>("sales");
  const [faqOpen, setFaqOpen] = useState(false);
  const [faqTenantId, setFaqTenantId] = useState("");
  const [messagesByAgent, setMessagesByAgent] = useState<AgentMessageMap>(
    () => messagesFromLogs(initialLogsByAgent),
  );
  const [drafts, setDrafts] = useState<AgentStringMap>(() =>
    emptyByAgent(""),
  );
  const [sendingByAgent, setSendingByAgent] = useState<AgentBooleanMap>(() =>
    emptyByAgent(false),
  );
  const [feedbackByAgent, setFeedbackByAgent] =
    useState<AgentFeedbackMap>(() => emptyByAgent(null));
  const listRef = useRef<HTMLDivElement>(null);
  const resetContextRef = useRef<AgentBooleanMap>(emptyByAgent(false));
  const contextStartedAtRef = useRef<AgentStringMap>(emptyByAgent(""));

  const activeMessages = messagesByAgent[activeAgent];
  const activeDraft = drafts[activeAgent];
  const activeSending = sendingByAgent[activeAgent];
  const activeFeedback = feedbackByAgent[activeAgent];
  const activeConfig = agents.find(
    (agent) => agent.agentName === activeAgent,
  );
  const activeEnabled = activeConfig?.isEnabled ?? true;
  const activeTheme = AGENT_THEME[activeAgent];
  const activeName = t(AGENT_COPY_KEYS[activeAgent].name);
  const activeDescription = t(AGENT_COPY_KEYS[activeAgent].description);
  const requestedModel = activeConfig?.model || runtimeModel || "";
  const requestedProvider = requestedModel.startsWith("deepseek-")
    ? "deepseek"
    : requestedModel.startsWith("gpt-")
      ? "openai"
      : null;
  // 与后端 resolveAiConnection 一致：Agent 模型与全局供应商不匹配时回退全局模型。
  const activeModel = modelLabel(
    requestedProvider && requestedProvider !== runtimeProvider
      ? runtimeModel || requestedModel
      : requestedModel,
  );

  useEffect(() => {
    const node = listRef.current;

    if (!node) {
      return;
    }

    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [activeAgent, activeMessages.length, activeSending]);

  function updateDraft(agentName: AiConsoleAgentName, value: string) {
    setDrafts((previous) => ({ ...previous, [agentName]: value }));
  }

  function updateFeedback(
    agentName: AiConsoleAgentName,
    value: AgentFeedbackMap[AiConsoleAgentName],
  ) {
    setFeedbackByAgent((previous) => ({
      ...previous,
      [agentName]: value,
    }));
  }

  const closeFaqDrawer = useCallback(() => setFaqOpen(false), []);

  function startNewChat(agentName: AiConsoleAgentName) {
    if (sendingByAgent[agentName]) {
      return;
    }

    // 只清空当前助手的视图与上下文，其他助手完全不受影响。
    // 首轮由服务端返回新的 contextStartedAt，后续请求按该时间过滤历史，不删日志。
    resetContextRef.current[agentName] = true;
    contextStartedAtRef.current[agentName] = "";
    setMessagesByAgent((previous) => ({ ...previous, [agentName]: [] }));
    setDrafts((previous) => ({ ...previous, [agentName]: "" }));
    updateFeedback(agentName, null);
  }

  async function sendMessage(
    agentName: AiConsoleAgentName,
    textOverride?: string,
  ) {
    const text = (textOverride ?? drafts[agentName]).trim();

    if (!text || sendingByAgent[agentName]) {
      return;
    }

    const config = agents.find((agent) => agent.agentName === agentName);

    if (config && !config.isEnabled) {
      updateFeedback(agentName, {
        kind: "error",
        text: t("aiConsole.assistants.disabledHint"),
      });
      return;
    }

    const history = messagesByAgent[agentName]
      .filter((message) => message.content.trim())
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const optimistic: ChatMessage = {
      id: `pending-${agentName}-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessagesByAgent((previous) => ({
      ...previous,
      [agentName]: [...previous[agentName], optimistic],
    }));
    setDrafts((previous) => ({ ...previous, [agentName]: "" }));
    setSendingByAgent((previous) => ({
      ...previous,
      [agentName]: true,
    }));
    updateFeedback(agentName, null);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          agentType: agentName,
          history,
          resetContext: resetContextRef.current[agentName] === true,
          contextStartedAt:
            contextStartedAtRef.current[agentName] || undefined,
          tenantId: faqTenantId || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ChatResponse;

      if (!response.ok || !data.reply) {
        throw new Error(
          data.error ?? t("aiConsole.assistants.error"),
        );
      }

      const reply = data.reply;

      setMessagesByAgent((previous) => ({
        ...previous,
        [agentName]: [
          ...previous[agentName],
          {
            id: reply.id,
            role: "assistant",
            content: reply.content,
            createdAt: reply.createdAt,
            fallback: data.fallback,
            model: data.model,
            faqCount: data.faqMatches?.length ?? 0,
          },
        ],
      }));
      resetContextRef.current[agentName] = false;

      if (data.contextStartedAt) {
        contextStartedAtRef.current[agentName] = data.contextStartedAt;
      }

      if (data.warning) {
        updateFeedback(agentName, {
          kind: "warning",
          text: data.warning,
        });
      }
    } catch (sendError) {
      updateFeedback(agentName, {
        kind: "error",
        text:
          sendError instanceof Error
            ? sendError.message
            : t("aiConsole.assistants.error"),
      });
    } finally {
      setSendingByAgent((previous) => ({
        ...previous,
        [agentName]: false,
      }));
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-[28px] border border-[#d4af37]/15 bg-[#080808]/90 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
      <div className="grid min-h-[640px] lg:h-[calc(100vh-15rem)] lg:min-h-[680px] lg:grid-cols-[286px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-white/[0.06] bg-black/30 lg:border-b-0 lg:border-r">
          <div className="border-b border-white/[0.06] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/70">
                <span className="h-px w-5 bg-[#d4af37]/60" />
                {t("aiConsole.assistants.eyebrow")}
              </p>
              <span className="rounded-full border border-[#d4af37]/20 bg-[#d4af37]/10 px-2 py-0.5 font-mono text-[9px] text-[#f0d27c]">
                5
              </span>
            </div>
            <h2 className="mt-3 text-lg font-semibold tracking-tight text-white">
              {t("aiConsole.assistants.title")}
            </h2>
            <p className="mt-1.5 text-[10px] leading-5 text-neutral-500">
              {t("aiConsole.assistants.subtitle")}
            </p>
          </div>

          <div className="flex gap-2 overflow-x-auto p-3 lg:flex-1 lg:flex-col lg:overflow-y-auto">
            {AI_CONSOLE_AGENT_TYPES.map((agentName) => {
              const config = agents.find(
                (agent) => agent.agentName === agentName,
              );
              const enabled = config?.isEnabled ?? true;
              const theme = AGENT_THEME[agentName];
              const name = t(AGENT_COPY_KEYS[agentName].name);
              const description = t(
                AGENT_COPY_KEYS[agentName].description,
              );
              const selected = activeAgent === agentName;
              const messageCount = messagesByAgent[agentName].length;

              return (
                <button
                  key={agentName}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setActiveAgent(agentName)}
                  className={`group flex w-[228px] shrink-0 items-center gap-3 rounded-2xl border p-3 text-left transition-all lg:w-full ${
                    selected
                      ? theme.active
                      : "border-transparent hover:border-white/[0.07] hover:bg-white/[0.03]"
                  } ${enabled ? "" : "opacity-65"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg ${theme.avatar}`}
                  >
                    {theme.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`truncate text-xs font-semibold ${
                          selected ? "text-white" : "text-neutral-300"
                        }`}
                      >
                        {name}
                      </span>
                      {selected ? (
                        <span className="h-1 w-1 shrink-0 rounded-full bg-[#d4af37]" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-neutral-600">
                      {enabled
                        ? description
                        : t("aiConsole.assistants.disabled")}
                    </span>
                    {messageCount > 0 ? (
                      <span className="mt-1 inline-flex rounded-full border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[8px] text-neutral-500">
                        {t("aiConsole.assistants.messageCount", {
                          count: messageCount,
                        })}
                      </span>
                    ) : null}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      enabled ? "bg-emerald-400" : "bg-neutral-600"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <div className="hidden border-t border-white/[0.06] p-4 lg:block">
            <div className="flex items-center justify-between gap-2 text-[9px] text-neutral-600">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    cloudEnabled ? "bg-emerald-400" : "bg-neutral-600"
                  }`}
                />
                {cloudEnabled
                  ? t("aiConsole.runtime.cloud")
                  : t("aiConsole.runtime.local")}
              </span>
              <span className="font-mono text-neutral-700">
                {t("aiConsole.assistants.independent")}
              </span>
            </div>
            <p className="mt-2 text-[9px] leading-4 text-neutral-600">
              {t("aiConsole.assistants.sidebarHint")}
            </p>
          </div>
        </aside>

        <div className="flex min-h-0 flex-col">
          <header className="flex flex-col gap-3 border-b border-white/[0.06] bg-white/[0.015] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg ${activeTheme.avatar}`}
              >
                {activeTheme.emoji}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-white">
                    {activeName}
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] ${
                      activeEnabled
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : "border-red-400/20 bg-red-400/10 text-red-300"
                    }`}
                  >
                    <span className="h-1 w-1 rounded-full bg-current" />
                    {activeEnabled
                      ? t("aiConsole.assistants.enabled")
                      : t("aiConsole.assistants.disabled")}
                  </span>
                  {activeModel ? (
                    <span className="rounded-full border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[8px] text-neutral-400">
                      {activeModel}
                    </span>
                  ) : null}
                  {activeConfig ? (
                    <span className="font-mono text-[8px] text-neutral-600">
                      {activeConfig.tokenLimit} tokens
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[10px] text-neutral-500">
                  {activeDescription}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.06] px-2 py-1 text-[9px] text-neutral-500 sm:inline-flex">
                <span className="h-1 w-1 rounded-full bg-[#d4af37]" />
                {t("aiConsole.assistants.contextIsolation")}
              </span>
              <select
                value={faqTenantId}
                onChange={(event) => setFaqTenantId(event.target.value)}
                aria-label={t("aiConsole.assistants.faq.scopeLabel")}
                title={t("aiConsole.assistants.faq.scopeHint")}
                className="h-8 max-w-[132px] rounded-lg border border-white/[0.08] bg-black/30 px-2 text-[10px] text-neutral-300 outline-none transition-colors hover:border-[#d4af37]/30 focus:border-[#d4af37]/40"
              >
                <option value="">
                  {t("aiConsole.assistants.faq.form.platform")}
                </option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setFaqOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[10px] text-neutral-300 transition-colors hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
              >
                <span aria-hidden="true">📚</span>
                {t("aiConsole.assistants.faq.button")}
              </button>
              <button
                type="button"
                onClick={() => startNewChat(activeAgent)}
                disabled={activeSending}
                className="h-8 rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.07] px-3 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("aiConsole.assistants.newChat")}
              </button>
            </div>
          </header>

          {activeFeedback ? (
            <div
              className={`mx-4 mt-3 rounded-xl border px-3 py-2 text-[10px] leading-5 sm:mx-5 ${
                activeFeedback.kind === "error"
                  ? "border-red-400/20 bg-red-400/[0.07] text-red-200"
                  : "border-[#d4af37]/20 bg-[#d4af37]/[0.07] text-[#f0d27c]"
              }`}
            >
              <span className="mr-1 font-mono text-[9px] uppercase tracking-wider opacity-70">
                {activeFeedback.kind === "error"
                  ? "ERROR"
                  : t("aiConsole.chat.warning")}
              </span>
              {activeFeedback.text}
            </div>
          ) : null}

          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-label={activeName}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
          >
            {activeMessages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center pb-8 text-center">
                <span
                  aria-hidden="true"
                  className={`flex h-16 w-16 items-center justify-center rounded-2xl border text-3xl shadow-[0_0_45px_rgba(212,175,55,0.12)] ${activeTheme.avatar}`}
                >
                  {activeTheme.emoji}
                </span>
                <p className="mt-5 text-[9px] uppercase tracking-[0.26em] text-[#d4af37]/60">
                  {t("aiConsole.assistants.emptyEyebrow")}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-neutral-100">
                  {t("aiConsole.assistants.emptyTitle", {
                    name: activeName,
                  })}
                </h3>
                <p className="mt-2 max-w-md text-[11px] leading-5 text-neutral-500">
                  {t("aiConsole.assistants.emptyHint", {
                    name: activeName,
                    description: activeDescription,
                  })}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    updateDraft(
                      activeAgent,
                      t(AGENT_STARTER_KEYS[activeAgent]),
                    )
                  }
                  className="mt-5 w-full rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-left text-[11px] leading-5 text-neutral-400 transition-colors hover:border-[#d4af37]/25 hover:bg-[#d4af37]/[0.05] hover:text-neutral-200"
                >
                  <span className="mr-2 text-[#d4af37]">✦</span>
                  {t(AGENT_STARTER_KEYS[activeAgent])}
                </button>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
                {activeMessages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    agentName={activeName}
                    agentEmoji={activeTheme.emoji}
                    avatarClass={activeTheme.avatar}
                    locale={locale}
                    fallbackLabel={t("aiConsole.chat.fallback")}
                    youLabel={t("aiConsole.assistants.you")}
                    faqLabel={
                      message.faqCount
                        ? t("aiConsole.assistants.faq.faqUsed", {
                            count: message.faqCount,
                          })
                        : null
                    }
                  />
                ))}
              </div>
            )}

            {activeSending ? (
              <div className="mx-auto mt-4 flex w-full max-w-4xl">
                <TypingBubble
                  label={t("aiConsole.assistants.typing", {
                    name: activeName,
                  })}
                  emoji={activeTheme.emoji}
                  avatarClass={activeTheme.avatar}
                />
              </div>
            ) : null}

          </div>

          <footer className="border-t border-white/[0.06] bg-black/20 p-3 sm:p-4">
            {!activeEnabled ? (
              <div className="mb-2 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[10px] leading-5 text-red-200">
                {t("aiConsole.assistants.disabledHint")}
              </div>
            ) : null}
            <div
              className={`flex items-end gap-2 rounded-2xl border bg-black/40 p-2 transition-colors ${
                activeEnabled
                  ? "border-[#d4af37]/15 focus-within:border-[#d4af37]/40"
                  : "border-white/[0.06] opacity-60"
              }`}
            >
              <textarea
                value={activeDraft}
                onChange={(event) =>
                  updateDraft(activeAgent, event.target.value)
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void sendMessage(activeAgent);
                  }
                }}
                rows={1}
                maxLength={MAX_CHAT_MESSAGE_LENGTH}
                disabled={!activeEnabled || activeSending}
                placeholder={t("aiConsole.assistants.placeholder", {
                  name: activeName,
                })}
                aria-label={t("aiConsole.assistants.placeholder", {
                  name: activeName,
                })}
                className="max-h-36 min-h-[46px] flex-1 resize-none bg-transparent px-3 py-3 text-xs leading-5 text-neutral-200 outline-none placeholder:text-neutral-600 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => void sendMessage(activeAgent)}
                disabled={
                  !activeEnabled || activeSending || !activeDraft.trim()
                }
                className="h-10 shrink-0 rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/15 px-4 text-[11px] font-semibold text-[#f0d27c] transition-colors hover:bg-[#d4af37]/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeSending
                  ? t("aiConsole.assistants.sending")
                  : t("aiConsole.assistants.send")}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] text-neutral-600">
              <span>{t("aiConsole.assistants.privacy")}</span>
              <span className="font-mono">
                {activeDraft.length}/{MAX_CHAT_MESSAGE_LENGTH}
              </span>
            </div>
          </footer>

        </div>
      </div>
      </section>

      {faqOpen ? (
        <FaqDrawer
          key={activeAgent}
          open
          agentName={activeAgent}
          agentLabel={activeName}
          agentEmoji={activeTheme.emoji}
          avatarClass={activeTheme.avatar}
          tenants={tenants}
          onClose={closeFaqDrawer}
        />
      ) : null}
    </>
  );
}

function MessageBubble({
  message,
  agentName,
  agentEmoji,
  avatarClass,
  locale,
  fallbackLabel,
  youLabel,
  faqLabel,
}: {
  message: ChatMessage;
  agentName: string;
  agentEmoji: string;
  avatarClass: string;
  locale: "zh-CN" | "en-US";
  fallbackLabel: string;
  youLabel: string;
  faqLabel: string | null;
}) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border font-bold ${
          isUser
            ? "border-white/10 bg-white/[0.04] font-mono text-[8px] text-neutral-400"
            : `text-sm ${avatarClass}`
        }`}
      >
        {isUser ? "ME" : agentEmoji}
      </span>
      <div
        className={`flex max-w-[84%] flex-col ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`mb-1 flex items-center gap-2 px-1 text-[9px] text-neutral-600 ${
            isUser ? "justify-end" : ""
          }`}
        >
          <span className={isUser ? "text-[#f0d27c]" : "text-neutral-400"}>
            {isUser ? youLabel : agentName}
          </span>
          <span>{formatTime(message.createdAt, locale)}</span>
        </div>
        <div
          className={`rounded-2xl border px-4 py-3 ${
            isUser
              ? "rounded-tr-sm border-[#d4af37]/25 bg-[#d4af37]/10"
              : "rounded-tl-sm border-white/[0.07] bg-[#0e0e0e]"
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-neutral-200">
            {message.content}
          </p>
        </div>
        {!isUser && (message.model || message.fallback || faqLabel) ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1">
            {message.fallback ? (
              <span className="rounded-full border border-[#d4af37]/20 bg-[#d4af37]/[0.07] px-2 py-0.5 text-[8px] text-[#f0d27c]">
                {fallbackLabel}
              </span>
            ) : null}
            {faqLabel ? (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-0.5 text-[8px] text-emerald-300">
                {faqLabel}
              </span>
            ) : null}
            {message.model ? (
              <span className="rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 font-mono text-[8px] text-neutral-500">
                {message.model}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TypingBubble({
  label,
  emoji,
  avatarClass,
}: {
  label: string;
  emoji: string;
  avatarClass: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 items-center justify-center rounded-xl border text-sm ${avatarClass}`}
      >
        {emoji}
      </span>
      <span className="inline-flex items-center gap-2 rounded-2xl rounded-tl-sm border border-white/[0.07] bg-[#0e0e0e] px-4 py-3 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d4af37]" />
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d4af37]/70"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d4af37]/40"
            style={{ animationDelay: "300ms" }}
          />
        </span>
        {label}
      </span>
    </div>
  );
}


