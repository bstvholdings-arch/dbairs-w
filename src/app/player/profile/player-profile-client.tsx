"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/components/LanguageProvider";
import { PlayerDepositButton } from "@/components/player-deposit-button";
import { formatAmount, formatDate } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n-types";
import { playerErrorKey } from "@/lib/player-errors";
import type { PlayerProfileData } from "@/lib/player-profile";
import {
  readPlayerPassword,
  readPlayerWalletAddress,
} from "@/lib/player-validation";
import { buildStorefrontTheme } from "@/lib/storefront";

export type PlayerProfileTab = "wallet" | "history" | "security" | "referral";

export const PLAYER_PROFILE_TABS: {
  id: PlayerProfileTab;
  labelKey: TranslationKey;
}[] = [
  { id: "wallet", labelKey: "player.profile.tabs.wallet" },
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
  const [walletInput, setWalletInput] = useState(
    profile.player.walletAddress ?? "",
  );
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletErrorKey, setWalletErrorKey] = useState<TranslationKey | null>(
    null,
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordErrorKey, setPasswordErrorKey] =
    useState<TranslationKey | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    setCurrent(profile);
    setBonusClaimed(profile.dailyBonus.claimedToday);
    setWalletInput(profile.player.walletAddress ?? "");
  }, [profile]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    document.title = t("player.profile.documentTitle");
  }, [t]);

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
      setCurrent((prev) => ({
        ...prev,
        summary: {
          ...prev.summary,
          balance: data.balance ?? prev.summary.balance,
          totalRewards: addAmount(
            prev.summary.totalRewards,
            data.amount ?? prev.dailyBonus.amount,
          ),
        },
        dailyBonus: { ...prev.dailyBonus, claimedToday: true },
      }));
      setToast("player.wallet.bonusSuccess");
      router.refresh();
    } catch {
      setToast("common.networkError");
    } finally {
      setBonusBusy(false);
    }
  }

  async function handleSaveWallet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWalletErrorKey(null);

    const raw = walletInput.trim();
    const parsed = raw ? readPlayerWalletAddress(raw) : "";

    if (raw && !parsed) {
      setWalletErrorKey("player.error.walletInvalid");
      return;
    }

    setWalletBusy(true);

    try {
      const response = await fetch("/api/player/wallet", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ walletAddress: parsed }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        walletAddress?: string | null;
        code?: string;
      };

      if (!response.ok) {
        setWalletErrorKey(playerErrorKey(data.code) ?? "player.error.generic");
        return;
      }

      const nextWallet = data.walletAddress ?? null;
      setCurrent((prev) => ({
        ...prev,
        player: { ...prev.player, walletAddress: nextWallet },
      }));
      setWalletInput(nextWallet ?? "");
      setToast(
        nextWallet
          ? "player.security.walletSaved"
          : "player.security.walletRemoved",
      );
      router.refresh();
    } catch {
      setWalletErrorKey("common.networkError");
    } finally {
      setWalletBusy(false);
    }
  }

  async function handleUnbindWallet() {
    if (!window.confirm(t("player.security.removeWalletConfirm"))) {
      return;
    }

    setWalletInput("");
    setWalletErrorKey(null);
    setWalletBusy(true);

    try {
      const response = await fetch("/api/player/wallet", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ walletAddress: "" }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
      };

      if (!response.ok) {
        setWalletErrorKey(playerErrorKey(data.code) ?? "player.error.generic");
        return;
      }

      setCurrent((prev) => ({
        ...prev,
        player: { ...prev.player, walletAddress: null },
      }));
      setToast("player.security.walletRemoved");
      router.refresh();
    } catch {
      setWalletErrorKey("common.networkError");
    } finally {
      setWalletBusy(false);
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
  const bonusAmount = formatAmount(current.dailyBonus.amount);

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
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-pale via-brand to-brand-deep text-[11px] font-black tracking-tight text-brand-ink shadow-[0_0_28px_-8px_var(--sf-a95)]">
              DB
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/30"
              />
            </span>
            <span className="leading-none">
              <span className="block bg-gradient-to-r from-brand-pale via-brand-soft to-brand-deep bg-clip-text text-[15px] font-black tracking-[0.24em] text-transparent">
                DB AIRS
              </span>
              <span className="mt-1.5 block text-[8px] uppercase tracking-[0.34em] text-neutral-600">
                {t("player.profile.eyebrow")}
              </span>
            </span>
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
                  {t("player.wallet.currentBalance")}
                </p>
                <p className="mt-0.5 font-mono text-2xl font-black tabular-nums text-brand-pale">
                  ${formatAmount(summary.balance)}
                </p>
              </div>
              <PlayerDepositButton
                playerName={current.player.username}
                onDeposited={() => router.refresh()}
              />
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  label={t("player.wallet.currentBalance")}
                  value={`$${formatAmount(summary.balance)}`}
                  accent
                />
                <StatCard
                  label={t("player.wallet.totalDeposits")}
                  value={`$${formatAmount(summary.totalDeposits)}`}
                />
                <StatCard
                  label={t("player.wallet.totalWithdrawals")}
                  value={`$${formatAmount(summary.totalWithdrawals)}`}
                />
                <StatCard
                  label={t("player.wallet.totalRewards")}
                  value={`$${formatAmount(summary.totalRewards)}`}
                />
                <StatCard
                  label={t("player.wallet.totalBets")}
                  value={`$${formatAmount(summary.totalBetAmount)}`}
                />
                <StatCard
                  label={t("player.wallet.totalPayout")}
                  value={`$${formatAmount(summary.totalPayout)}`}
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
                        +{bonusAmount} USDT
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
                                {negative ? "-" : "+"}$
                                {formatAmount(item.amount)}
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
                            <Td mono>${formatAmount(item.amount)}</Td>
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
                            <Td mono>${formatAmount(item.amount)}</Td>
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

          {tab === "history" ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label={t("player.history.totalBets")}
                  value={`$${formatAmount(summary.totalBetAmount)}`}
                />
                <StatCard
                  label={t("player.history.totalPayout")}
                  value={`$${formatAmount(summary.totalPayout)}`}
                />
                <StatCard
                  label={t("player.history.totalDeposits")}
                  value={`$${formatAmount(summary.totalDeposits)}`}
                />
                <StatCard
                  label={t("player.history.totalWithdrawals")}
                  value={`$${formatAmount(summary.totalWithdrawals)}`}
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
                          <Td mono>${formatAmount(item.betAmount)}</Td>
                          <Td mono>${formatAmount(item.payoutAmount)}</Td>
                          <Td mono>
                            <span
                              className={
                                Number(item.ggrAmount) >= 0
                                  ? "text-red-300"
                                  : "text-emerald-300"
                              }
                            >
                              ${formatAmount(item.ggrAmount)}
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
                          status: item.status,
                          createdAt: item.createdAt,
                        }))
                        .concat(
                          current.withdrawals.map((item) => ({
                            id: `withdraw-${item.id}`,
                            type: "withdraw",
                            amount: item.amount,
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
                            <Td mono>${formatAmount(item.amount)}</Td>
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

                <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="text-[11px] font-semibold text-neutral-300">
                    {t("player.security.boundWallet")}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-brand-soft">
                    {current.player.walletAddress ??
                      t("player.security.noWallet")}
                  </p>
                  {current.player.walletAddress ? (
                    <button
                      type="button"
                      onClick={() => void handleUnbindWallet()}
                      disabled={walletBusy}
                      className="mt-2.5 h-8 rounded-lg border border-red-400/25 px-3 text-[10px] font-semibold text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-60"
                    >
                      {t("player.security.removeWallet")}
                    </button>
                  ) : null}
                </div>

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
                  title={t("player.security.walletTitle")}
                  subtitle={t("player.security.walletHint")}
                >
                  <form onSubmit={handleSaveWallet} className="space-y-3">
                    <label className="block">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                        {t("player.security.walletLabel")}
                      </span>
                      <input
                        type="text"
                        value={walletInput}
                        onChange={(event) =>
                          setWalletInput(event.target.value)
                        }
                        placeholder="TRC20 / ERC20 / BEP20"
                        autoComplete="off"
                        spellCheck={false}
                        className={INPUT_CLASS}
                      />
                    </label>
                    {walletErrorKey ? (
                      <p className="text-[11px] text-red-300">
                        {t(walletErrorKey)}
                      </p>
                    ) : null}
                    <button
                      type="submit"
                      disabled={walletBusy}
                      className="h-10 w-full rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft text-xs font-bold text-brand-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {walletBusy
                        ? t("player.security.saving")
                        : t("player.security.saveWallet")}
                    </button>
                  </form>
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
                      value={`$${formatAmount(current.referral.rewardTotal)}`}
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
