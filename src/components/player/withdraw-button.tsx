"use client";

import Link from "next/link";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { PlayerWithdrawModal } from "@/components/player/withdraw-modal";
import { formatCurrency, normalizeCurrency } from "@/lib/currency";
import type { PlayerWithdrawalAccountView } from "@/lib/withdrawal-accounts";

/** 与服务端 WITHDRAWAL_MIN_AMOUNT 的默认值保持一致，仅用于按钮高亮 / 置灰判断。 */
const DEFAULT_MIN_WITHDRAW_AMOUNT = 10;

/**
 * 玩家中心的【提现】按钮。
 *
 * 状态三态（服务端始终是最终口径，这里只做体验层的前置提示）：
 * - 未通过 KYC      → 按钮可点，点击弹出「请先完成实名认证」并给去认证入口；
 * - 可用余额 < 最低额 → 按钮可点，点击说明最低提现金额；
 * - 已实名且余额够   → 金色高亮，点击打开黑金提现弹窗。
 *
 * tooltip（title）与服务端错误文案同源，鼠标悬停即可看到被拦的原因。
 */
export function PlayerWithdrawButton({
  balance,
  pendingWithdrawalAmount,
  currency,
  kycStatus,
  accounts,
  playerName,
  onWithdrawn,
  onManageAccounts,
  className,
}: {
  balance: string;
  /** 处理中的提现单金额合计（pending 阶段不扣余额，所以要单独扣） */
  pendingWithdrawalAmount: string;
  /** 租户记账货币（Tenant.currency）：金额符号按它渲染，不写死 $ */
  currency: string;
  kycStatus: string;
  accounts: PlayerWithdrawalAccountView[];
  playerName: string;
  onWithdrawn: () => void;
  /** 点「去绑定提现账号」时由玩家中心切换到安全 Tab */
  onManageAccounts: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const [view, setView] = useState<"closed" | "notice" | "form">("closed");
  const walletCurrency = normalizeCurrency(currency);

  const balanceValue = Number(balance);
  const pendingValue = Number(pendingWithdrawalAmount);
  const availableBalance = Math.max(
    0,
    (Number.isFinite(balanceValue) ? balanceValue : 0) -
      (Number.isFinite(pendingValue) ? pendingValue : 0),
  );

  const minAmountLabel = formatCurrency(DEFAULT_MIN_WITHDRAW_AMOUNT, walletCurrency);
  const kycApproved = kycStatus === "APPROVED";
  const enoughBalance = availableBalance >= DEFAULT_MIN_WITHDRAW_AMOUNT;
  const eligible = kycApproved && enoughBalance;

  const blockedReason = !kycApproved
    ? t("player.withdraw.kycRequired")
    : !enoughBalance
      ? t("player.withdraw.belowMinimum", {
          min: minAmountLabel,
        })
      : "";

  const buttonClass = eligible
    ? "inline-flex h-10 items-center justify-center rounded-xl border border-[#d4af37]/60 bg-[#0b0b0b] px-5 text-xs font-bold text-[#f0d27c] shadow-[0_10px_30px_-14px_rgba(212,175,55,0.8)] transition-colors hover:border-[#f0d27c] hover:bg-[#d4af37]/10"
    : "inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-5 text-xs font-semibold text-neutral-500 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-300";

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        aria-disabled={!eligible}
        title={blockedReason || t("player.withdraw.title")}
        onClick={() => setView(eligible ? "form" : "notice")}
        className={className ?? buttonClass}
      >
        {t("player.withdraw.action")}
      </button>

      {view === "notice" ? (
        <WithdrawNotice
          kycApproved={kycApproved}
          availableBalance={availableBalance}
          currency={walletCurrency}
          onClose={() => setView("closed")}
        />
      ) : null}

      {view === "form" ? (
        <PlayerWithdrawModal
          balance={balance}
          pendingWithdrawalAmount={pendingWithdrawalAmount}
          walletCurrency={walletCurrency}
          accounts={accounts}
          playerName={playerName}
          onClose={() => setView("closed")}
          onSubmitted={() => onWithdrawn()}
          onManageAccounts={() => {
            setView("closed");
            onManageAccounts();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 前置条件不满足时的轻量提示弹窗：只解释原因 + 给下一步动作，不提供任何提单入口。
 */
function WithdrawNotice({
  kycApproved,
  availableBalance,
  currency,
  onClose,
}: {
  kycApproved: boolean;
  availableBalance: number;
  currency: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label={t("player.withdraw.noticeTitle")}
        className="w-full max-w-sm rounded-2xl border border-[#d4af37]/25 bg-[#080808] px-5 py-6 text-center shadow-[0_30px_120px_-25px_rgba(212,175,55,0.45)]"
      >
        <span
          aria-hidden="true"
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 text-lg text-[#f0d27c]"
        >
          !
        </span>
        <h2 className="mt-3 text-sm font-semibold text-[#f0d27c]">
          {t("player.withdraw.noticeTitle")}
        </h2>
        <p className="mt-2 text-[11px] leading-5 text-neutral-300">
          {kycApproved
            ? t("player.withdraw.belowMinimum", {
                min: formatCurrency(DEFAULT_MIN_WITHDRAW_AMOUNT, currency),
              })
            : t("player.withdraw.kycRequired")}
        </p>
        <p className="mt-1.5 text-[10px] leading-5 text-neutral-500">
          {kycApproved
            ? `${t("player.withdraw.availableLabel")}: ${formatCurrency(availableBalance, currency)}`
            : t("player.withdraw.kycHint")}
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {kycApproved ? null : (
            <Link
              href="/player/kyc"
              className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] transition-opacity hover:opacity-90"
            >
              {t("player.withdraw.verifyNow")}
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-white/10 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
          >
            {t("common.close")}
          </button>
        </div>
      </section>
    </div>
  );
}
