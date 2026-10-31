"use client";

import { useEffect, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  AGENT_MODEL_OPTIONS,
  AI_MODEL_OPTIONS,
  AI_PROVIDERS,
  DEFAULT_AI_BASE_URLS,
  modelLabel,
  type AiConsoleAgentName,
  type AiProviderValue,
} from "@/lib/ai/constants";
import type { AiAgentConfigSnapshot } from "@/lib/ai/records";
import type { AiSettingsSnapshot } from "@/lib/ai/settings";

import {
  AGENT_COPY_KEYS,
  type AiAgentsResponse,
  type AiSettingsResponse,
  type TestChatMessage,
  type TestChatResponse,
} from "./types";

const inputClass =
  "h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-[#d4af37]/35 disabled:cursor-not-allowed disabled:opacity-50";

const labelClass =
  "text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500";

const textareaClass =
  "w-full resize-y rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2.5 text-[11px] leading-5 text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-[#d4af37]/35";

type Feedback = {
  kind: "success" | "error";
  text: string;
};

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

/**
 * AI 控制中心（区域 A / B / C）。
 *
 * - A：DeepSeek / OpenAI 接入，API Key 只在输入时出现在浏览器，保存后只显示掩码；
 * - B：销冠 / 技术客服 / 财务 / 审计 / 创业导师 5 张 Agent 卡片，逐卡保存；
 * - C：调用 POST /api/ai/chat（testMode=true）做真实模型连通性测试，不写日志。
 */
export function ControlCenter({
  initialSettings,
  initialAgents,
  onSettingsSaved,
  onAgentSaved,
}: {
  initialSettings: AiSettingsSnapshot;
  initialAgents: AiAgentConfigSnapshot[];
  onSettingsSaved?: (settings: AiSettingsSnapshot) => void;
  onAgentSaved?: (agent: AiAgentConfigSnapshot) => void;
}) {
  const { t, language } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  const [settings, setSettings] = useState(initialSettings);
  const [provider, setProvider] = useState<AiProviderValue>(
    initialSettings.provider,
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl);
  const [globalModel, setGlobalModel] = useState(initialSettings.model);
  const [isActive, setIsActive] = useState(initialSettings.isActive);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsFeedback, setSettingsFeedback] =
    useState<Feedback | null>(null);

  const [agents, setAgents] = useState(initialAgents);
  const [savingAgent, setSavingAgent] = useState<string | null>(null);
  const [agentFeedback, setAgentFeedback] = useState<
    (Feedback & { agentName: string }) | null
  >(null);

  const [testAgent, setTestAgent] = useState<AiConsoleAgentName>("sales");
  const [testMessages, setTestMessages] = useState<TestChatMessage[]>([]);
  const [testInput, setTestInput] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const testListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    testListRef.current?.scrollTo({
      top: testListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [testMessages, testSending]);

  function changeProvider(next: AiProviderValue) {
    const previousDefault = DEFAULT_AI_BASE_URLS[provider];
    setProvider(next);

    if (!baseUrl.trim() || baseUrl === previousDefault) {
      setBaseUrl(DEFAULT_AI_BASE_URLS[next]);
    }

    const hasModelForProvider = AI_MODEL_OPTIONS.some(
      (option) => option.provider === next && option.value === globalModel,
    );

    if (!hasModelForProvider) {
      setGlobalModel(next === "openai" ? "gpt-4o-mini" : "deepseek-chat");
    }
  }

  async function saveSettings() {
    if (savingSettings) {
      return;
    }

    setSavingSettings(true);
    setSettingsFeedback(null);

    try {
      const response = await fetch("/api/admin/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey,
          baseUrl,
          model: globalModel,
          isActive,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as AiSettingsResponse;

      if (!response.ok || !data.settings) {
        throw new Error(
          data.error ?? t("aiConsole.control.settings.saveError"),
        );
      }

      setSettings(data.settings);
      onSettingsSaved?.(data.settings);
      setProvider(data.settings.provider);
      setBaseUrl(data.settings.baseUrl);
      setGlobalModel(data.settings.model);
      setIsActive(data.settings.isActive);
      setApiKey("");
      setSettingsFeedback({
        kind: "success",
        text: t("aiConsole.control.settings.saved"),
      });
    } catch (error) {
      setSettingsFeedback({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : t("aiConsole.control.settings.saveError"),
      });
    } finally {
      setSavingSettings(false);
    }
  }

  function updateAgent(
    agentName: string,
    patch: Partial<AiAgentConfigSnapshot>,
  ) {
    setAgents((previous) =>
      previous.map((agent) =>
        agent.agentName === agentName ? { ...agent, ...patch } : agent,
      ),
    );
  }

  async function saveAgent(agent: AiAgentConfigSnapshot) {
    if (savingAgent) {
      return;
    }

    setSavingAgent(agent.agentName);
    setAgentFeedback(null);

    try {
      const response = await fetch("/api/admin/ai-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: agent.agentName,
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          isEnabled: agent.isEnabled,
          tokenLimit: agent.tokenLimit,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as AiAgentsResponse;

      if (!response.ok || !data.agent) {
        throw new Error(data.error ?? t("aiConsole.control.agents.saveError"));
      }

      setAgents((previous) =>
        previous.map((item) =>
          item.agentName === data.agent?.agentName ? data.agent : item,
        ),
      );
      onAgentSaved?.(data.agent);
      setAgentFeedback({
        agentName: agent.agentName,
        kind: "success",
        text: t("aiConsole.control.agents.saved"),
      });
    } catch (error) {
      setAgentFeedback({
        agentName: agent.agentName,
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : t("aiConsole.control.agents.saveError"),
      });
    } finally {
      setSavingAgent(null);
    }
  }

  async function sendTestMessage() {
    const text = testInput.trim();

    if (!text || testSending) {
      return;
    }

    if (!settings.isActive || !settings.hasApiKey) {
      setTestError(t("aiConsole.control.test.keyMissing"));
      return;
    }

    const optimistic: TestChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const history = testMessages
      .filter((message) => message.content.trim())
      .slice(-20)
      .map((message) => ({ role: message.role, content: message.content }));

    setTestMessages((previous) => [...previous, optimistic]);
    setTestInput("");
    setTestSending(true);
    setTestError(null);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          agentName: testAgent,
          testMode: true,
          history,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as TestChatResponse;

      if (!response.ok || !data.reply) {
        throw new Error(data.error ?? t("aiConsole.control.test.error"));
      }

      setTestMessages((previous) => [
        ...previous,
        {
          id: data.reply?.id ?? `assistant-${Date.now()}`,
          role: "assistant",
          content: data.reply?.content ?? "",
          createdAt: data.reply?.createdAt ?? new Date().toISOString(),
          model: data.model,
        },
      ]);
    } catch (error) {
      setTestError(
        error instanceof Error
          ? error.message
          : t("aiConsole.control.test.error"),
      );
    } finally {
      setTestSending(false);
    }
  }

  const runtimeConfigured = settings.isActive && settings.hasApiKey;
  const testAgentConfig = agents.find(
    (agent) => agent.agentName === testAgent,
  );
  // 供应商与 Agent 模型不匹配时，后端会回退全局模型；侧栏显示同一口径。
  const testModel =
    testAgentConfig &&
    !(
      provider === "openai" &&
      testAgentConfig.model.startsWith("deepseek")
    ) &&
    !(provider === "deepseek" && testAgentConfig.model.startsWith("gpt"))
      ? testAgentConfig.model
      : settings.model;


  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-[#d4af37]/15 bg-[#d4af37]/[0.04] px-4 py-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-[9px] uppercase tracking-[0.22em] text-[#d4af37]/70">
            {t("aiConsole.control.badge")}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {runtimeConfigured
              ? t("aiConsole.control.runtime.configured", {
                  model: modelLabel(settings.model),
                })
              : t("aiConsole.control.runtime.noKey")}
          </p>
        </div>
        <span
          className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] ${
            runtimeConfigured
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
              : "border-amber-400/20 bg-amber-400/10 text-amber-200"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {runtimeConfigured
            ? t("aiConsole.control.runtime.online")
            : t("aiConsole.control.runtime.offline")}
        </span>
      </div>

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5">
        <SectionHeader
          letter="A"
          title={t("aiConsole.control.settings.title")}
          subtitle={t("aiConsole.control.settings.subtitle")}
        />

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className={labelClass}>
              {t("aiConsole.control.settings.provider")}
            </span>
            <select
              value={provider}
              onChange={(event) =>
                changeProvider(event.target.value as AiProviderValue)
              }
              className={`${inputClass} mt-1.5`}
            >
              {AI_PROVIDERS.map((value) => (
                <option key={value} value={value} className="bg-[#0a0a0a]">
                  {value === "deepseek" ? "DeepSeek" : "OpenAI"}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={labelClass}>
              {t("aiConsole.control.settings.model")}
            </span>
            <select
              value={globalModel}
              onChange={(event) => setGlobalModel(event.target.value)}
              className={`${inputClass} mt-1.5`}
            >
              {AI_MODEL_OPTIONS.filter(
                (option) => option.provider === provider,
              ).map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  className="bg-[#0a0a0a]"
                >
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[9px] text-neutral-600">
              {t("aiConsole.control.settings.modelHint")}
            </span>
          </label>


          <label className="block">
            <span className={labelClass}>
              {t("aiConsole.control.settings.apiKey")}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={
                settings.apiKey ||
                t("aiConsole.control.settings.apiKeyPlaceholder")
              }
              className={`${inputClass} mt-1.5 font-mono`}
            />
            <span className="mt-1 block text-[9px] leading-4 text-neutral-600">
              {settings.apiKey
                ? t("aiConsole.control.settings.apiKeyHint", {
                    mask: settings.apiKey,
                  })
                : t("aiConsole.control.settings.apiKeyEmptyHint")}
              {settings.source === "environment"
                ? ` ${t("aiConsole.control.settings.apiKeyEnvHint")}`
                : ""}
            </span>
          </label>

          <label className="block">
            <span className={labelClass}>
              {t("aiConsole.control.settings.baseUrl")}
            </span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              spellCheck={false}
              placeholder={DEFAULT_AI_BASE_URLS[provider]}
              className={`${inputClass} mt-1.5 font-mono`}
            />
            <span className="mt-1 block text-[9px] text-neutral-600">
              {t("aiConsole.control.settings.baseUrlHint")}
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-col justify-between gap-3 border-t border-white/[0.05] pt-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Switch
              checked={isActive}
              onChange={setIsActive}
              label={t("aiConsole.control.settings.active")}
            />
            <div>
              <p className="text-[11px] text-neutral-300">
                {t("aiConsole.control.settings.active")}
              </p>
              <p className="text-[9px] text-neutral-600">
                {t("aiConsole.control.settings.activeHint")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={savingSettings}
            className="h-10 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-[11px] font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingSettings
              ? t("aiConsole.control.settings.saving")
              : t("aiConsole.control.settings.save")}
          </button>
        </div>

        {settingsFeedback ? (
          <FeedbackBanner feedback={settingsFeedback} />
        ) : null}
      </section>


      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5">
        <SectionHeader
          letter="B"
          title={t("aiConsole.control.agents.title")}
          subtitle={t("aiConsole.control.agents.subtitle")}
        />

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {agents.map((agent) => {
            const copy = AGENT_COPY_KEYS[agent.agentName as AiConsoleAgentName];
            const feedback =
              agentFeedback?.agentName === agent.agentName
                ? agentFeedback
                : null;

            return (
              <article
                key={agent.agentName}
                className={`rounded-2xl border p-4 transition-colors ${
                  agent.isEnabled
                    ? "border-[#d4af37]/15 bg-gradient-to-br from-[#d4af37]/[0.06] via-transparent to-transparent"
                    : "border-white/[0.06] bg-black/20 opacity-75"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/10 font-mono text-[10px] font-bold uppercase text-[#f0d27c]">
                      {agent.agentName.slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-neutral-100">
                        {copy ? t(copy.name) : agent.agentName}
                      </h3>
                      <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                        {copy ? t(copy.description) : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[9px] text-neutral-600">
                      {agent.isEnabled
                        ? t("aiConsole.control.agent.enabled")
                        : t("aiConsole.control.agent.disabled")}
                    </span>
                    <Switch
                      checked={agent.isEnabled}
                      onChange={(value) =>
                        updateAgent(agent.agentName, { isEnabled: value })
                      }
                      label={t("aiConsole.control.agent.enabled")}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelClass}>
                      {t("aiConsole.control.agent.model")}
                    </span>
                    <select
                      value={agent.model}
                      onChange={(event) =>
                        updateAgent(agent.agentName, {
                          model: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1.5`}
                    >
                      {AGENT_MODEL_OPTIONS.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          className="bg-[#0a0a0a]"
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className={labelClass}>
                      {t("aiConsole.control.agent.tokenLimit")}
                    </span>
                    <input
                      type="number"
                      min={100}
                      max={8000}
                      value={agent.tokenLimit}
                      onChange={(event) =>
                        updateAgent(agent.agentName, {
                          tokenLimit: Number(event.target.value) || 100,
                        })
                      }
                      className={`${inputClass} mt-1.5 font-mono`}
                    />
                  </label>
                </div>


                <label className="mt-3 block">
                  <span className={labelClass}>
                    {t("aiConsole.control.agent.prompt")}
                  </span>
                  <textarea
                    value={agent.systemPrompt}
                    onChange={(event) =>
                      updateAgent(agent.agentName, {
                        systemPrompt: event.target.value,
                      })
                    }
                    rows={6}
                    maxLength={20000}
                    className={`${textareaClass} mt-1.5 min-h-32 font-mono text-[10px]`}
                  />
                  <span className="mt-1 block text-[9px] text-neutral-600">
                    {t("aiConsole.control.agent.promptHint")}
                  </span>
                </label>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[9px] text-neutral-600">
                    {t("aiConsole.control.agent.savedAt", {
                      time: formatTime(agent.updatedAt, locale),
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => void saveAgent(agent)}
                    disabled={savingAgent !== null}
                    className="h-9 rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/10 px-4 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:bg-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingAgent === agent.agentName
                      ? t("aiConsole.control.agents.saving")
                      : t("aiConsole.control.agents.save")}
                  </button>
                </div>

                {feedback ? <FeedbackBanner feedback={feedback} /> : null}
              </article>
            );
          })}
        </div>
      </section>


      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5">
        <SectionHeader
          letter="C"
          title={t("aiConsole.control.test.title")}
          subtitle={t("aiConsole.control.test.subtitle")}
        />

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-h-[440px] flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-black/20">
            <div className="flex flex-col justify-between gap-2 border-b border-white/[0.06] px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("aiConsole.control.test.agent")}
                </span>
                <select
                  value={testAgent}
                  onChange={(event) => {
                    setTestAgent(event.target.value as AiConsoleAgentName);
                    setTestError(null);
                  }}
                  className="h-8 rounded-lg border border-white/[0.08] bg-black/30 px-2 text-[10px] text-neutral-300 outline-none focus:border-[#d4af37]/35"
                >
                  {Object.entries(AGENT_COPY_KEYS).map(([value, copy]) => (
                    <option
                      key={value}
                      value={value}
                      className="bg-[#0a0a0a]"
                    >
                      {t(copy.name)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTestMessages([]);
                  setTestError(null);
                  setTestInput("");
                }}
                className="h-8 w-fit rounded-lg border border-white/[0.08] px-2.5 text-[10px] text-neutral-500 transition-colors hover:border-[#d4af37]/20 hover:text-neutral-300"
              >
                {t("aiConsole.control.test.clear")}
              </button>
            </div>

            <div
              ref={testListRef}
              className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
              style={{ maxHeight: "46vh" }}
            >
              {testMessages.length === 0 ? (
                <div className="flex h-full min-h-56 items-center justify-center rounded-xl border border-dashed border-white/[0.06] bg-white/[0.015] px-5 py-8 text-center">
                  <div>
                    <p className="text-sm font-semibold text-neutral-200">
                      {t("aiConsole.control.test.emptyTitle")}
                    </p>
                    <p className="mx-auto mt-2 max-w-md text-[10px] leading-5 text-neutral-500">
                      {t("aiConsole.control.test.emptyHint")}
                    </p>
                  </div>
                </div>
              ) : (
                testMessages.map((message) => (
                  <TestMessageBubble
                    key={message.id}
                    message={message}
                    locale={locale}
                  />
                ))
              )}
              {testSending ? (
                <p className="inline-flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[10px] text-neutral-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d4af37]" />
                  {t("aiConsole.control.test.sending")}
                </p>
              ) : null}
            </div>

            {testError ? (
              <div className="mx-4 mb-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[10px] leading-5 text-red-200">
                {testError}
              </div>
            ) : null}


            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendTestMessage();
              }}
              className="border-t border-white/[0.06] p-3 sm:p-4"
            >
              <textarea
                value={testInput}
                rows={3}
                maxLength={4000}
                onChange={(event) => setTestInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendTestMessage();
                  }
                }}
                placeholder={t("aiConsole.control.test.placeholder")}
                className={textareaClass}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[9px] leading-4 text-neutral-600">
                  {t("aiConsole.control.test.hint")}
                </span>
                <button
                  type="submit"
                  disabled={!testInput.trim() || testSending}
                  className="h-9 shrink-0 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-[10px] font-bold text-[#171105] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testSending
                    ? t("aiConsole.control.test.sending")
                    : t("aiConsole.control.test.send")}
                </button>
              </div>
            </form>
          </div>

          <aside className="space-y-3 rounded-2xl border border-[#d4af37]/10 bg-[#d4af37]/[0.03] p-4">
            <p className="text-[9px] uppercase tracking-[0.18em] text-[#d4af37]/70">
              {t("aiConsole.control.test.agentPanel")}
            </p>
            <h3 className="text-sm font-semibold text-neutral-100">
              {t(AGENT_COPY_KEYS[testAgent].name)}
            </h3>
            <p className="text-[10px] leading-5 text-neutral-500">
              {t(AGENT_COPY_KEYS[testAgent].description)}
            </p>
            <div className="space-y-2 border-t border-white/[0.06] pt-3 text-[10px]">
              <InfoRow
                label={t("aiConsole.control.test.providerLabel")}
                value={provider === "deepseek" ? "DeepSeek" : "OpenAI"}
              />
              <InfoRow
                label={t("aiConsole.control.test.modelLabel")}
                value={modelLabel(testModel)}
              />
              <InfoRow
                label={t("aiConsole.control.test.keyLabel")}
                value={settings.apiKey || t("aiConsole.control.test.noKey")}
              />
            </div>
            <p className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[9px] leading-4 text-neutral-600">
              {t("aiConsole.control.test.privacy")}
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}


function SectionHeader({
  letter,
  title,
  subtitle,
}: {
  letter: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/10 font-mono text-[11px] font-bold text-[#f0d27c]">
        {letter}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
        <p className="mt-1 max-w-2xl text-[10px] leading-5 text-neutral-500">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        checked
          ? "border-[#d4af37]/40 bg-[#d4af37]/30"
          : "border-white/10 bg-white/[0.05]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          checked
            ? "left-[18px] bg-[#f0d27c]"
            : "left-0.5 bg-neutral-500"
        }`}
      />
    </button>
  );
}

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  return (
    <p
      className={`mt-3 rounded-xl border px-3 py-2 text-[10px] leading-5 ${
        feedback.kind === "success"
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
          : "border-red-400/20 bg-red-400/10 text-red-200"
      }`}
    >
      {feedback.text}
    </p>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-neutral-600">{label}</span>
      <span className="max-w-[170px] break-words text-right font-mono text-[9px] text-neutral-300">
        {value}
      </span>
    </div>
  );
}

function TestMessageBubble({
  message,
  locale,
}: {
  message: TestChatMessage;
  locale: "zh-CN" | "en-US";
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
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
        {!isUser && message.model ? (
          <span className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] text-neutral-500">
            {modelLabel(message.model)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

