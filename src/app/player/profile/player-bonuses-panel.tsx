"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useLanguage } from "@/components/LanguageProvider";
import type {
  BonusTurnoverLock,
  PlayerBonusCampaignView,
} from "@/lib/bonus-campaigns";
import { formatCurrency, normalizeCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n-types";

/**
 * 玩家端「红利」Tab：把商户在 /tenant/bonuses 配好的活动摆到玩家面前。
 *
 * 数据来源只有一个接口（服务端是唯一裁判，前端只做展示）：
 * - GET  /api/player/bonus-campaigns → { campaigns, lock, currency }
 * - POST /api/player/bonus-campaigns  body { campaignId }
 *
 * 三条展示口径：
 * 1. 列表本身只下发「开启中且正在时间窗内」的活动，所以拿到就能展示；
 * 2. 已领取但流水没打满 = 锁定中（PENDING 的领取记录会拦住 /api/withdrawal/create）；
 * 3. 进度条读领取记录自己的 requiredTurnover / wageredTurnover，
 *    不是全局 lock 的汇总 —— 否则同一页两张卡的进度条会长得一模一样。
 */

type CampaignsPayload = {
  campaigns?: PlayerBonusCampaignView[];
  lock?: BonusTurnoverLock;
  currency?: string;
};

type ClaimPayload = {
  balance?: string;
  claim?: {
    id: string;
    amount: string;
    requiredTurnover: string;
    status: "PENDING" | "COMPLETED";
  };
  code?: string;
  error?: string;
};

/** 活动类型 -> 文案：与后台 /tenant/bonuses 共用同一套词典，避免两处措辞漂移 */
const TYPE_KEYS: Record<string, TranslationKey> = {
  register: "tenantBonuses.type.register",
  deposit: "tenantBonuses.type.deposit",
  first_deposit: "tenantBonuses.type.first_deposit",
};

/**
 * 领取失败错误码 -> 文案。
 * 只在本页映射，不进共享的 playerErrorKey：这些 code 是红利引擎专用的
 * （见 src/lib/bonus-campaigns.ts 的 BonusClaimCode），其中 not_eligible 同时表示
 * 「账号状态不可领」与「不满足活动条件」，统一用一句面向玩家的话兜住即可。
 */
const CLAIM_ERROR_KEYS: Record<string, TranslationKey> = {
  campaign_not_found: "player.bonuses.error.notFound",
  campaign_inactive: "player.bonuses.error.inactive",
  campaign_not_started: "player.bonuses.error.notStarted",
  campaign_ended: "player.bonuses.error.ended",
  already_claimed: "player.bonuses.error.alreadyClaimed",
  not_eligible: "player.bonuses.error.notEligible",
  unauthorized: "player.error.unauthorized",
};

const RECEIPT_TITLE_ID = "player-bonus-receipt-title";

/** 进度百分比（0-100）。required 为 0（无流水要求）视为 100% */
function readProgress(wagered: string, required: string) {
  const target = Number(required);
  const done = Number(wagered);

  if (!Number.isFinite(target) || target <= 0) {
    return 100;
  }

  if (!Number.isFinite(done) || done <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((done / target) * 100));
}

/**
 * 未领取卡片的「需打满流水」预估值。
 * 与服务端 claimPlayerBonus 的算法严格对齐：reward × multiplier 四舍五入到分
 * （见 src/lib/bonus-campaigns.ts 的 requiredTurnover）。
 */
function previewRequiredTurnover(reward: string, multiplier: string) {
  const amount = Number(reward) * Number(multiplier);

  if (!Number.isFinite(amount) || amount <= 0) {
    return "0.00";
  }

  return (Math.round(amount * 100) / 100).toFixed(2);
}

async function requestCampaigns(signal?: AbortSignal) {
  try {
    const response = await fetch("/api/player/bonus-campaigns", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json().catch(() => ({}))) as CampaignsPayload;

    return {
      campaigns: data.campaigns ?? [],
      lock: data.lock ?? null,
      currency: data.currency ? normalizeCurrency(data.currency) : null,
    };
  } catch {
    return null;
  }
}

export function PlayerBonusesPanel({
  currency,
  onClaimed,
}: {
  /** 租户记账币种（Tenant.currency）：金额符号一律走 formatCurrency，不写死 $ */
  currency: string;
  /** 领取成功后把新余额抛给玩家中心，顶栏余额要立刻变，不等下一次刷新 */
  onClaimed: (payload: { balance?: string; amount: string }) => void;
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  const [campaigns, setCampaigns] = useState<PlayerBonusCampaignView[]>([]);
  const [lock, setLock] = useState<BonusTurnoverLock | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    amount: string;
    requiredTurnover: string;
    status: "PENDING" | "COMPLETED";
    balance?: string;
  } | null>(null);

  // lock 里的币种来自领取记录快照，优先级高于租户当前配置（历史活动不会被新配置改写文案）
  const displayCurrency = normalizeCurrency(lock?.currency ?? currency);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      const data = await requestCampaigns(controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      if (!data) {
        setState("failed");
        return;
      }

      setCampaigns(data.campaigns);
      setLock(data.lock);
      setState("ready");
    })();

    return () => controller.abort();
  }, []);

  // 领取回执弹窗：Esc 关闭 + 锁滚动（手机端弹窗后面跟着长列表，不锁会跟着滑）
  useEffect(() => {
    if (!receipt) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReceipt(null);
      }
    };

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [receipt]);

  async function reload() {
    const data = await requestCampaigns();

    if (!data) {
      return;
    }

    setCampaigns(data.campaigns);
    setLock(data.lock);
    setState("ready");
  }

  async function handleClaim(campaign: PlayerBonusCampaignView) {
    // 同一时刻只允许一笔领取：连点会让后端连开两个事务（唯一键能挡，但界面不该给出可点的假象）
    if (busyId) {
      return;
    }

    setBusyId(campaign.id);
    setNotice(null);

    try {
      const response = await fetch("/api/player/bonus-campaigns", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id }),
      });
      const data = (await response.json().catch(() => ({}))) as ClaimPayload;

      if (!response.ok || !data.claim) {
        const key = CLAIM_ERROR_KEYS[data.code ?? ""];

        setNotice(key ? t(key) : (data.error ?? t("player.error.generic")));
        // 领失败大概率是「已领过 / 活动刚下线」：拉一次列表，别让玩家对着过期卡片反复点
        await reload();
        return;
      }

      const claim = data.claim;

      // 先就地更新这张卡：即使随后的列表刷新失败，也不会退回到「还能再领一次」
      setCampaigns((prev) =>
        prev.map((item) =>
          item.id === campaign.id
            ? {
                ...item,
                claimed: true,
                claimStatus: claim.status,
                claimedAt: new Date().toISOString(),
                requiredTurnover: claim.requiredTurnover,
                wageredTurnover: "0.00",
                remainingTurnover: claim.requiredTurnover,
              }
            : item,
        ),
      );
      setReceipt({
        amount: claim.amount,
        requiredTurnover: claim.requiredTurnover,
        status: claim.status,
        balance: data.balance,
      });
      onClaimed({ balance: data.balance, amount: claim.amount });
      // 再以服务端为准拉一次（lock 汇总、其他活动的状态一起更新）
      await reload();
    } catch {
      setNotice(t("common.networkError"));
    } finally {
      setBusyId(null);
    }
  }

  const lockProgress = lock ? readProgress(lock.wageredTotal, lock.requiredTotal) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-neutral-100">
            {t("player.bonuses.title")}
          </h2>
          <p className="mt-1 text-[10px] leading-5 text-neutral-500">
            {t("player.bonuses.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="h-8 shrink-0 rounded-lg border border-white/[0.08] px-3 text-[10px] font-semibold text-neutral-400 transition-colors hover:border-brand/30 hover:text-brand-soft"
        >
          {t("player.bonuses.refresh")}
        </button>
      </div>

      {/* 提现锁定提示：只在真的存在未打满流水的领取记录时出现（lock.pendingCount > 0） */}
      {lock && lock.pendingCount > 0 ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-amber-200">
              {t("player.bonuses.lockTitle")}
            </p>
            <p className="font-mono text-[10px] tabular-nums text-amber-100/60">
              {t("player.bonuses.lockProgress", {
                wagered: formatCurrency(lock.wageredTotal, displayCurrency),
                required: formatCurrency(lock.requiredTotal, displayCurrency),
              })}
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500/80 via-amber-300 to-amber-200 transition-[width] duration-500"
              style={{ width: `${lockProgress}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-5 text-amber-100/70">
            {t("player.bonuses.lockBody", {
              count: lock.pendingCount,
              amount: formatCurrency(lock.outstanding, displayCurrency),
            })}
          </p>
        </div>
      ) : null}

      {notice ? (
        <p
          role="alert"
          className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-2.5 text-[11px] leading-5 text-red-200"
        >
          {notice}
        </p>
      ) : null}

      {state === "loading" ? (
        <p className="rounded-2xl border border-white/[0.06] bg-[#080808]/80 px-4 py-10 text-center text-[11px] text-neutral-500">
          {t("player.bonuses.loading")}
        </p>
      ) : null}

      {state === "failed" ? (
        <div className="rounded-2xl border border-white/[0.06] bg-[#080808]/80 px-4 py-10 text-center">
          <p className="text-[11px] text-neutral-500">
            {t("player.bonuses.loadFailed")}
          </p>
          <button
            type="button"
            onClick={() => {
              setState("loading");
              void reload();
            }}
            className="mt-3 h-9 rounded-xl border border-brand/30 px-4 text-[11px] font-semibold text-brand-soft transition-colors hover:bg-brand/10"
          >
            {t("player.bonuses.retry")}
          </button>
        </div>
      ) : null}

      {state === "ready" && campaigns.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.06] bg-[#080808]/80 px-4 py-10 text-center text-[11px] text-neutral-500">
          {t("player.bonuses.empty")}
        </p>
      ) : null}

      {campaigns.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((campaign) => {
            const claimed = campaign.claimed;
            const completed = campaign.claimStatus === "COMPLETED";
            const busy = busyId === campaign.id;
            const percent = readProgress(
              campaign.wageredTurnover,
              campaign.requiredTurnover,
            );
            const multiplier = Number(campaign.turnoverMultiplier);
            const multiplierLabel = Number.isFinite(multiplier)
              ? String(multiplier)
              : campaign.turnoverMultiplier;
            // 已领取读领取记录快照（服务端算的），未领取按同一公式预估
            const requiredTurnover = claimed
              ? campaign.requiredTurnover
              : previewRequiredTurnover(
                  campaign.rewardAmount,
                  campaign.turnoverMultiplier,
                );
            const typeKey = TYPE_KEYS[campaign.type];

            return (
              <article
                key={campaign.id}
                className="relative flex flex-col overflow-hidden rounded-2xl border border-brand/20 bg-gradient-to-b from-brand/[0.10] via-[#0a0a0a] to-[#050505] p-4"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-soft/60 to-transparent"
                />

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {typeKey ? (
                      <span className="inline-flex rounded-full border border-brand/25 bg-brand/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-brand-soft">
                        {t(typeKey)}
                      </span>
                    ) : null}
                    <h3 className="mt-2 break-words text-sm font-bold leading-5 text-neutral-100">
                      {campaign.name}
                    </h3>
                    <p className="mt-1 text-[10px] text-neutral-600">
                      {t("player.bonuses.endsAt", {
                        date: formatDate(campaign.endAt, locale),
                      })}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-neutral-500">
                      {t("player.bonuses.reward")}
                    </p>
                    <p className="mt-0.5 font-mono text-xl font-black tabular-nums text-brand-pale">
                      {formatCurrency(campaign.rewardAmount, displayCurrency)}
                    </p>
                  </div>
                </div>

                <p className="mt-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[10px] leading-5 text-neutral-400">
                  {Number.isFinite(multiplier) && multiplier > 0
                    ? t("player.bonuses.turnover", {
                        multiplier: multiplierLabel,
                        amount: formatCurrency(
                          requiredTurnover,
                          displayCurrency,
                        ),
                      })
                    : t("player.bonuses.turnoverNone")}
                </p>

                {/* 流水进度条：只有领过的活动才有 claim，也就才有 required / wagered */}
                {claimed ? (
                  <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">
                        {t("player.bonuses.progressLabel")}
                      </span>
                      <span
                        className={`font-mono text-[10px] tabular-nums ${
                          completed ? "text-emerald-300" : "text-neutral-300"
                        }`}
                      >
                        {t("player.bonuses.progressValue", {
                          wagered: formatCurrency(
                            campaign.wageredTurnover,
                            displayCurrency,
                          ),
                          required: formatCurrency(
                            campaign.requiredTurnover,
                            displayCurrency,
                          ),
                        })}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      aria-label={t("player.bonuses.progressLabel")}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"
                    >
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${
                          completed
                            ? "bg-emerald-400/80"
                            : "bg-gradient-to-r from-brand-deep via-brand to-brand-soft"
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] leading-5 text-neutral-500">
                      {completed
                        ? t("player.bonuses.progressDone")
                        : t("player.bonuses.progressRemaining", {
                            amount: formatCurrency(
                              campaign.remainingTurnover,
                              displayCurrency,
                            ),
                          })}
                    </p>
                  </div>
                ) : null}

                <div className="mt-auto flex items-center justify-end pt-3">
                  {claimed ? (
                    <span
                      className={`inline-flex h-9 items-center rounded-xl border px-4 text-[11px] font-bold ${
                        completed
                          ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300"
                          : "border-white/[0.08] bg-white/[0.03] text-neutral-500"
                      }`}
                    >
                      {completed
                        ? t("player.bonuses.completed")
                        : t("player.bonuses.locked")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleClaim(campaign)}
                      disabled={Boolean(busyId)}
                      className="h-9 rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft px-5 text-[11px] font-bold text-brand-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy
                        ? t("player.bonuses.claiming")
                        : t("player.bonuses.claim")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {/* 领取回执：走 createPortal 挂到 body，避免被祖先的 transform / overflow 裁切 */}
      {receipt && typeof document !== "undefined"
        ? createPortal(
            <div
              role="presentation"
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setReceipt(null);
                }
              }}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby={RECEIPT_TITLE_ID}
                className="w-full max-w-sm overflow-hidden rounded-2xl border border-brand/25 bg-[#0a0a0a] shadow-[0_30px_120px_-30px_rgba(212,175,55,0.45)]"
              >
                <div className="border-b border-brand/10 bg-gradient-to-br from-brand/[0.14] to-transparent px-5 py-5 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-soft/70">
                    {t("player.bonuses.eyebrow")}
                  </p>
                  <h2
                    id={RECEIPT_TITLE_ID}
                    className="mt-1.5 text-base font-black text-brand-pale"
                  >
                    {t("player.bonuses.successTitle")}
                  </h2>
                </div>

                <div className="space-y-3 px-5 py-5">
                  <p className="text-center font-mono text-2xl font-black tabular-nums text-brand-pale">
                    {formatCurrency(receipt.amount, displayCurrency, {
                      signed: true,
                    })}
                  </p>
                  <p className="text-center text-[11px] leading-5 text-neutral-400">
                    {receipt.status === "COMPLETED"
                      ? t("player.bonuses.successBodyCompleted")
                      : t("player.bonuses.successBody", {
                          amount: formatCurrency(
                            receipt.requiredTurnover,
                            displayCurrency,
                          ),
                        })}
                  </p>

                  {receipt.balance ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <span className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">
                        {t("player.bonuses.successBalance")}
                      </span>
                      <span className="truncate font-mono text-[11px] tabular-nums text-neutral-200">
                        {formatCurrency(receipt.balance, displayCurrency)}
                      </span>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setReceipt(null)}
                    className="h-10 w-full rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft text-[11px] font-bold text-brand-ink transition-opacity hover:opacity-90"
                  >
                    {t("player.bonuses.successClose")}
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
