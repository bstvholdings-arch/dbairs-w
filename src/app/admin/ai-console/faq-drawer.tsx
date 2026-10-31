"use client";

import { useEffect, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { AiConsoleAgentName } from "@/lib/ai/constants";
import {
  MAX_FAQ_ANSWER_LENGTH,
  MAX_FAQ_QUESTION_LENGTH,
  type AgentFaqSnapshot,
  type AgentFaqTenantOption,
} from "@/lib/ai/faq-types";

import type { AiFaqResponse, AiFaqsResponse } from "./types";

const inputClass =
  "h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-[#d4af37]/35";
const textareaClass =
  "w-full resize-y rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2.5 text-[11px] leading-5 text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-[#d4af37]/35";
const labelClass =
  "text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500";

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
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * 单个 AI 助手的 FAQ 知识库管理抽屉。
 *
 * 数据按 agentType 隔离；tenantId 为空表示平台通用，选择商户时只影响该商户。
 * 保存后立即刷新列表，下一次 /api/ai/chat 请求就会参与 RAG 检索。
 */
export function FaqDrawer({
  open,
  agentName,
  agentLabel,
  agentEmoji,
  avatarClass,
  tenants,
  onClose,
}: {
  open: boolean;
  agentName: AiConsoleAgentName;
  agentLabel: string;
  agentEmoji: string;
  avatarClass: string;
  tenants: AgentFaqTenantOption[];
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  const [faqs, setFaqs] = useState<AgentFaqSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [scopeTenantId, setScopeTenantId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/ai-faqs?agentType=${encodeURIComponent(agentName)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await response
          .json()
          .catch(() => ({}))) as AiFaqsResponse;

        if (!active) {
          return;
        }

        if (!response.ok) {
          setLoadError(
            data.error ?? t("aiConsole.assistants.faq.loadError"),
          );
          return;
        }

        setFaqs(data.faqs ?? []);
      } catch (error) {
        if (
          !active ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : t("aiConsole.assistants.faq.loadError"),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [agentName, open, t]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  function resetForm() {
    setEditingId(null);
    setQuestion("");
    setAnswer("");
    setScopeTenantId("");
  }

  function startEdit(faq: AgentFaqSnapshot) {
    setEditingId(faq.id);
    setQuestion(faq.question);
    setAnswer(faq.answer);
    setScopeTenantId(faq.tenantId ?? "");
    setFeedback(null);
  }

  async function saveFaq(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuestion = question.trim();
    const trimmedAnswer = answer.trim();

    if (!trimmedQuestion || !trimmedAnswer) {
      setFeedback({
        kind: "error",
        text: t("aiConsole.assistants.faq.form.required"),
      });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(
        editingId
          ? `/api/admin/ai-faqs/${encodeURIComponent(editingId)}`
          : "/api/admin/ai-faqs",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(editingId ? {} : { agentType: agentName }),
            question: trimmedQuestion,
            answer: trimmedAnswer,
            tenantId: scopeTenantId || null,
          }),
        },
      );
      const data = (await response
        .json()
        .catch(() => ({}))) as AiFaqResponse;
      const savedFaq = data.faq;

      if (!response.ok || !savedFaq) {
        throw new Error(
          data.error ?? t("aiConsole.assistants.faq.saveError"),
        );
      }

      setFaqs((previous) => [
        savedFaq,
        ...previous.filter((faq) => faq.id !== savedFaq.id),
      ]);
      resetForm();
      setFeedback({
        kind: "success",
        text: t("aiConsole.assistants.faq.saved"),
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : t("aiConsole.assistants.faq.saveError"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeFaq(faq: AgentFaqSnapshot) {
    if (!window.confirm(t("aiConsole.assistants.faq.deleteConfirm"))) {
      return;
    }

    setDeletingId(faq.id);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/admin/ai-faqs/${encodeURIComponent(faq.id)}`,
        { method: "DELETE" },
      );
      const data = (await response
        .json()
        .catch(() => ({}))) as AiFaqResponse;

      if (!response.ok) {
        throw new Error(
          data.error ?? t("aiConsole.assistants.faq.deleteError"),
        );
      }

      setFaqs((previous) => previous.filter((item) => item.id !== faq.id));

      if (editingId === faq.id) {
        resetForm();
      }

      setFeedback({
        kind: "success",
        text: t("aiConsole.assistants.faq.deleted"),
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : t("aiConsole.assistants.faq.deleteError"),
      });
    } finally {
      setDeletingId(null);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t("aiConsole.assistants.faq.close")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-faq-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-[#d4af37]/20 bg-[#070707] shadow-[-30px_0_90px_rgba(0,0,0,0.65)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg ${avatarClass}`}
            >
              {agentEmoji}
            </span>
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/65">
                {t("aiConsole.assistants.faq.eyebrow")}
              </p>
              <h2
                id="agent-faq-title"
                className="mt-1 truncate text-base font-semibold text-white"
              >
                {t("aiConsole.assistants.faq.title", { name: agentLabel })}
              </h2>
              <p className="mt-1 text-[10px] leading-5 text-neutral-500">
                {t("aiConsole.assistants.faq.subtitle")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("aiConsole.assistants.faq.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-sm text-neutral-400 transition-colors hover:border-white/20 hover:text-white"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <form
            onSubmit={(event) => void saveFaq(event)}
            className="rounded-2xl border border-[#d4af37]/15 bg-[#d4af37]/[0.035] p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-neutral-200">
                {editingId
                  ? t("aiConsole.assistants.faq.form.editTitle")
                  : t("aiConsole.assistants.faq.form.createTitle")}
              </h3>
              <span className="rounded-full border border-white/[0.07] bg-black/30 px-2 py-0.5 font-mono text-[8px] text-neutral-500">
                {t("aiConsole.assistants.faq.count", {
                  count: faqs.length,
                })}
              </span>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className={labelClass}>
                  {t("aiConsole.assistants.faq.form.question")}
                </span>
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={MAX_FAQ_QUESTION_LENGTH}
                  placeholder={t(
                    "aiConsole.assistants.faq.form.questionPlaceholder",
                  )}
                  className={`${inputClass} mt-1.5`}
                />
              </label>

              <label className="block">
                <span className={labelClass}>
                  {t("aiConsole.assistants.faq.form.answer")}
                </span>
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  maxLength={MAX_FAQ_ANSWER_LENGTH}
                  rows={4}
                  placeholder={t(
                    "aiConsole.assistants.faq.form.answerPlaceholder",
                  )}
                  className={`${textareaClass} mt-1.5`}
                />
              </label>

              <label className="block">
                <span className={labelClass}>
                  {t("aiConsole.assistants.faq.form.scope")}
                </span>
                <select
                  value={scopeTenantId}
                  onChange={(event) => setScopeTenantId(event.target.value)}
                  className={`${inputClass} mt-1.5`}
                >
                  <option value="">
                    {t("aiConsole.assistants.faq.form.platform")}
                  </option>
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} · {tenant.domain}
                    </option>
                  ))}
                </select>
                <span className="mt-1.5 block text-[9px] leading-4 text-neutral-600">
                  {t("aiConsole.assistants.faq.trainingHint")}
                </span>
              </label>
            </div>

            {feedback ? (
              <p
                role="status"
                className={`mt-3 rounded-lg border px-3 py-2 text-[10px] leading-5 ${
                  feedback.kind === "error"
                    ? "border-red-400/20 bg-red-400/[0.07] text-red-200"
                    : "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200"
                }`}
              >
                {feedback.text}
              </p>
            ) : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              {editingId ? (
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setFeedback(null);
                  }}
                  className="h-9 rounded-xl border border-white/[0.08] px-3 text-[10px] text-neutral-400 transition-colors hover:border-white/20 hover:text-white"
                >
                  {t("aiConsole.assistants.faq.form.cancel")}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={saving || !question.trim() || !answer.trim()}
                className="h-9 rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/15 px-4 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:bg-[#d4af37]/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving
                  ? t("aiConsole.assistants.faq.form.saving")
                  : t("aiConsole.assistants.faq.form.save")}
              </button>
            </div>

            <p className="mt-3 text-[9px] leading-4 text-neutral-600">
              {t("aiConsole.assistants.faq.trainingHint")}
            </p>
          </form>

          <div className="mt-6 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-neutral-200">
              {t("aiConsole.assistants.faq.listTitle")}
            </h3>
            <span className="rounded-full border border-white/[0.07] bg-black/30 px-2 py-0.5 font-mono text-[8px] text-neutral-500">
              {faqs.length}
            </span>
          </div>

          {loading ? (
            <p className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center text-[10px] text-neutral-500">
              {t("aiConsole.assistants.faq.loading")}
            </p>
          ) : loadError ? (
            <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[10px] leading-5 text-red-200">
              {loadError}
            </p>
          ) : faqs.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-[10px] leading-5 text-neutral-500">
              {t("aiConsole.assistants.faq.empty")}
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {faqs.map((faq) => (
                <article
                  key={faq.id}
                  className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded-full border border-[#d4af37]/20 bg-[#d4af37]/[0.07] px-2 py-0.5 text-[8px] text-[#f0d27c]">
                      {faq.tenantName
                        ? t("aiConsole.assistants.faq.tenantLabel", {
                            name: faq.tenantName,
                          })
                        : t("aiConsole.assistants.faq.form.platform")}
                    </span>
                    <time className="font-mono text-[8px] text-neutral-600">
                      {t("aiConsole.assistants.faq.updatedAt", {
                        time: formatTime(faq.updatedAt, locale),
                      })}
                    </time>
                  </div>

                  <p className="mt-3 break-words text-[11px] font-semibold leading-5 text-neutral-200">
                    <span className="mr-1.5 font-mono text-[#d4af37]">Q</span>
                    {faq.question}
                  </p>
                  <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-neutral-400">
                    <span className="mr-1.5 font-mono text-emerald-400">A</span>
                    {faq.answer}
                  </p>

                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-white/[0.05] pt-3">
                    <button
                      type="button"
                      onClick={() => startEdit(faq)}
                      className="h-7 rounded-lg border border-white/[0.08] px-2.5 text-[9px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
                    >
                      {t("aiConsole.assistants.faq.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeFaq(faq)}
                      disabled={deletingId === faq.id}
                      className="h-7 rounded-lg border border-red-400/20 px-2.5 text-[9px] text-red-300 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingId === faq.id
                        ? t("aiConsole.assistants.faq.deleting")
                        : t("aiConsole.assistants.faq.delete")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
