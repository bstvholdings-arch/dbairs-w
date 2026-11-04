"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatCurrency } from "@/lib/currency";
import type { Language, TranslationKey } from "@/lib/i18n-types";
import {
  REBATE_CATEGORIES,
  type RebateCategoryId,
} from "@/lib/rebate-categories";
import type { RebateConfig } from "@/lib/rebate-config";
import type { TenantRebateOverview } from "@/lib/rebate-settlement";

/**
 * 与服务端 src/lib/rebate-config.ts 的 REBATE_MAX_RATE_PERCENT 保持一致。
 * 客户端只做即时提示，真正的闸门是服务端 parseRebateConfigInput（非法即 400）。
 */
const MAX_RATE_PERCENT = 5;

const CATEGORY_KEYS: Record<RebateCategoryId, TranslationKey> = {
  slot: "tenantRebates.category.slot",
  live: "tenantRebates.category.live",
  sport: "tenantRebates.category.sport",
  poker: "tenantRebates.category.poker",
  fish: "tenantRebates.category.fish",
  cockfight: "tenantRebates.category.cockfight",
  esport: "tenantRebates.category.esport",
};

type CategoryDraft = {
  /** 输入框里的原始字符串（真百分比，0.5 = 0.5%），提交时才转数字 */
  rate: string;
  isActive: boolean;
};

type Drafts = Record<RebateCategoryId, CategoryDraft>;

const inputClass =
  "h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

function toDrafts(config: RebateConfig): Drafts {
  const drafts = {} as Drafts;

  for (const category of REBATE_CATEGORIES) {
    const entry = config.categories[category];

    drafts[category] = {
      rate: String(entry.ratePercent),
      isActive: entry.isActive,
    };
  }

  return drafts;
}

/** 结算日是 UTC 00:00 的日界，展示只保留日期（带时分反而让人以为是结算时刻） */
function formatSettlementDay(iso: string, language: Language): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** 结算记录里的品类是历史字符串，认不出来就原样显示（不吞数据） */
function categoryLabel(category: string): TranslationKey | null {
  return (REBATE_CATEGORIES as readonly string[]).includes(category)
    ? CATEGORY_KEYS[category as RebateCategoryId]
    : null;
}

/**
 * 商户后台【洗码返水】。
 *
 * 上半部分是 7 个品类的费率 + 开关（PATCH /api/tenant/rebates 整对象覆盖），
 * 下半部分是最近结算记录（GET 同一接口下发的 overview）。
 *
 * 三条口径：
 * - 费率是真百分比（0.5 = 0.5%），与结算公式 turnover × rate / 100 对应；
 * - 关掉某个品类 = 该品类流水一律不结算，比填 0 更明确（0 会被服务端拒绝开启）；
 * - 改费率只影响**未来**结算，历史 RebatePayout 里的费率是结算瞬间的快照。
 */
export function TenantRebatesClient({
  initialConfig,
  initialOverview,
  currency,
}: {
  initialConfig: RebateConfig;
  initialOverview: TenantRebateOverview;
  currency: string;
}) {
  const router = useRouter();
  const { t, language } = useLanguage();

  const [config, setConfig] = useState<RebateConfig>(initialConfig);
  const [drafts, setDrafts] = useState<Drafts>(() =>
    toDrafts(initialConfig),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const activeCategories = REBATE_CATEGORIES.filter(
    (category) => config.categories[category].isActive,
  );

  function updateDraft(category: RebateCategoryId, patch: Partial<CategoryDraft>) {
    setDrafts((current) => ({
      ...current,
      [category]: { ...current[category], ...patch },
    }));
  }

  async function handleSave() {
    if (saving) {
      return;
    }

    setNotice(null);

    const categories: Record<string, { ratePercent: number; isActive: boolean }> =
      {};

    for (const category of REBATE_CATEGORIES) {
      const draft = drafts[category];
      const rate = Number(draft.rate.trim() === "" ? "0" : draft.rate.trim());

      if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE_PERCENT) {
        setNotice({
          type: "error",
          text: t("tenantRebates.form.error.rate"),
        });
        return;
      }

      if (draft.isActive && rate <= 0) {
        setNotice({
          type: "error",
          text: t("tenantRebates.form.error.enabledZero"),
        });
        return;
      }

      categories[category] = { ratePercent: rate, isActive: draft.isActive };
    }

    setSaving(true);

    try {
      const response = await fetch("/api/tenant/rebates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ categories }),
      });
      const payload = (await response.json().catch(() => null)) as {
        config?: RebateConfig;
        error?: string;
      } | null;

      if (!response.ok || !payload?.config) {
        setNotice({
          type: "error",
          text: payload?.error ?? t("tenantRebates.error.actionFailed"),
        });
        return;
      }

      setConfig(payload.config);
      setDrafts(toDrafts(payload.config));
      setNotice({ type: "success", text: t("tenantRebates.notice.saved") });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: t("common.networkError") });
    } finally {
      setSaving(false);
    }
  }


  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("tenantRebates.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("tenantRebates.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
            {t("tenantRebates.subtitle", { currency })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          {saving
            ? t("tenantRebates.actions.saving")
            : t("tenantRebates.actions.save")}
        </button>
      </header>

      {notice ? (
        <div
          className={`mt-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            notice.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-red-400/20 bg-red-400/[0.06] text-red-300"
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-current opacity-60 hover:opacity-100"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: t("tenantRebates.cards.totalPaid"),
            value: formatCurrency(initialOverview.totalAmount, currency, {
              maximumFractionDigits: 2,
            }),
            hint: t("tenantRebates.cards.totalPaidHint"),
          },
          {
            label: t("tenantRebates.cards.payouts"),
            value: String(initialOverview.payoutCount),
            hint: t("tenantRebates.cards.payoutsHint"),
          },
          {
            label: t("tenantRebates.cards.players"),
            value: String(initialOverview.playerCount),
            hint: t("tenantRebates.cards.playersHint"),
          },
          {
            label: t("tenantRebates.cards.enabled"),
            value: `${activeCategories.length}/${REBATE_CATEGORIES.length}`,
            hint: t("tenantRebates.cards.enabledHint"),
          },
        ].map((card) => (
          <article
            key={card.label}
            className="relative overflow-hidden rounded-2xl border border-[#d4af37]/15 bg-gradient-to-br from-[#111111] via-[#0b0b0b] to-[#080808] p-5"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />
            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">
              {card.label}
            </p>
            <p className="mt-2 truncate font-mono text-2xl font-semibold text-white">
              {card.value}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-neutral-600">
              {card.hint}
            </p>
          </article>
        ))}
      </section>


      <section className="mt-6 rounded-2xl border border-white/10 bg-[#0b0b0b] p-5">
        <h2 className="text-sm font-semibold text-white">
          {t("tenantRebates.category.section")}
        </h2>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-neutral-600">
          {t("tenantRebates.category.sectionHint")}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {REBATE_CATEGORIES.map((category) => {
            const draft = drafts[category];

            return (
              <article
                key={category}
                className={`rounded-xl border p-4 transition-colors ${
                  draft.isActive
                    ? "border-[#d4af37]/25 bg-[#d4af37]/[0.04]"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-neutral-100">
                      {t(CATEGORY_KEYS[category])}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-700">
                      {category}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.isActive}
                    aria-label={t(CATEGORY_KEYS[category])}
                    onClick={() =>
                      updateDraft(category, { isActive: !draft.isActive })
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                      draft.isActive
                        ? "border-[#d4af37]/60 bg-[#d4af37]/25"
                        : "border-white/15 bg-white/5"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                        draft.isActive
                          ? "translate-x-[18px] bg-[#f0d27c]"
                          : "translate-x-[3px] bg-neutral-500"
                      }`}
                    />
                  </button>
                </div>

                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("tenantRebates.category.rate")}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={MAX_RATE_PERCENT}
                    step="0.01"
                    value={draft.rate}
                    onChange={(event) =>
                      updateDraft(category, { rate: event.target.value })
                    }
                    className={`${inputClass} mt-1.5`}
                  />
                </label>
              </article>
            );
          })}
        </div>

        <p className="mt-4 rounded-xl border border-sky-400/15 bg-sky-400/[0.04] px-4 py-3 text-[11px] leading-5 text-sky-200/80">
          {t("tenantRebates.hint.settlement")}
        </p>
      </section>


      <section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b]">
        <header className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {t("tenantRebates.table.title")}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-neutral-600">
              {t("tenantRebates.table.hint")}
            </p>
          </div>
          <span className="font-mono text-[10px] text-neutral-600">
            {initialOverview.payouts.length}
          </span>
        </header>

        {initialOverview.payouts.length === 0 ? (
          <p className="px-5 py-12 text-center text-xs text-neutral-600">
            {t("tenantRebates.table.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  <th className="px-5 py-3 font-medium">
                    {t("tenantRebates.table.player")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantRebates.table.category")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantRebates.table.period")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantRebates.table.turnover")}
                  </th>
                  <th className="px-5 py-3 font-medium">
                    {t("tenantRebates.table.amount")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {initialOverview.payouts.map((row) => {
                  const label = categoryLabel(row.category);

                  return (
                    <tr
                      key={row.id}
                      className="transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-3">
                        <p className="max-w-[180px] truncate text-xs font-semibold text-neutral-100">
                          {row.playerName}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-neutral-700">
                          {row.playerId.slice(0, 8)}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-neutral-400">
                        {label ? t(label) : row.category}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-neutral-300">
                        {formatSettlementDay(row.periodStart, language)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-neutral-400">
                        {formatCurrency(row.turnover, row.currency || currency)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs font-semibold text-[#f0d27c]">
                        {formatCurrency(
                          row.rebateAmount,
                          row.currency || currency,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

