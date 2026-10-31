"use client";

import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { ReasonCount } from "@/lib/ai/constants";
import type { AiAgentConfigSnapshot } from "@/lib/ai/records";

import type { PromptResponse, TacticsResponse } from "./types";

/**
 * 战败复盘 → AI 对策。
 *
 * 生成（POST /api/ai/tactics）只返回话术，不落库；
 * 用户确认后点「保存到 System Prompt」（POST /api/ai/prompt），
 * 服务端把话术追加到 AgentConfig.tactics，下一次销售对话立即带上。
 */
export function TacticsPanel({
  config,
  onConfigChange,
  reasonCounts,
}: {
  config: AiAgentConfigSnapshot;
  onConfigChange: (config: AiAgentConfigSnapshot) => void;
  reasonCounts: ReasonCount[];
}) {
  const { t } = useLanguage();
  const [tactic, setTactic] = useState("");
  const [fallback, setFallback] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const hasReasons = reasonCounts.length > 0;

  async function generateTactics() {
    if (generating) {
      return;
    }

    setGenerating(true);
    setError(null);
    setWarning(null);
    setSavedMessage(null);

    try {
      const response = await fetch("/api/ai/tactics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json().catch(() => ({}))) as TacticsResponse;

      if (!response.ok || !data.tactic) {
        throw new Error(data.error ?? t("aiConsole.loadError"));
      }

      setTactic(data.tactic);
      setFallback(Boolean(data.fallback));
      setWarning(data.warning ?? null);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : t("aiConsole.loadError"),
      );
    } finally {
      setGenerating(false);
    }
  }

  async function saveTactic() {
    if (saving || !tactic.trim()) {
      return;
    }

    setSaving(true);
    setError(null);
    setSavedMessage(null);

    try {
      const response = await fetch("/api/ai/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: "sales", tactic }),
      });
      const data = (await response.json().catch(() => ({}))) as PromptResponse;

      if (!response.ok || !data.config) {
        throw new Error(data.error ?? t("aiConsole.saveError"));
      }

      onConfigChange(data.config);
      setSavedMessage(
        data.alreadyPresent
          ? t("aiConsole.tactics.alreadySaved")
          : t("aiConsole.tactics.saved"),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("aiConsole.saveError"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#d4af37]/[0.07] via-transparent to-transparent p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">
              {t("aiConsole.tactics.title")}
            </h3>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-neutral-500">
              {t("aiConsole.tactics.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void generateTactics()}
            disabled={generating || !hasReasons}
            className="h-9 shrink-0 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-[11px] font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating
              ? t("aiConsole.tactics.generating")
              : tactic
                ? t("aiConsole.tactics.regenerate")
                : t("aiConsole.tactics.generate")}
          </button>
        </div>

        {!hasReasons ? (
          <p className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[10px] leading-5 text-neutral-500">
            {t("aiConsole.tactics.needData")}
          </p>
        ) : null}

        {warning ? (
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] leading-5 text-amber-200">
            {warning}
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[10px] leading-5 text-red-200">
            {error}
          </p>
        ) : null}

        {tactic ? (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                {t("aiConsole.tactics.resultTitle")}
              </p>
              {fallback ? (
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[9px] text-neutral-500">
                  {t("aiConsole.tactics.fallback")}
                </span>
              ) : null}
            </div>
            <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/25 px-3 py-3 font-sans text-[11px] leading-5 text-neutral-200">
              {tactic}
            </pre>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void saveTactic()}
                disabled={saving}
                className="h-9 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? t("aiConsole.tactics.saving")
                  : t("aiConsole.tactics.save")}
              </button>
              {savedMessage ? (
                <span className="text-[10px] text-emerald-300">
                  {savedMessage}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[9px] leading-4 text-neutral-600">
              {t("aiConsole.tactics.savedHint")}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-[10px] leading-5 text-neutral-600">
            {t("aiConsole.tactics.empty")}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-neutral-100">
          {t("aiConsole.tactics.current")}
        </h3>
        {config.tactics.trim() ? (
          <pre className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3 font-sans text-[10px] leading-5 text-neutral-400">
            {config.tactics}
          </pre>
        ) : (
          <p className="mt-3 text-[10px] text-neutral-600">
            {t("aiConsole.tactics.currentEmpty")}
          </p>
        )}

        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                {t("aiConsole.tactics.prompt")}
              </p>
              <p className="mt-1 text-[9px] leading-4 text-neutral-600">
                {t("aiConsole.tactics.promptHint")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPrompt((previous) => !previous)}
              className="h-8 shrink-0 rounded-lg border border-white/[0.08] px-2.5 text-[10px] text-neutral-400 transition-colors hover:border-[#d4af37]/25 hover:text-neutral-200"
            >
              {showPrompt
                ? t("aiConsole.tactics.hidePrompt")
                : t("aiConsole.tactics.showPrompt")}
            </button>
          </div>
          {showPrompt ? (
            <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3 font-mono text-[9px] leading-4 text-neutral-500">
              {config.effectivePrompt}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
