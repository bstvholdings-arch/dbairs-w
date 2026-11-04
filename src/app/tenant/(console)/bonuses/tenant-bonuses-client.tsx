"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type {
  BonusCampaignStatus,
  BonusCampaignView,
} from "@/lib/bonus-campaigns";
import type { BonusCampaignTypeId } from "@/lib/bonus-campaign-types";
import { formatCurrency } from "@/lib/currency";
import type { Language, TranslationKey } from "@/lib/i18n-types";

import { TenantBonusFormModal } from "./tenant-bonus-form-modal";

const STATUS_KEYS: Record<BonusCampaignStatus, TranslationKey> = {
  active: "tenantBonuses.status.active",
  upcoming: "tenantBonuses.status.upcoming",
  expired: "tenantBonuses.status.expired",
  disabled: "tenantBonuses.status.disabled",
};

const STATUS_CLASS: Record<BonusCampaignStatus, string> = {
  active: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  upcoming: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  expired: "border-neutral-500/25 bg-neutral-500/10 text-neutral-400",
  disabled: "border-amber-400/25 bg-amber-400/10 text-amber-300",
};

const TYPE_KEYS: Record<BonusCampaignTypeId, TranslationKey> = {
  register: "tenantBonuses.type.register",
  deposit: "tenantBonuses.type.deposit",
  first_deposit: "tenantBonuses.type.first_deposit",
};

/** 时间只到分钟：商户按「几点上线」思考，秒没有意义 */
function formatDateTime(iso: string, language: Language): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** 所需流水 = 奖励 × 倍数（与服务端 accrueBonusTurnover 的判定口径一致） */
function requiredTurnover(campaign: BonusCampaignView): number {
  return Number(campaign.rewardAmount) * Number(campaign.turnoverMultiplier);
}

function upsertCampaign(
  campaigns: BonusCampaignView[],
  next: BonusCampaignView,
): BonusCampaignView[] {
  const exists = campaigns.some((campaign) => campaign.id === next.id);

  if (!exists) {
    return [next, ...campaigns];
  }

  return campaigns.map((campaign) =>
    campaign.id === next.id ? next : campaign,
  );
}


/**
 * 商户后台【红利活动】。
 *
 * 数据流：首屏由 Server Component 注入（initialCampaigns），
 * 之后每次写操作都用接口返回的对象就地更新，再 router.refresh()
 * 让服务端统计保持一致（status 是「实时推导」的，刷新才不会停在旧时间窗）。
 *
 * 写入口与口径：
 * - 新建 POST /api/tenant/bonuses（默认停用）
 * - 编辑 PATCH /api/tenant/bonuses/[id]（整对象覆盖）
 * - 启停 PATCH /api/tenant/bonuses/[id] 只传 { isActive }
 * - 删除 DELETE /api/tenant/bonuses/[id]（有人领过会 409，只能停用）
 */
export function TenantBonusesClient({
  initialCampaigns,
  tenantName,
  currency,
}: {
  initialCampaigns: BonusCampaignView[];
  tenantName: string;
  currency: string;
}) {
  const router = useRouter();
  const { t, language } = useLanguage();

  const [campaigns, setCampaigns] =
    useState<BonusCampaignView[]>(initialCampaigns);
  const [modal, setModal] = useState<
    { mode: "create" } | { mode: "edit"; campaign: BonusCampaignView } | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const stats = useMemo(() => {
    let active = 0;
    let outside = 0;
    let claims = 0;

    for (const campaign of campaigns) {
      if (campaign.status === "active") {
        active += 1;
      } else if (
        campaign.status === "upcoming" ||
        campaign.status === "expired"
      ) {
        outside += 1;
      }

      claims += campaign.claimCount;
    }

    return { active, outside, claims };
  }, [campaigns]);

  async function toggleCampaign(campaign: BonusCampaignView) {
    if (busyId) {
      return;
    }

    const nextActive = !campaign.isActive;
    setBusyId(campaign.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/tenant/bonuses/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        // 只传开关：避免把整份表单（含时间窗）重新提交一遍
        body: JSON.stringify({ isActive: nextActive }),
      });
      const payload = (await response.json().catch(() => null)) as {
        campaign?: BonusCampaignView;
        error?: string;
      } | null;

      if (!response.ok || !payload?.campaign) {
        setNotice({
          type: "error",
          text: payload?.error ?? t("tenantBonuses.error.actionFailed"),
        });
        return;
      }

      const updated = payload.campaign;
      setCampaigns((current) => upsertCampaign(current, updated));
      setNotice({
        type: "success",
        text: t(
          nextActive
            ? "tenantBonuses.notice.enabled"
            : "tenantBonuses.notice.disabled",
        ),
      });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: t("common.networkError") });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCampaign(campaign: BonusCampaignView) {
    if (busyId) {
      return;
    }

    if (
      !window.confirm(
        t("tenantBonuses.notice.confirmDelete", { name: campaign.name }),
      )
    ) {
      return;
    }

    setBusyId(campaign.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/tenant/bonuses/${campaign.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setNotice({
          type: "error",
          text: payload?.error ?? t("tenantBonuses.error.actionFailed"),
        });
        return;
      }

      setCampaigns((current) =>
        current.filter((item) => item.id !== campaign.id),
      );
      setNotice({ type: "success", text: t("tenantBonuses.notice.deleted") });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: t("common.networkError") });
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(
    campaign: BonusCampaignView,
    mode: "create" | "edit",
  ) {
    setCampaigns((current) => upsertCampaign(current, campaign));
    setModal(null);
    setNotice({
      type: "success",
      text: t(
        mode === "create"
          ? "tenantBonuses.notice.created"
          : "tenantBonuses.notice.saved",
      ),
    });
    router.refresh();
  }

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("tenantBonuses.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("tenantBonuses.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
            {t("tenantBonuses.subtitle", { tenant: tenantName })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 sm:self-auto"
        >
          <span className="text-base leading-none">+</span>
          {t("tenantBonuses.actions.create")}
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
            label: t("tenantBonuses.cards.total"),
            value: String(campaigns.length),
            hint: t("tenantBonuses.cards.totalHint"),
          },
          {
            label: t("tenantBonuses.cards.active"),
            value: String(stats.active),
            hint: t("tenantBonuses.cards.activeHint"),
          },
          {
            label: t("tenantBonuses.cards.outside"),
            value: String(stats.outside),
            hint: t("tenantBonuses.cards.outsideHint"),
          },
          {
            label: t("tenantBonuses.cards.claims"),
            value: String(stats.claims),
            hint: t("tenantBonuses.cards.claimsHint"),
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
            <p className="mt-2 font-mono text-2xl font-semibold text-white">
              {card.value}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-neutral-600">
              {card.hint}
            </p>
          </article>
        ))}
      </section>


      <section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b]">
        <header className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {t("tenantBonuses.list.title")}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-neutral-600">
              {t("tenantBonuses.list.hint")}
            </p>
          </div>
          <span className="font-mono text-[10px] text-neutral-600">
            {campaigns.length}
          </span>
        </header>

        {campaigns.length === 0 ? (
          <p className="px-5 py-12 text-center text-xs text-neutral-600">
            {t("tenantBonuses.list.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  <th className="px-5 py-3 font-medium">
                    {t("tenantBonuses.table.name")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantBonuses.table.type")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantBonuses.table.reward")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantBonuses.table.turnover")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantBonuses.table.window")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantBonuses.table.status")}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {t("tenantBonuses.table.claims")}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t("tenantBonuses.table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {campaigns.map((campaign) => {
                  const busy = busyId === campaign.id;

                  return (
                    <tr
                      key={campaign.id}
                      className="align-top transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-4">
                        <p className="max-w-[220px] truncate text-xs font-semibold text-neutral-100">
                          {campaign.name}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-neutral-700">
                          {campaign.id.slice(0, 8)}
                        </p>
                      </td>
                      <td className="px-3 py-4 text-[11px] text-neutral-400">
                        {t(TYPE_KEYS[campaign.type])}
                      </td>
                      <td className="px-3 py-4 font-mono text-xs text-[#f0d27c]">
                        {formatCurrency(
                          campaign.rewardAmount,
                          campaign.currency || currency,
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-mono text-[11px] text-neutral-300">
                          ×{Number(campaign.turnoverMultiplier).toFixed(2)}
                        </p>
                        <p className="mt-1 whitespace-nowrap font-mono text-[10px] text-neutral-600">
                          {formatCurrency(
                            requiredTurnover(campaign),
                            campaign.currency || currency,
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <p className="whitespace-nowrap text-[11px] text-neutral-300">
                          {formatDateTime(campaign.startAt, language)}
                        </p>
                        <p className="mt-1 whitespace-nowrap text-[11px] text-neutral-500">
                          {formatDateTime(campaign.endAt, language)}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            STATUS_CLASS[campaign.status]
                          }`}
                        >
                          {t(STATUS_KEYS[campaign.status])}
                        </span>
                      </td>
                      <td className="px-3 py-4 font-mono text-xs text-neutral-300">
                        {campaign.claimCount}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setModal({ mode: "edit", campaign })
                            }
                            disabled={busy}
                            className="rounded-md border border-[#d4af37]/25 px-2 py-1 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:border-[#d4af37]/50 disabled:opacity-40"
                          >
                            {t("tenantBonuses.actions.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleCampaign(campaign)}
                            disabled={busy}
                            className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold text-neutral-300 transition-colors hover:border-white/25 disabled:opacity-40"
                          >
                            {campaign.isActive
                              ? t("tenantBonuses.actions.disable")
                              : t("tenantBonuses.actions.enable")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteCampaign(campaign)}
                            disabled={busy}
                            className="rounded-md border border-red-400/20 px-2 py-1 text-[10px] font-semibold text-red-300 transition-colors hover:border-red-400/50 disabled:opacity-40"
                          >
                            {t("tenantBonuses.actions.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal ? (
        <TenantBonusFormModal
          campaign={modal.mode === "edit" ? modal.campaign : null}
          currency={currency}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

