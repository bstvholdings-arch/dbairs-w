"use client";

import { useEffect, useId, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  BONUS_CAMPAIGN_TYPES,
  type BonusCampaignTypeId,
} from "@/lib/bonus-campaign-types";
import type { BonusCampaignView } from "@/lib/bonus-campaigns";
import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 与 src/lib/bonus-campaigns.ts 的上限保持一致。
 * 客户端只做「填错立刻提示」，真正的闸门仍在服务端 parseBonusCampaignInput
 * （超限 / 时间窗倒挂会 400 回来，直接显示在弹窗底部）。
 */
const NAME_MAX_LENGTH = 60;
const MAX_REWARD = 100000;
const MAX_TURNOVER_MULTIPLIER = 50;
/** 新建活动默认开 30 天，商户只需要改日期，不用从空白开始填 */
const DEFAULT_WINDOW_DAYS = 30;

const TYPE_KEYS: Record<BonusCampaignTypeId, TranslationKey> = {
  register: "tenantBonuses.type.register",
  deposit: "tenantBonuses.type.deposit",
  first_deposit: "tenantBonuses.type.first_deposit",
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

const labelClass = "text-[10px] uppercase tracking-[0.16em] text-neutral-600";

type BonusFormValues = {
  name: string;
  type: BonusCampaignTypeId;
  reward: string;
  turnover: string;
  startAt: string;
  endAt: string;
  isActive: boolean;
};

/**
 * Date → `<input type="datetime-local">` 需要的本地时间串（YYYY-MM-DDTHH:mm）。
 * 不能直接 slice ISO：ISO 是 UTC，商户在东八区看到的时间会差 8 小时。
 */
function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 提交时转成绝对时间（ISO）：服务端 new Date(iso) 拿到的时刻与浏览器所见一致，
 * 不依赖服务器时区是否和商户所在时区相同。
 */
function toIsoString(value: string): string | null {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function initialValues(campaign: BonusCampaignView | null): BonusFormValues {
  if (!campaign) {
    const start = new Date();
    const end = new Date(start.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);

    return {
      name: "",
      type: "register",
      reward: "",
      turnover: "1",
      startAt: toDateTimeLocalValue(start),
      endAt: toDateTimeLocalValue(end),
      // 与「新建默认不上线」一致：勾了才发布
      isActive: false,
    };
  }

  return {
    name: campaign.name,
    type: campaign.type,
    reward: campaign.rewardAmount,
    turnover: campaign.turnoverMultiplier,
    startAt: toDateTimeLocalValue(new Date(campaign.startAt)),
    endAt: toDateTimeLocalValue(new Date(campaign.endAt)),
    isActive: campaign.isActive,
  };
}

/**
 * 红利活动的新增 / 编辑弹窗。
 *
 * 口径说明：
 * - 提交永远是**完整对象**（POST 新建 / PATCH 覆盖），避免部分更新把时间窗清空；
 * - `isActive` 必须显式提交 true 才会启用（服务端也只认 true），
 *   所以「只保存不上线」是一等公民，不是靠漏字段实现；
 * - 停用请用列表页的开关（PATCH 只传 isActive），
 *   已有人领过的活动服务端禁止删除（会把流水锁一起 cascade 掉）。
 */
export function TenantBonusFormModal({
  campaign,
  currency,
  onClose,
  onSaved,
}: {
  campaign: BonusCampaignView | null;
  currency: string;
  onClose: () => void;
  onSaved: (campaign: BonusCampaignView, mode: "create" | "edit") => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const isEdit = Boolean(campaign);

  const [form, setForm] = useState<BonusFormValues>(() =>
    initialValues(campaign),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 弹窗打开时锁定背景滚动，关闭后恢复（与其它后台弹窗一致）
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setError(null);

    const name = form.name.trim();

    if (!name) {
      setError(t("tenantBonuses.form.error.name"));
      return;
    }

    const reward = Number(form.reward);

    if (!Number.isFinite(reward) || reward <= 0 || reward > MAX_REWARD) {
      setError(t("tenantBonuses.form.error.reward"));
      return;
    }

    const turnover = Number(form.turnover);

    if (
      !Number.isFinite(turnover) ||
      turnover < 0 ||
      turnover > MAX_TURNOVER_MULTIPLIER
    ) {
      setError(t("tenantBonuses.form.error.turnover"));
      return;
    }

    const startAt = toIsoString(form.startAt);
    const endAt = toIsoString(form.endAt);

    if (
      !startAt ||
      !endAt ||
      new Date(endAt).getTime() <= new Date(startAt).getTime()
    ) {
      setError(t("tenantBonuses.form.error.window"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        isEdit ? `/api/tenant/bonuses/${campaign?.id}` : "/api/tenant/bonuses",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            name,
            type: form.type,
            rewardAmount: form.reward.trim(),
            turnoverMultiplier: form.turnover.trim(),
            startAt,
            endAt,
            isActive: form.isActive,
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as {
        campaign?: BonusCampaignView;
        error?: string;
      } | null;

      if (!response.ok || !payload?.campaign) {
        setError(payload?.error ?? t("tenantBonuses.error.actionFailed"));
        return;
      }

      onSaved(payload.campaign, isEdit ? "edit" : "create");
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_120px_-30px_rgba(212,175,55,0.35)] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#d4af37]/10 px-5 py-4">
          <div>
            <p className="text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/60">
              {t("tenantBonuses.eyebrow")}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
              {t(
                isEdit
                  ? "tenantBonuses.form.editTitle"
                  : "tenantBonuses.form.createTitle",
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label={t("common.close")}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-white/25 hover:text-neutral-200 disabled:opacity-40"
          >
            {t("tenantBonuses.form.cancel")}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={labelClass}>{t("tenantBonuses.form.name")}</span>
              <input
                type="text"
                value={form.name}
                maxLength={NAME_MAX_LENGTH}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder={t("tenantBonuses.form.namePlaceholder")}
                className={inputClass}
              />
            </label>

            <label>
              <span className={labelClass}>{t("tenantBonuses.form.type")}</span>
              <select
                value={form.type}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as BonusCampaignTypeId,
                  }))
                }
                className={inputClass}
              >
                {BONUS_CAMPAIGN_TYPES.map((type) => (
                  <option key={type} value={type} className="bg-[#0a0a0a]">
                    {t(TYPE_KEYS[type])}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className={labelClass}>
                {t("tenantBonuses.form.reward", { currency })}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                max={MAX_REWARD}
                value={form.reward}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reward: event.target.value,
                  }))
                }
                placeholder="0.00"
                className={inputClass}
              />
            </label>

            <label>
              <span className={labelClass}>
                {t("tenantBonuses.form.turnover")}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                max={MAX_TURNOVER_MULTIPLIER}
                value={form.turnover}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    turnover: event.target.value,
                  }))
                }
                placeholder="1"
                className={inputClass}
              />
            </label>

            <label>
              <span className={labelClass}>
                {t("tenantBonuses.form.startAt")}
              </span>
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startAt: event.target.value,
                  }))
                }
                className={inputClass}
              />
            </label>

            <label>
              <span className={labelClass}>
                {t("tenantBonuses.form.endAt")}
              </span>
              <input
                type="datetime-local"
                value={form.endAt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endAt: event.target.value,
                  }))
                }
                className={inputClass}
              />
            </label>
          </div>


          <p className="mt-3 text-[11px] leading-5 text-neutral-600">
            {t("tenantBonuses.form.typeHint")}
          </p>
          <p className="text-[11px] leading-5 text-neutral-600">
            {t("tenantBonuses.form.turnoverHint")}
          </p>
          <p className="text-[11px] leading-5 text-neutral-600">
            {t("tenantBonuses.form.windowHint")}
          </p>

          <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#d4af37]"
            />
            <span>
              <span className="block text-xs font-semibold text-neutral-200">
                {t("tenantBonuses.form.active")}
              </span>
              <span className="mt-0.5 block text-[11px] text-neutral-600">
                {t("tenantBonuses.form.activeHint")}
              </span>
            </span>
          </label>

          {error ? (
            <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[11px] text-red-300">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/5 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-10 rounded-xl border border-white/10 px-4 text-xs font-semibold text-neutral-300 transition-colors hover:border-white/25 disabled:opacity-40"
            >
              {t("tenantBonuses.form.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? t("tenantBonuses.form.saving")
                : t(
                    isEdit
                      ? "tenantBonuses.form.save"
                      : "tenantBonuses.form.create",
                  )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

