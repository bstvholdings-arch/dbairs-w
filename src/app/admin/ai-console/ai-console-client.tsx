"use client";

import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { AiProviderValue } from "@/lib/ai/constants";
import type { AgentFaqTenantOption } from "@/lib/ai/faq-types";
import type {
  AgentChatLogMap,
  AiAgentConfigSnapshot,
  SerializedLeadRecord,
  WarRoomSnapshot,
} from "@/lib/ai/records";
import type { AiSettingsSnapshot } from "@/lib/ai/settings";

import { AssistantChat } from "./assistant-chat";
import { ChatTab } from "./chat-tab";
import { ControlCenter } from "./control-center";
import { WarRoomTab } from "./war-room-tab";

type Tab = "assistants" | "control" | "chat" | "warRoom";

type ChatTarget = {
  lead: SerializedLeadRecord | null;
  /** 每次「去对话」都换一次 key，强制 ChatTab 以该线索重新初始化。 */
  nonce: number;
};

/**
 * AI 中控台外壳：页头 + 4 个 Tab。
 *
 * 所有 Tab 同时挂载、用 hidden 切换，避免来回切换时丢失正在编辑的对话；
 * 默认进入「AI 助手」，5 个助手各自维护独立上下文。从看板点「去对话」时
 * 通过 key 重建 ChatTab，把线索带进销售线索对话。
 */
export function AiConsoleClient({
  initialSnapshot,
  initialConfig,
  initialLogsByAgent,
  initialSettings,
  initialAgents,
  initialTenants,
  cloudEnabled,
  modelLabel,
}: {
  initialSnapshot: WarRoomSnapshot;
  initialConfig: AiAgentConfigSnapshot;
  initialLogsByAgent: AgentChatLogMap;
  initialSettings: AiSettingsSnapshot;
  initialAgents: AiAgentConfigSnapshot[];
  initialTenants: AgentFaqTenantOption[];
  cloudEnabled: boolean;
  modelLabel: string | null;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("assistants");
  const [runtimeCloud, setRuntimeCloud] = useState(cloudEnabled);
  const [runtimeModel, setRuntimeModel] = useState(modelLabel);
  const [runtimeProvider, setRuntimeProvider] = useState<AiProviderValue>(
    initialSettings.provider,
  );
  const [agents, setAgents] = useState(initialAgents);
  const [chatTarget, setChatTarget] = useState<ChatTarget>({
    lead: null,
    nonce: 0,
  });

  function openChat(lead: SerializedLeadRecord) {
    setChatTarget({ lead, nonce: Date.now() });
    setTab("chat");
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("aiConsole.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("aiConsole.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            {t("aiConsole.subtitle")}
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 lg:items-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/25 bg-[#d4af37]/10 px-2.5 py-1 text-[10px] text-[#f0d27c]">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {t("aiConsole.badge")}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] ${
              runtimeCloud
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                : "border-white/10 bg-white/[0.03] text-neutral-400"
            }`}
            title={t("aiConsole.runtime.hint")}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {runtimeCloud
              ? t("aiConsole.runtime.cloud")
              : t("aiConsole.runtime.local")}
            {runtimeModel ? ` · ${runtimeModel}` : ""}
          </span>
        </div>
      </header>

      <div
        role="tablist"
        aria-label={t("aiConsole.title")}
        className="flex flex-wrap gap-2 border-b border-white/[0.06] pb-3"
      >
        <TabButton
          active={tab === "assistants"}
          label={t("aiConsole.tab.assistants")}
          onClick={() => setTab("assistants")}
        />
        <TabButton
          active={tab === "control"}
          label={t("aiConsole.tab.control")}
          onClick={() => setTab("control")}
        />
        <TabButton
          active={tab === "warRoom"}
          label={t("aiConsole.tab.warRoom")}
          onClick={() => setTab("warRoom")}
        />
        <TabButton
          active={tab === "chat"}
          label={t("aiConsole.tab.chat")}
          onClick={() => setTab("chat")}
        />
      </div>

      <div className={tab === "assistants" ? "" : "hidden"}>
        <AssistantChat
          agents={agents}
          initialLogsByAgent={initialLogsByAgent}
          tenants={initialTenants}
          cloudEnabled={runtimeCloud}
          runtimeModel={runtimeModel}
          runtimeProvider={runtimeProvider}
        />
      </div>

      <div className={tab === "control" ? "" : "hidden"}>
        <ControlCenter
          initialSettings={initialSettings}
          initialAgents={agents}
          onSettingsSaved={(settings) => {
            setRuntimeCloud(settings.isActive && settings.hasApiKey);
            setRuntimeModel(settings.model);
            setRuntimeProvider(settings.provider);
          }}
          onAgentSaved={(saved) => {
            setAgents((previous) =>
              previous.map((agent) =>
                agent.agentName === saved.agentName ? saved : agent,
              ),
            );
          }}
        />
      </div>

      <div className={tab === "warRoom" ? "" : "hidden"}>
        <WarRoomTab
          initialSnapshot={initialSnapshot}
          initialConfig={initialConfig}
          onOpenChat={openChat}
        />
      </div>

      <div className={tab === "chat" ? "" : "hidden"}>
        <ChatTab
          key={`chat-${chatTarget.nonce}`}
          initialLogs={initialLogsByAgent.sales}
          initialLead={chatTarget.lead}
          onOpenWarRoom={() => setTab("warRoom")}
        />
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-9 rounded-lg border px-4 text-xs transition-colors ${
        active
          ? "border-[#d4af37]/25 bg-[#d4af37]/10 text-[#f0d27c]"
          : "border-transparent text-neutral-500 hover:border-[#d4af37]/10 hover:bg-white/[0.03] hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );
}
