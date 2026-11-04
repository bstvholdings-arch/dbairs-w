"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/components/LanguageProvider";
import { TenantBrandLockup } from "@/components/brand/tenant-brand";
import { PlayerDepositButton } from "@/components/player-deposit-button";
import { PlayerWithdrawButton } from "@/components/player/withdraw-button";
import { resolveBrandName } from "@/lib/brand";
import { formatCurrency, normalizeCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n-types";
import { playerErrorKey } from "@/lib/player-errors";
import { availableBalanceToString } from "@/lib/player-balance";
import { notifyPlayerWalletChanged } from "@/lib/player-wallet-events";
import type { PlayerProfileData } from "@/lib/player-profile";
import { readPlayerPassword } from "@/lib/player-validation";
import { buildStorefrontTheme } from "@/lib/storefront";

import { PlayerWithdrawalAccounts } from "./player-withdrawal-accounts";
import { PlayerBonusesPanel } from "./player-bonuses-panel";

// 推广链接要展示真实域名：getSnapshot 只在客户端读到 window.location.origin，
// 服务端快照返回空串，因此不会出现水合不一致；subscribe 无需订阅任何外部源。
const subscribeNoop = () => () => {};
const readBrowserOrigin = () => window.location.origin;

export type PlayerProfileTab =
  | "wallet"
  | "bonuses"
  | "history"
  | "security"
  | "referral";

export const PLAYER_PROFILE_TABS: {
  id: PlayerProfileTab;
  labelKey: TranslationKey;
}[] = [
  { id: "wallet", labelKey: "player.profile.tabs.wallet" },
  { id: "bonuses", labelKey: "player.profile.tabs.bonuses" },
  { id: "history", labelKey: "player.profile.tabs.history" },
  { id: "security", labelKey: "player.profile.tabs.security" },
  { id: "referral", labelKey: "player.profile.tabs.referral" },
];

const TRANSACTION_TYPE_KEYS: Record<string, TranslationKey> = {
  deposit: "player.wallet.type.deposit",
  withdraw: "player.wallet.type.withdraw",
  bet: "player.wallet.type.bet",
  win: "player.wallet.type.win",
  referral: "player.wallet.type.referral",
  daily_bonus: "player.wallet.type.daily_bonus",
  // 红利领取写的是 Transaction(type="bonus")，不映射就会在流水表里露出英文原始值
  bonus: "player.wallet.type.bonus",
  // 洗码结算写的是 Transaction(type="rebate")，同理不能露出原值
  rebate: "player.wallet.type.rebate",
  // 游戏商退款回调写的是 Transaction(type="refund")
  refund: "player.wallet.type.refund",
};

const STATUS_KEYS: Record<string, TranslationKey> = {
  pending: "player.wallet.status.pending",
  processing: "player.wallet.status.pending",
  success: "player.wallet.status.success",
  approved: "player.wallet.status.approved",
  settled: "player.history.status.settled",
  completed: "player.wallet.status.success",
  failed: "player.wallet.status.failed",
  rejected: "player.wallet.status.rejected",
  cancelled: "player.wallet.status.cancelled",
  void: "player.history.status.cancelled",
};

const INPUT_CLASS =
  "mt-1.5 h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-brand/50 focus:ring-1 focus:ring-brand/25";

function addAmount(left: string, right: string) {
  const sum = Number(left) + Number(right);
  return Number.isFinite(sum) ? sum.toFixed(6) : left;
}

function shortValue(value: string, head = 10, tail = 6) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** 实名认证状态文案（NONE = 从未提交） */
const KYC_STATUS_KEYS: Record<string, TranslationKey> = {
  NONE: "player.kyc.status.none",
  PENDING: "player.kyc.status.pending",
  APPROVED: "player.kyc.status.approved",
  REJECTED: "player.kyc.status.rejected",
};

/**
 * 钱包页顶部的实名认证提示条。
 *
 * 未认证 -> 「请完成实名认证以解锁提现」并给出去认证入口；
 * 审核中 / 已驳回 / 已通过 -> 展示对应状态，入口一直保留（可看进度）。
 */
function KycNotice({ kyc }: { kyc: PlayerProfileData["kyc"] }) {
  const { t } = useLanguage();

  const tone =
    kyc.status === "APPROVED"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : kyc.status === "REJECTED"
        ? "border-red-400/25 bg-red-400/10 text-red-200"
        : kyc.status === "PENDING"
          ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
          : "border-brand/25 bg-brand/[0.06] text-brand-pale";

  const text =
    kyc.status === "APPROVED"
      ? t("player.kyc.banner.approved")
      : kyc.status === "PENDING"
        ? t("player.kyc.banner.pending")
        : kyc.status === "REJECTED"
          ? t("player.kyc.banner.rejected", {
              reason: kyc.rejectReason ?? "",
            })
          : t("player.kyc.banner.required");

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-[11px] ${tone}`}
    >
      <p className="min-w-0 leading-5">{text}</p>
      <Link
        href="/player/kyc"
        className="inline-flex h-8 shrink-0 items-center rounded-lg border border-white/20 px-3 text-[10px] font-semibold transition-colors hover:bg-white/10"
      >
        {t("player.kyc.profileAction")}
      </Link>
    </div>
  );
}

/**
 * 玩家中心：钱包 / 注单 / 安全 / 推广 四个 Tab。
 * 服务端一次取齐数据（见 lib/player-profile.ts），这里只做交互和局部状态更新，
 * 涉及金额的字段全部保持字符串，避免 Decimal -> number 的精度损失。
 */
export function PlayerProfileClient({
  profile,
  initialTab,
}: {
  profile: PlayerProfileData;
  initialTab: PlayerProfileTab;
}) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const theme = useMemo(
    () => buildStorefrontTheme(profile.player.tenant.themeColor),
    [profile.player.tenant.themeColor],
  );

  const [tab, setTab] = useState<PlayerProfileTab>(initialTab);
  const [current, setCurrent] = useState(profile);
  const [loggingOut, setLoggingOut] = useState(false);
  const [toast, setToast] = useState<TranslationKey | null>(null);
  const [bonusBusy, setBonusBusy] = useState(false);
  const [bonusClaimed, setBonusClaimed] = useState(
    profile.dailyBonus.claimedToday,
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordErrorKey, setPasswordErrorKey] =
    useState<TranslationKey | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  // 客户端读取真实域名（服务端渲染时为空串），避免在 effect 里 setState。
  const origin = useSyncExternalStore(subscribeNoop, readBrowserOrigin, () => "");

  // router.refresh() 会带来新的 profile：按 React 官方「渲染期对齐 props」写法同步本地状态，
  // 这样既有乐观更新（setCurrent），又不需要在 effect 里同步 props。
  const [profileSnapshot, setProfileSnapshot] = useState(profile);

  if (profileSnapshot !== profile) {
    setProfileSnapshot(profile);
    setCurrent(profile);
    setBonusClaimed(profile.dailyBonus.claimedToday);
  }

  useEffect(() => {
    document.title = t("player.profile.documentTitle", {
      brand: resolveBrandName(current.player.tenant.name),
    });
  }, [current.player.tenant.name, t]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const referralLink = origin
    ? `${origin}/player/register?ref=${current.player.referralCode}&site=${current.player.tenant.id}`
    : `/player/register?ref=${current.player.referralCode}&site=${current.player.tenant.id}`;

  async function handleLogout() {
    setLoggingOut(true);

    try {
      await fetch("/api/player/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // 即使网络异常也离开页面：下一次请求会因 Cookie 失效回到登录页。
    } finally {
      router.replace("/");
      router.refresh();
    }
  }

  async function handleClaimBonus() {
    if (bonusBusy || bonusClaimed) {
      return;
    }

    setBonusBusy(true);

    try {
      const response = await fetch("/api/player/bonus", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await response.json().catch(() => ({}))) as {
        balance?: string;
        amount?: string;
        code?: string;
      };

      if (!response.ok) {
        setToast(playerErrorKey(data.code) ?? "player.error.generic");
        return;
      }

      setBonusClaimed(true);
      notifyPlayerWalletChanged({ balance: data.balance });
      setCurrent((prev) => {
        const nextBalance = data.balance ?? prev.summary.balance;

        return {
          ...prev,
          summary: {
            ...prev.summary,
            balance: nextBalance,
            // 奖励只是加钱，不产生在途提现单，可用余额按同口径重算
            availableBalance: availableBalanceToString(
              nextBalance,
              prev.summary.pendingWithdrawalAmount,
            ),
            totalRewards: addAmount(
              prev.summary.totalRewards,
              data.amount ?? prev.dailyBonus.amount,
            ),
          },
          dailyBonus: { ...prev.dailyBonus, claimedToday: true },
        };
      });
      setToast("player.wallet.bonusSuccess");
      router.refresh();
    } catch {
      setToast("common.networkError");
    } finally {
      setBonusBusy(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordErrorKey(null);

    const parsed = readPlayerPassword(newPassword);

    if (!currentPassword) {
      setPasswordErrorKey("player.error.currentPasswordInvalid");
      return;
    }

    if (!parsed) {
      setPasswordErrorKey("player.error.passwordInvalid");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordErrorKey("player.error.passwordMismatch");
      return;
    }

    setPasswordBusy(true);

    try {
      const response = await fetch("/api/player/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          currentPassword,
          newPassword: parsed,
          confirmPassword,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
      };

      if (!response.ok) {
        setPasswordErrorKey(
          playerErrorKey(data.code) ?? "player.error.generic",
        );
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setToast("player.security.passwordUpdated");
    } catch {
      setPasswordErrorKey("common.networkError");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function copyText(value: string, target: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setToast("player.referral.copyFailed");
    }
  }

  const summary = current.summary;
  // 租户记账货币：玩家中心所有金额（余额 / 统计 / 流水）都按它渲染符号，
  // 绝不再把 $ 写死。见 src/lib/currency.ts。
  const walletCurrency = normalizeCurrency(current.player.tenant.currency);
  const bonusAmount = formatCurrency(current.dailyBonus.amount, walletCurrency);
  const pendingWithdrawValue = Number(summary.pendingWithdrawalAmount);
  const hasPendingWithdraw =
    Number.isFinite(pendingWithdrawValue) && pendingWithdrawValue > 0;

  // 运营口径：顶部卡片只呈现正向数字。
  // 「今日输赢」= 今日派彩 - 今日下注，只有盈利时才显示金额（+RM xxx），
  // 亏损 / 打平一律显示 RM 0.00 —— 绝不让玩家在自己的中心页上看到亏损数字。
  const todayNet =
    Number(summary.todayPayout) - Number(summary.todayBetAmount);
  const todayProfit = Number.isFinite(todayNet) && todayNet > 0 ? todayNet : 0;
  const todayProfitValue =
    todayProfit > 0
      ? formatCurrency(todayProfit, walletCurrency, { signed: true })
      : formatCurrency(0, walletCurrency);

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#040404] font-sans text-neutral-200"
      style={theme.style}
      data-theme-color={theme.brand}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand/10 blur-[160px]" />
        <div className="absolute -right-40 top-10 h-[30rem] w-[30rem] rounded-full bg-fuchsia-600/10 blur-[160px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)] [-webkit-mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-brand/10 bg-[#050505]/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            {/* 顶栏品牌：Logo + 商户名（Tenant.name / logoUrl），不再写死平台名 */}
            <TenantBrandLockup
              brandName={current.player.tenant.name}
              logoUrl={current.player.tenant.logoUrl}
              size="md"
              tagline={t("player.profile.eyebrow")}
              taglineClassName="block"
            />
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden h-9 items-center rounded-full border border-white/[0.08] px-4 text-[11px] font-semibold text-neutral-400 transition-colors hover:border-brand/30 hover:text-brand-soft sm:inline-flex"
            >
              {t("player.profile.backToLobby")}
            </Link>
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="h-9 rounded-full border border-white/[0.08] px-4 text-[11px] font-semibold text-neutral-400 transition-colors hover:border-red-400/30 hover:text-red-300 disabled:opacity-60"
            >
              {loggingOut
                ? t("player.profile.loggingOut")
                : t("player.profile.logout")}
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.12] via-[#0a0a0a] to-[#050505] p-5 sm:p-7">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-soft to-transparent"
          />
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-brand-soft/80">
                {t("player.profile.eyebrow")}
              </p>
              <h1 className="mt-2 truncate text-2xl font-black text-neutral-50 sm:text-3xl">
                {t("player.profile.welcome", { name: current.player.username })}
              </h1>
              <p className="mt-1.5 text-xs leading-5 text-neutral-500">
                {t("player.profile.subtitle")}
              </p>
              <p className="mt-3 text-[10px] text-neutral-600">
                {t("player.profile.memberSince", {
                  date: formatDate(current.player.createdAt, locale),
                })}
                <span className="mx-2 text-neutral-700">·</span>
                {current.player.tenant.name}
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="rounded-xl border border-brand/25 bg-black/30 px-4 py-2.5 text-left sm:text-right">
                <p className="text-[9px] uppercase tracking-[0.22em] text-neutral-500">
                  {t("player.wallet.availableBalance")}
                </p>
                <p className="mt-0.5 font-mono text-2xl font-black tabular-nums text-brand-pale">
                  {formatCurrency(summary.availableBalance, walletCurrency)}
                </p>
                {hasPendingWithdraw ? (
                  <p className="mt-1 text-[9px] leading-4 text-neutral-500">
                    {t("player.wallet.pendingWithdrawHint", {
                      amount: formatCurrency(pendingWithdrawValue, walletCurrency),
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <PlayerDepositButton
                  playerName={current.player.username}
                  brandName={current.player.tenant.name}
                  onDeposited={(balance) => {
                    // 充值到账后广播余额：大厅顶栏（若已打开）立刻同步，不用等下一次拉取
                    notifyPlayerWalletChanged({ balance });
                    router.refresh();
                  }}
                />
                <PlayerWithdrawButton
                  balance={summary.balance}
                  pendingWithdrawalAmount={summary.pendingWithdrawalAmount}
                  currency={walletCurrency}
                  kycStatus={current.kyc.status}
                  accounts={current.withdrawalAccounts}
                  playerName={current.player.username}
                  brandName={current.player.tenant.name}
                  onWithdrawn={() => router.refresh()}
                  onManageAccounts={() => setTab("security")}
                />
              </div>
            </div>
          </div>
        </section>


        <nav className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
          {PLAYER_PROFILE_TABS.map((item) => {
            const active = tab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-pressed={active}
                className={`shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-gradient-to-r from-brand-soft via-brand to-brand-deep text-brand-ink shadow-[0_10px_24px_-14px_var(--sf-a95)]"
                    : "text-neutral-500 hover:text-brand-soft"
                }`}
              >
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="mt-5">
          {tab === "wallet" ? (
            <div className="space-y-5">
              <KycNotice kyc={current.kyc} />

              {/* 顶部激励卡：只保留正向数据（余额 / 奖励 / 今日盈利）。
                  累计充值、累计下注、累计派彩一律不展示 —— 玩家算不出「我亏了多少」。 */}
              <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
                <HighlightStatCard
                  label={t("player.wallet.availableBalance")}
                  value={formatCurrency(summary.availableBalance, walletCurrency)}
                  hint={
                    hasPendingWithdraw
                      ? t("player.wallet.pendingWithdrawHint", {
                          amount: formatCurrency(
                            pendingWithdrawValue,
                            walletCurrency,
                          ),
                        })
                      : t("player.wallet.balanceHint")
                  }
                  accent
                />
                <HighlightStatCard
                  label={t("player.wallet.totalRewards")}
                  value={formatCurrency(summary.totalRewards, walletCurrency)}
                  hint={t("player.wallet.rewardsHint")}
                />
                <HighlightStatCard
                  label={t("player.wallet.todayPl")}
                  value={todayProfitValue}
                  hint={
                    todayProfit > 0
                      ? t("player.wallet.todayPlUp")
                      : t("player.wallet.todayPlFlat")
                  }
                  positive={todayProfit > 0}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <SectionCard
                  title={t("player.wallet.dailyBonus")}
                  subtitle={t("player.wallet.dailyBonusHint", {
                    amount: bonusAmount,
                  })}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand/[0.06] px-4 py-3">
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.22em] text-neutral-500">
                        {t("player.wallet.dailyBonus")}
                      </p>
                      <p className="mt-0.5 font-mono text-xl font-bold tabular-nums text-brand-pale">
                        {formatCurrency(current.dailyBonus.amount, walletCurrency, {
                          signed: true,
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleClaimBonus()}
                      disabled={bonusBusy || bonusClaimed}
                      className="h-10 rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft px-4 text-xs font-bold text-brand-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bonusClaimed
                        ? t("player.wallet.bonusClaimed")
                        : bonusBusy
                          ? t("player.wallet.claimingBonus")
                          : t("player.wallet.claimBonus", { amount: bonusAmount })}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {summary.pendingDeposits > 0 ? (
                      <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] text-amber-300">
                        {t("player.wallet.pendingDeposits", {
                          count: summary.pendingDeposits,
                        })}
                      </span>
                    ) : null}
                    {summary.pendingWithdrawals > 0 ? (
                      <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-1 text-[10px] text-sky-300">
                        {t("player.wallet.pendingWithdrawals", {
                          count: summary.pendingWithdrawals,
                        })}
                      </span>
                    ) : null}
                    {summary.pendingDeposits === 0 &&
                    summary.pendingWithdrawals === 0 ? (
                      <span className="rounded-full border border-white/[0.06] px-2.5 py-1 text-[10px] text-neutral-600">
                        {t("player.wallet.noPending")}
                      </span>
                    ) : null}
                  </div>
                </SectionCard>

                <SectionCard
                  title={t("player.wallet.referralShortcut")}
                  subtitle={t("player.referral.rateValue", {
                    rate: current.referral.ratePercent,
                  })}
                >
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
                    <div>
                      <p className="font-mono text-lg font-bold tracking-[0.14em] text-brand-pale">
                        {current.player.referralCode}
                      </p>
                      <p className="mt-0.5 text-[10px] text-neutral-600">
                        {t("player.referral.invited")}:{" "}
                        {current.referral.invitedCount}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab("referral")}
                      className="h-9 rounded-lg border border-brand/30 px-3 text-[11px] font-semibold text-brand-soft transition-colors hover:bg-brand/10"
                    >
                      {t("player.profile.tabs.referral")}
                    </button>
                  </div>
                </SectionCard>
              </div>

              <SectionCard
                title={t("player.wallet.transactionsTitle")}
                subtitle={t("player.wallet.transactionsHint")}
              >
                <TableShell>
                  <thead>
                    <TableHeadRow>
                      <Th>{t("player.wallet.column.type")}</Th>
                      <Th>{t("player.wallet.column.amount")}</Th>
                      <Th>{t("player.wallet.column.status")}</Th>
                      <Th>{t("player.wallet.column.reference")}</Th>
                      <Th>{t("player.wallet.column.time")}</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {current.transactions.length === 0 ? (
                      <EmptyRow
                        colSpan={5}
                        text={t("player.wallet.emptyTransactions")}
                      />
                    ) : (
                      current.transactions.map((item) => {
                        const negative =
                          item.type === "withdraw" || item.type === "bet";

                        return (
                          <BodyRow key={item.id}>
                            <Td>
                              {labelFor(
                                TRANSACTION_TYPE_KEYS,
                                item.type,
                                t,
                              )}
                            </Td>
                            <Td mono>
                              <span
                                className={
                                  negative
                                    ? "text-red-300"
                                    : "text-emerald-300"
                                }
                              >
                                {formatCurrency(
                                  negative
                                    ? -Math.abs(Number(item.amount))
                                    : Math.abs(Number(item.amount)),
                                  item.currency,
                                  { signed: true },
                                )}
                              </span>
                            </Td>
                            <Td>
                              <StatusBadge status={item.status} />
                            </Td>
                            <Td mono>{item.txHash ?? "—"}</Td>
                            <Td>{formatDate(item.createdAt, locale)}</Td>
                          </BodyRow>
                        );
                      })
                    )}
                  </tbody>
                </TableShell>
              </SectionCard>

              <div className="grid gap-4 xl:grid-cols-2">
                <SectionCard title={t("player.wallet.depositsTitle")}>
                  <TableShell>
                    <thead>
                      <TableHeadRow>
                        <Th>{t("player.wallet.column.gateway")}</Th>
                        <Th>{t("player.wallet.column.amount")}</Th>
                        <Th>{t("player.wallet.column.status")}</Th>
                        <Th>{t("player.wallet.column.time")}</Th>
                      </TableHeadRow>
                    </thead>
                    <tbody>
                      {current.deposits.length === 0 ? (
                        <EmptyRow
                          colSpan={4}
                          text={t("player.wallet.emptyDeposits")}
                        />
                      ) : (
                        current.deposits.map((item) => (
                          <BodyRow key={item.id}>
                            <Td>{item.gatewayName}</Td>
                            <Td mono>
                              {formatCurrency(item.amount, item.currency)}
                            </Td>
                            <Td>
                              <StatusBadge status={item.status} />
                            </Td>
                            <Td>{formatDate(item.createdAt, locale)}</Td>
                          </BodyRow>
                        ))
                      )}
                    </tbody>
                  </TableShell>
                </SectionCard>

                <SectionCard title={t("player.wallet.withdrawalsTitle")}>
                  <TableShell>
                    <thead>
                      <TableHeadRow>
                        <Th>{t("player.wallet.column.wallet")}</Th>
                        <Th>{t("player.wallet.column.amount")}</Th>
                        <Th>{t("player.wallet.column.status")}</Th>
                        <Th>{t("player.wallet.column.time")}</Th>
                      </TableHeadRow>
                    </thead>
                    <tbody>
                      {current.withdrawals.length === 0 ? (
                        <EmptyRow
                          colSpan={4}
                          text={t("player.wallet.emptyWithdrawals")}
                        />
                      ) : (
                        current.withdrawals.map((item) => (
                          <BodyRow key={item.id}>
                            <Td mono>{shortValue(item.walletAddress)}</Td>
                            <Td mono>
                              {formatCurrency(item.amount, item.currency)}
                            </Td>
                            <Td>
                              <StatusBadge status={item.status} />
                            </Td>
                            <Td>{formatDate(item.createdAt, locale)}</Td>
                          </BodyRow>
                        ))
                      )}
                    </tbody>
                  </TableShell>
                </SectionCard>
              </div>
            </div>
          ) : null}

          {tab === "bonuses" ? (
            <PlayerBonusesPanel
              currency={walletCurrency}
              onClaimed={({ balance, amount }) => {
                // 红利到账：钱包余额 / 累计奖励立刻更新，同时广播给大厅顶栏等订阅方
                notifyPlayerWalletChanged({ balance });
                setCurrent((prev) => {
                  const nextBalance = balance ?? prev.summary.balance;

                  return {
                    ...prev,
                    summary: {
                      ...prev.summary,
                      balance: nextBalance,
                      // 红利只是加钱，不产生在途提现单，可用余额按同一口径重算
                      availableBalance: availableBalanceToString(
                        nextBalance,
                        prev.summary.pendingWithdrawalAmount,
                      ),
                      totalRewards: addAmount(prev.summary.totalRewards, amount),
                    },
                  };
                });
                router.refresh();
              }}
            />
          ) : null}

          {tab === "history" ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label={t("player.history.totalBets")}
                  value={formatCurrency(summary.totalBetAmount, walletCurrency)}
                />
                <StatCard
                  label={t("player.history.totalPayout")}
                  value={formatCurrency(summary.totalPayout, walletCurrency)}
                />
                <StatCard
                  label={t("player.history.totalDeposits")}
                  value={formatCurrency(summary.totalDeposits, walletCurrency)}
                />
                <StatCard
                  label={t("player.history.totalWithdrawals")}
                  value={formatCurrency(summary.totalWithdrawals, walletCurrency)}
                />
              </div>

              <SectionCard
                title={t("player.history.betsTitle")}
                subtitle={t("player.history.betsHint")}
              >
                <TableShell>
                  <thead>
                    <TableHeadRow>
                      <Th>{t("player.history.column.provider")}</Th>
                      <Th>{t("player.history.column.bet")}</Th>
                      <Th>{t("player.history.column.payout")}</Th>
                      <Th>{t("player.history.column.ggr")}</Th>
                      <Th>{t("player.history.column.status")}</Th>
                      <Th>{t("player.history.column.time")}</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {current.bets.length === 0 ? (
                      <EmptyRow
                        colSpan={6}
                        text={t("player.history.emptyBets")}
                      />
                    ) : (
                      current.bets.map((item) => (
                        <BodyRow key={item.id}>
                          <Td>{item.providerName}</Td>
                          <Td mono>
                            {formatCurrency(item.betAmount, item.currency)}
                          </Td>
                          <Td mono>
                            {formatCurrency(item.payoutAmount, item.currency)}
                          </Td>
                          <Td mono>
                            <span
                              className={
                                Number(item.ggrAmount) >= 0
                                  ? "text-red-300"
                                  : "text-emerald-300"
                              }
                            >
                              {formatCurrency(item.ggrAmount, item.currency)}
                            </span>
                          </Td>
                          <Td>
                            <StatusBadge status={item.status} />
                          </Td>
                          <Td>
                            {formatDate(
                              item.settledAt ?? item.createdAt,
                              locale,
                            )}
                          </Td>
                        </BodyRow>
                      ))
                    )}
                  </tbody>
                </TableShell>
              </SectionCard>

              <SectionCard
                title={t("player.history.paymentsTitle")}
                subtitle={t("player.history.paymentsHint")}
              >
                <TableShell>
                  <thead>
                    <TableHeadRow>
                      <Th>{t("player.wallet.column.type")}</Th>
                      <Th>{t("player.wallet.column.amount")}</Th>
                      <Th>{t("player.wallet.column.status")}</Th>
                      <Th>{t("player.wallet.column.time")}</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {[...current.deposits, ...current.withdrawals].length ===
                    0 ? (
                      <EmptyRow
                        colSpan={4}
                        text={t("player.history.emptyPayments")}
                      />
                    ) : (
                      current.deposits
                        .map((item) => ({
                          id: `deposit-${item.id}`,
                          type: "deposit",
                          amount: item.amount,
                          currency: item.currency,
                          status: item.status,
                          createdAt: item.createdAt,
                        }))
                        .concat(
                          current.withdrawals.map((item) => ({
                            id: `withdraw-${item.id}`,
                            type: "withdraw",
                            amount: item.amount,
                            currency: item.currency,
                            status: item.status,
                            createdAt: item.createdAt,
                          })),
                        )
                        .sort((left, right) =>
                          right.createdAt.localeCompare(left.createdAt),
                        )
                        .map((item) => (
                          <BodyRow key={item.id}>
                            <Td>
                              {labelFor(TRANSACTION_TYPE_KEYS, item.type, t)}
                            </Td>
                            <Td mono>
                              {formatCurrency(item.amount, item.currency)}
                            </Td>
                            <Td>
                              <StatusBadge status={item.status} />
                            </Td>
                            <Td>{formatDate(item.createdAt, locale)}</Td>
                          </BodyRow>
                        ))
                    )}
                  </tbody>
                </TableShell>
              </SectionCard>
            </div>
          ) : null}

          {tab === "security" ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <SectionCard
                title={t("player.security.accountTitle")}
                subtitle={t("player.security.accountHint")}
              >
                <dl className="space-y-2.5 text-xs">
                  <InfoRow
                    label={t("player.security.username")}
                    value={current.player.username}
                  />
                  <InfoRow
                    label={t("player.security.email")}
                    value={current.player.email ?? "—"}
                  />
                  <InfoRow
                    label={t("player.security.phone")}
                    value={current.player.phone ?? "—"}
                    mono
                  />
                  <InfoRow
                    label={t("player.security.referralCode")}
                    value={current.player.referralCode}
                    mono
                  />
                  <InfoRow
                    label={t("player.security.joinedAt")}
                    value={formatDate(current.player.createdAt, locale)}
                  />
                  <InfoRow
                    label={t("player.security.lastLogin")}
                    value={
                      current.player.lastLoginAt
                        ? formatDate(current.player.lastLoginAt, locale)
                        : "—"
                    }
                  />
                </dl>

                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={loggingOut}
                  className="mt-3 h-10 w-full rounded-xl border border-white/[0.08] text-xs font-semibold text-neutral-400 transition-colors hover:border-red-400/30 hover:text-red-300 disabled:opacity-60"
                >
                  {loggingOut
                    ? t("player.profile.loggingOut")
                    : t("player.security.logoutAll")}
                </button>
              </SectionCard>

              <div className="space-y-4">
                <SectionCard
                  title={t("player.kyc.profileTitle")}
                  subtitle={t("player.kyc.profileHint")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/[0.08] px-2.5 py-1 text-[10px] font-semibold text-brand-pale">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {labelFor(KYC_STATUS_KEYS, current.kyc.status, t)}
                    </span>
                    <Link
                      href="/player/kyc"
                      className="inline-flex h-8 items-center rounded-lg border border-brand/30 px-3 text-[10px] font-semibold text-brand-soft transition-colors hover:bg-brand/10"
                    >
                      {t("player.kyc.profileAction")}
                    </Link>
                  </div>
                  {current.kyc.rejectReason ? (
                    <p className="mt-2.5 rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 py-2 text-[10px] leading-4 text-red-200">
                      {t("player.kyc.rejectedReason")}：{current.kyc.rejectReason}
                    </p>
                  ) : null}
                </SectionCard>

                <SectionCard
                  title={t("player.security.withdrawalTitle")}
                  subtitle={t("player.security.withdrawalHint")}
                >
                  <PlayerWithdrawalAccounts
                    accounts={current.withdrawalAccounts}
                    currency={walletCurrency}
                    onChange={(nextAccounts) =>
                      setCurrent((prev) => ({
                        ...prev,
                        withdrawalAccounts: nextAccounts,
                      }))
                    }
                  />
                </SectionCard>

                <SectionCard
                  title={t("player.security.passwordTitle")}
                  subtitle={t("player.security.passwordHint")}
                >
                  <form onSubmit={handleChangePassword} className="space-y-3">
                    <PasswordField
                      label={t("player.security.currentPassword")}
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      autoComplete="current-password"
                    />
                    <PasswordField
                      label={t("player.security.newPassword")}
                      value={newPassword}
                      onChange={setNewPassword}
                      autoComplete="new-password"
                    />
                    <PasswordField
                      label={t("player.security.confirmPassword")}
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      autoComplete="new-password"
                    />
                    {passwordErrorKey ? (
                      <p className="text-[11px] text-red-300">
                        {t(passwordErrorKey)}
                      </p>
                    ) : null}
                    <p className="text-[10px] leading-4 text-neutral-600">
                      {t("player.security.passwordRules")}
                    </p>
                    <button
                      type="submit"
                      disabled={
                        passwordBusy ||
                        !currentPassword ||
                        !newPassword ||
                        !confirmPassword
                      }
                      className="h-10 w-full rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft text-xs font-bold text-brand-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {passwordBusy
                        ? t("player.security.saving")
                        : t("player.security.updatePassword")}
                    </button>
                  </form>
                </SectionCard>
              </div>
            </div>
          ) : null}

          {tab === "referral" ? (
            <div className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <SectionCard
                  title={t("player.referral.title")}
                  subtitle={t("player.referral.subtitle", {
                    rate: current.referral.ratePercent,
                  })}
                >
                  <div className="rounded-xl border border-brand/25 bg-brand/[0.06] p-4">
                    <p className="text-[9px] uppercase tracking-[0.24em] text-neutral-500">
                      {t("player.referral.code")}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <p className="font-mono text-2xl font-black tracking-[0.2em] text-brand-pale">
                        {current.referral.code}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(current.referral.code, "code")
                        }
                        className="h-8 rounded-lg border border-brand/30 px-3 text-[10px] font-semibold text-brand-soft transition-colors hover:bg-brand/10"
                      >
                        {copied === "code"
                          ? t("player.referral.copied")
                          : t("player.referral.copyCode")}
                      </button>
                    </div>

                    <p className="mt-4 text-[9px] uppercase tracking-[0.24em] text-neutral-500">
                      {t("player.referral.link")}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        readOnly
                        value={referralLink}
                        onFocus={(event) => event.currentTarget.select()}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 font-mono text-[10px] text-neutral-400 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void copyText(referralLink, "link")}
                        className="h-9 shrink-0 rounded-lg bg-gradient-to-r from-brand-deep via-brand to-brand-soft px-3 text-[10px] font-bold text-brand-ink"
                      >
                        {copied === "link"
                          ? t("player.referral.copied")
                          : t("player.referral.copyLink")}
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 text-[10px] leading-5 text-neutral-600">
                    {t("player.referral.rules", {
                      rate: current.referral.ratePercent,
                    })}
                  </p>
                </SectionCard>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard
                      label={t("player.referral.invited")}
                      value={String(current.referral.invitedCount)}
                      accent
                    />
                    <StatCard
                      label={t("player.referral.rewardCount")}
                      value={String(current.referral.rewardCount)}
                    />
                    <StatCard
                      label={t("player.referral.rewardTotal")}
                      value={formatCurrency(
                        current.referral.rewardTotal,
                        walletCurrency,
                      )}
                    />
                    <StatCard
                      label={t("player.referral.rate")}
                      value={`${current.referral.ratePercent}%`}
                    />
                  </div>

                  <SectionCard
                    title={t("player.wallet.dailyBonus")}
                    subtitle={t("player.wallet.dailyBonusHint", {
                      amount: bonusAmount,
                    })}
                  >
                    <button
                      type="button"
                      onClick={() => void handleClaimBonus()}
                      disabled={bonusBusy || bonusClaimed}
                      className="h-10 w-full rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft text-xs font-bold text-brand-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bonusClaimed
                        ? t("player.wallet.bonusClaimed")
                        : bonusBusy
                          ? t("player.wallet.claimingBonus")
                          : t("player.wallet.claimBonus", {
                              amount: bonusAmount,
                            })}
                    </button>
                  </SectionCard>
                </div>
              </div>

              <SectionCard
                title={t("player.referral.howTitle")}
                subtitle={t("player.referral.howHint")}
              >
                <ol className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      "player.referral.step1",
                      "player.referral.step2",
                      "player.referral.step3",
                    ] as TranslationKey[]
                  ).map((key, index) => (
                    <li
                      key={key}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/15 font-mono text-[10px] font-bold text-brand-soft">
                        {index + 1}
                      </span>
                      <p className="mt-2 text-[11px] leading-5 text-neutral-400">
                        {t(key)}
                      </p>
                    </li>
                  ))}
                </ol>
              </SectionCard>
            </div>
          ) : null}

        </div>
      </main>

      {toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 rounded-full border border-brand/30 bg-[#0a0a0a]/95 px-4 py-2 text-[11px] font-medium text-brand-pale shadow-[0_20px_50px_-20px_var(--sf-a95)] backdrop-blur"
        >
          {t(toast)}
        </div>
      ) : null}
    </div>
  );
}


function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3.5 py-3 ${
        accent
          ? "border-brand/30 bg-brand/[0.08]"
          : "border-white/[0.06] bg-white/[0.02]"
      }`}
    >
      <p className="truncate text-[9px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-1 truncate font-mono text-lg font-bold tabular-nums ${
          accent ? "text-brand-pale" : "text-neutral-200"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * 玩家中心顶部的「激励型」数据卡：比 StatCard 更大、居中均匀排布。
 *
 * 运营规则：这里只放正向数字（余额 / 累计奖励 / 今日盈利），
 * 累计充值、累计下注、累计派彩这类能让玩家算出总亏损的指标一律不出现；
 * 今日输赢亏损时调用方传 `$0.00`，卡片保持中性色，不给负面暗示。
 */
function HighlightStatCard({
  label,
  value,
  hint,
  accent = false,
  positive = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  positive?: boolean;
}) {
  const tone = accent
    ? "border-brand/30 bg-gradient-to-br from-brand/[0.14] via-brand/[0.05] to-transparent"
    : positive
      ? "border-emerald-400/25 bg-emerald-400/[0.08]"
      : "border-white/[0.07] bg-white/[0.03]";

  const valueTone = accent
    ? "text-brand-pale"
    : positive
      ? "text-emerald-300"
      : "text-neutral-200";

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border px-5 py-6 text-center sm:px-6 sm:py-7 ${tone}`}
    >
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-2 truncate font-mono text-2xl font-black tabular-nums sm:text-3xl ${valueTone}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 truncate text-[10px] text-neutral-600">{hint}</p>
      ) : null}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-[#080808]/80 p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-neutral-100">{title}</h2>
        {subtitle ? (
          <p className="text-[10px] text-neutral-600">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.05]">
      <table className="w-full min-w-[560px] border-collapse text-left text-[11px]">
        {children}
      </table>
    </div>
  );
}

function TableHeadRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-500">
      {children}
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-3 py-2 font-semibold">{children}</th>
  );
}

function BodyRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
      {children}
    </tr>
  );
}

function Td({
  children,
  mono = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 ${
        mono ? "font-mono tabular-nums" : ""
      } text-neutral-400`}
    >
      {children}
    </td>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-3 py-8 text-center text-[11px] text-neutral-600"
      >
        {text}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const tone =
    status === "failed" || status === "rejected" || status === "cancelled"
      ? "border-red-400/25 bg-red-400/10 text-red-300"
      : status === "pending" || status === "processing" || status === "open"
        ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
        : "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold ${tone}`}
    >
      {labelFor(STATUS_KEYS, status, t)}
    </span>
  );
}

function labelFor(
  map: Record<string, TranslationKey>,
  value: string,
  t: (key: TranslationKey) => string,
) {
  const key = map[value];

  return key ? t(key) : value;
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2 last:border-0 last:pb-0">
      <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
        {label}
      </dt>
      <dd
        className={`truncate text-right text-neutral-300 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
        {label}
      </span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        className={INPUT_CLASS}
      />
    </label>
  );
}
