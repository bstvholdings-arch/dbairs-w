"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { resolveBrandName } from "@/lib/brand";
import { formatCurrency, formatDisplayAmount } from "@/lib/currency";
import { formatGatewayRatePercent } from "@/lib/payment-gateway-rates";
import { playerErrorKey } from "@/lib/player-errors";
import { notifyPlayerWalletChanged } from "@/lib/player-wallet-events";
import type { PlayerWithdrawalAccountView } from "@/lib/withdrawal-accounts";
import {
  calculateWithdrawalFee,
  calculateWithdrawalReceive,
  isFiatPayoutAccount,
  normalizePayoutCurrency,
  roundPayoutAmount,
} from "@/lib/withdrawal-channels";

/**
 * 玩家中心黑金风提现弹窗（纯法币 MYR → MYR）。
 *
 * 三段式：选提现通道 → 选收款银行账号 → 填提现金额（含预估手续费 / 预计到账）。
 * - 通道列表来自 GET /api/player/withdrawal-gateways：只下发「本站记账币种 + 非加密」
 *   的法币通道，费率（feeRate）由后台按通道维护，前端一个数字都不写死；
 * - 收款账号只列玩家已绑定、且 accountType=bank / 币种与本站记账币种一致的账号，
 *   提交时只传 accountId，真实银行账号由服务端自己取（前端拿到的是掩码，回传也不可信）；
 * - 提现金额 / 手续费 / 到账金额单位全部是本站记账货币（MYR），全程不做汇率换算；
 * - 提交走 POST /api/withdrawal/create，生成 PENDING 单；
 *   余额在代付成功回调时才扣减，弹窗里如实提示，不做「已扣款」的假象。
 */

/** 后台配置的一条纯法币提现通道（费率后台可调，前端只负责渲染） */
export type PlayerWithdrawGatewayOption = {
  id: string;
  name: string;
  providerType: string;
  /** 已归一化的通道币种，与本站记账币种一致（MYR） */
  currency: string;
  /** 通道代付费率，0.01 = 1%；只用于展示预估手续费，不参与任何汇率换算 */
  feeRate: string;
};

type AmountLimits = { min: string; max: string };

type GatewayListResponse = {
  success?: boolean;
  /** 本站记账货币 = 等值出款币种（例如 MYR） */
  payoutCurrency?: string;
  gateways?: PlayerWithdrawGatewayOption[];
  amountLimits?: AmountLimits;
  error?: string;
};

type CreateWithdrawalResponse = {
  success?: boolean;
  withdrawal?: {
    id: string;
    amount: string;
    currency: string;
    status: string;
    walletAddress: string;
    gatewayName: string;
    requiredApprovals: number;
    createdAt: string;
  };
  balanceDeducted?: boolean;
  availableBalance?: string;
  error?: string;
  code?: string;
};

/** 服务端默认区间（WITHDRAWAL_MIN_AMOUNT / WITHDRAWAL_MAX_AMOUNT），仅作首屏占位。 */
const DEFAULT_AMOUNT_LIMITS: AmountLimits = { min: "10", max: "1000000" };
/**
 * 提现金额输入：法币只到「分」，最多两位小数。
 *
 * 服务端 parseWithdrawalAmount 仍兼容 6 位小数（历史数据 / 兼容旧调用方），
 * 但前端从严：MYR 分位以下的金额没有意义，一旦允许输入，
 * 手续费 / 到账金额就会和玩家填的数字对不上。
 */
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

/**
 * 提现金额 / 手续费 / 到账金额的展示：法币固定两位小数（RM 1.50）。
 * 余额（当前余额 / 可提余额 / 在途金额）走 formatDisplayAmount，同一口径。
 */
function formatMoney(value: number, currency: string) {
  return formatCurrency(value, currency);
}

/**
 * 提现账号下拉文案（纯法币）：`Maybank (1234) · TAN AH KOW`。
 *
 * accountNumber 是服务端掩码后的 `****1234`，这里只取后 4 位放进括号：
 * 既不暴露完整账号，又能让玩家一眼认出是哪张卡。
 */
function accountLabel(account: PlayerWithdrawalAccountView) {
  const bank = (account.bankName ?? "").trim() || "—";
  const tail = (account.accountNumber ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .slice(-4);
  const holder = (account.accountName ?? "").trim();

  return [tail ? `${bank} (${tail})` : bank, holder]
    .filter((part) => part.length > 0)
    .join(" · ");
}

export function PlayerWithdrawModal({
  balance,
  pendingWithdrawalAmount,
  walletCurrency,
  accounts,
  playerName,
  brandName,
  onClose,
  onSubmitted,
  onManageAccounts,
}: {
  balance: string;
  /** 处理中的提现单金额合计：可用余额 = balance - 这一笔 */
  pendingWithdrawalAmount: string;
  /** 租户记账货币（Tenant.currency）：余额 / 在途金额的符号按它渲染，不写死 $ */
  walletCurrency: string;
  accounts: PlayerWithdrawalAccountView[];
  playerName: string;
  /** 商户品牌名（Tenant.name）：只用于弹窗页脚署名，缺省回退平台名 */
  brandName?: string;
  onClose: () => void;
  onSubmitted: (availableBalance?: string | null) => void;
  onManageAccounts: () => void;
}) {
  const { t } = useLanguage();

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [gateways, setGateways] = useState<PlayerWithdrawGatewayOption[]>([]);
  const [limits, setLimits] = useState<AmountLimits>(DEFAULT_AMOUNT_LIMITS);
  /** 等值出款币种 = 本站记账货币（MYR）：金额 / 手续费 / 到账全部按它渲染 */
  const [payoutCurrency, setPayoutCurrency] = useState(() =>
    normalizePayoutCurrency(walletCurrency),
  );
  const [gatewayId, setGatewayId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{
    id: string;
    amount: string;
    currency: string;
    /** 服务端回写的收款账号描述（银行名 · 掩码账号 · 持有人） */
    account: string;
  } | null>(null);

  const pendingValue = Number(pendingWithdrawalAmount);
  const availableBalance = Math.max(
    0,
    roundPayoutAmount(
      Number(balance) - (Number.isFinite(pendingValue) ? pendingValue : 0),
    ),
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/player/withdrawal-gateways", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const data: GatewayListResponse = await response
          .json()
          .catch(() => ({}) as GatewayListResponse);

        if (!active) {
          return;
        }

        if (!response.ok) {
          setStatus("error");
          setLoadError(
            data.error ||
              (response.status === 401
                ? t("player.deposit.loginRequired")
                : t("player.withdraw.loadFailed")),
          );
          return;
        }

        const available = data.gateways ?? [];

        if (available.length === 0) {
          setStatus("error");
          setLoadError(t("player.withdraw.noGateways"));
          return;
        }

        if (data.amountLimits) {
          setLimits(data.amountLimits);
        }

        // 服务端下发的是「本站记账币种」（= 出款币种），缺省回落到会话里的记账货币
        const payout = normalizePayoutCurrency(
          data.payoutCurrency ?? walletCurrency,
        );
        const first = available[0];
        const preferredAccount =
          accounts.find(
            (item) => isFiatPayoutAccount(item, payout) && item.isDefault,
          ) ?? accounts.find((item) => isFiatPayoutAccount(item, payout));

        setPayoutCurrency(payout);
        setGateways(available);
        setGatewayId(first.id);
        setAccountId(preferredAccount?.id ?? "");
        setStatus("ready");
      } catch {
        if (!active || controller.signal.aborted) {
          return;
        }

        setStatus("error");
        setLoadError(t("common.networkError"));
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [accounts, t, walletCurrency]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const selectedGateway = useMemo(
    () => gateways.find((item) => item.id === gatewayId) ?? null,
    [gateways, gatewayId],
  );
  /**
   * 可用的收款账号：只认「银行账号（accountType=bank）+ 本站记账币种」。
   * 全部通道币种都等于本站记账币种，所以换通道不需要换账号，这里不依赖 selectedGateway。
   */
  const matchingAccounts = useMemo(
    () => accounts.filter((item) => isFiatPayoutAccount(item, payoutCurrency)),
    [accounts, payoutCurrency],
  );

  const amountValue = Number(amount);
  const safeAmount =
    Number.isFinite(amountValue) && amountValue > 0 ? amountValue : 0;
  /** 通道费率（后台维护的 PaymentGateway.payoutSellRate），0.01 = 1% */
  const feeRateValue = Number(selectedGateway?.feeRate ?? 0);
  /**
   * 纯马币结算（MYR → MYR），三步全部在同一币种内完成，没有任何汇率换算：
   *   手续费   = 提现金额 × 通道费率（四舍五入到分）
   *   预计到账 = 提现金额 − 手续费
   * 三个数字的单位都是 payoutCurrency（MYR）。
   */
  const feeValue = calculateWithdrawalFee(safeAmount, feeRateValue);
  const receiveValue = calculateWithdrawalReceive(safeAmount, feeRateValue);

  function handleGatewayChange(nextId: string) {
    setGatewayId(nextId);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedGateway) {
      setError(t("player.withdraw.channelPlaceholder"));
      return;
    }

    if (!accountId) {
      setError(t("player.withdraw.walletPlaceholder"));
      return;
    }

    const trimmed = amount.trim();

    if (!trimmed) {
      setError(t("player.withdraw.amountRequired"));
      return;
    }

    if (!AMOUNT_PATTERN.test(trimmed)) {
      setError(t("player.withdraw.amountFormat"));
      return;
    }

    const value = Number(trimmed);

    if (value < Number(limits.min)) {
      setError(t("player.withdraw.amountTooSmall", { min: limits.min }));
      return;
    }

    if (value > Number(limits.max)) {
      setError(t("player.withdraw.amountTooLarge", { max: limits.max }));
      return;
    }

    if (value > availableBalance) {
      setError(t("player.withdraw.amountOverBalance"));
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/withdrawal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          gatewayId: selectedGateway.id,
          accountId,
          amount: trimmed,
        }),
      });
      const data: CreateWithdrawalResponse = await response
        .json()
        .catch(() => ({}) as CreateWithdrawalResponse);

      if (!response.ok || !data.success || !data.withdrawal) {
        const key = playerErrorKey(data.code);
        setError(key ? t(key) : data.error || t("player.withdraw.createFailed"));
        return;
      }

      setSubmitted({
        id: data.withdrawal.id,
        amount: data.withdrawal.amount,
        currency: payoutCurrency,
        account: data.withdrawal.walletAddress,
      });
      // 广播钱包变更：带上服务端算好的可用余额，大厅顶栏等展示余额的组件
      // 立刻重绘（再自行重新拉 /api/player/me 校准）。
      // 注意传的是 availableBalance 而不是 balance：提现 pending 不扣 Player.balance，
      // 传成 balance 会让订阅方再减一次在途提现，数字被扣两遍。
      notifyPlayerWalletChanged({ availableBalance: data.availableBalance });
      onSubmitted(data.availableBalance ?? null);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  const errorBanner = error ? (
    <div
      aria-live="polite"
      className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3.5 py-2.5 text-[11px] leading-5 text-red-300"
    >
      {error}
    </div>
  ) : null;

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
        role="dialog"
        aria-modal="true"
        aria-label={t("player.withdraw.title")}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#d4af37]/25 bg-[#080808] shadow-[0_30px_120px_-25px_rgba(212,175,55,0.45)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#d4af37]/10 bg-[radial-gradient(circle_at_top_left,rgba(212,175,55,0.16),transparent_60%)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-[#f0d27c]">
              {t("player.withdraw.title")}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-neutral-500">
              {t("player.withdraw.subtitle")}
            </p>
            {playerName ? (
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {playerName}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {!submitted && status === "loading" ? (
            <div className="py-10 text-center">
              <span
                aria-hidden="true"
                className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[#d4af37]/25 border-t-[#f0d27c]"
              />
              <p className="mt-4 text-xs text-neutral-400">
                {t("player.withdraw.loading")}
              </p>
            </div>
          ) : !submitted && status === "error" ? (
            <div className="py-6 text-center">
              <span
                aria-hidden="true"
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-red-400/30 bg-red-400/10 text-lg text-red-300"
              >
                !
              </span>
              <p className="mt-3 text-xs leading-5 text-neutral-300">
                {loadError}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border border-white/10 px-4 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
              >
                {t("common.close")}
              </button>
            </div>
          ) : submitted ? (
            <div className="py-4 text-center">
              <span
                aria-hidden="true"
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 text-xl text-[#f0d27c]"
              >
                ✓
              </span>
              <p className="mt-3 text-sm font-semibold text-[#f0d27c]">
                {t("player.withdraw.successTitle")}
              </p>
              <p className="mt-2 font-mono text-xl font-black tabular-nums text-neutral-100">
                {formatMoney(Number(submitted.amount), submitted.currency)}
              </p>
              <p className="mt-2 break-all text-[10px] leading-5 text-neutral-500">
                {t("player.withdraw.successAccount")} · {submitted.account}
              </p>
              <p className="mt-2 text-[11px] leading-5 text-neutral-400">
                {t("player.withdraw.successHint", {
                  id: submitted.id.slice(0, 8).toUpperCase(),
                })}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 h-10 w-full rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] transition-opacity hover:opacity-90"
              >
                {t("player.withdraw.successClose")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="pb-1">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-3.5 py-3">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.18em] text-neutral-500">
                    {t("player.withdraw.balanceLabel")}
                  </p>
                  <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-neutral-200">
                    {formatDisplayAmount(balance, walletCurrency)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] uppercase tracking-[0.18em] text-neutral-500">
                    {t("player.withdraw.availableLabel")}
                  </p>
                  <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#f0d27c]">
                    {formatDisplayAmount(availableBalance, walletCurrency)}
                  </p>
                </div>
                {pendingValue > 0 ? (
                  <p className="col-span-2 mt-1 text-[10px] leading-4 text-neutral-500">
                    {t("player.withdraw.pendingHint", {
                      amount: formatDisplayAmount(pendingValue, walletCurrency),
                    })}
                  </p>
                ) : null}
              </div>

              <label className="mt-4 block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("player.withdraw.channelLabel")}
                </span>
                <select
                  value={gatewayId}
                  onChange={(event) => handleGatewayChange(event.target.value)}
                  className={inputClass}
                >
                  {gateways.map((item) => (
                    <option key={item.id} value={item.id} className="bg-[#0a0a0a]">
                      {item.name} ·{" "}
                      {t("player.withdraw.channelFee", {
                        rate: formatGatewayRatePercent(item.feeRate, 2),
                      })}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-4">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("player.withdraw.walletLabel")}
                </span>
                {matchingAccounts.length > 0 ? (
                  <select
                    value={accountId}
                    onChange={(event) => {
                      setAccountId(event.target.value);
                      setError("");
                    }}
                    className={inputClass}
                  >
                    {matchingAccounts.map((account) => (
                      <option
                        key={account.id}
                        value={account.id}
                        className="bg-[#0a0a0a]"
                      >
                        {accountLabel(account)}
                        {account.isDefault
                          ? ` · ${t("player.withdraw.defaultTag")}`
                          : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="mt-1.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3.5 py-3">
                    <p className="text-[11px] leading-5 text-amber-200">
                      {t("player.withdraw.walletEmpty", {
                        currency: payoutCurrency,
                      })}
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                      {t("player.withdraw.walletEmptyHint")}
                    </p>
                    <button
                      type="button"
                      onClick={onManageAccounts}
                      className="mt-2.5 inline-flex h-8 items-center rounded-lg border border-[#d4af37]/40 px-3 text-[10px] font-semibold text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
                    >
                      {t("player.withdraw.bindWallet")}
                    </button>
                  </div>
                )}
              </div>

              <label className="mt-4 block">
                <span className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  <span>
                    {t("player.withdraw.amountLabel", {
                      currency: payoutCurrency,
                    })}
                  </span>
                  <span className="font-mono normal-case tracking-normal text-neutral-700">
                    {t("player.withdraw.amountRange", {
                      min: limits.min,
                      max: limits.max,
                    })}
                  </span>
                </span>
                <input
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError("");
                  }}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("player.withdraw.amountPlaceholder")}
                  className={`${inputClass} font-mono text-lg`}
                />
                <span className="mt-1.5 block text-[10px] leading-4 text-neutral-500">
                  {t("player.withdraw.amountAvailableHint", {
                    amount: formatDisplayAmount(availableBalance, payoutCurrency),
                  })}
                </span>
              </label>

              {availableBalance > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const maxValue = Math.min(
                      availableBalance,
                      Number(limits.max),
                    );
                    setAmount(String(roundPayoutAmount(maxValue)));
                    setError("");
                  }}
                  className="mt-2 inline-flex h-7 items-center rounded-lg border border-[#d4af37]/25 px-2.5 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
                >
                  {t("player.withdraw.amountAll")} ·{" "}
                  {formatMoney(
                    Math.min(availableBalance, Number(limits.max)),
                    payoutCurrency,
                  )}
                </button>
              ) : null}

              <dl className="mt-4 space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-neutral-500">
                    {t("player.withdraw.feeLabel")}
                  </dt>
                  <dd className="font-mono tabular-nums text-neutral-300">
                    {formatMoney(feeValue, payoutCurrency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-neutral-500">
                    {t("player.withdraw.receiveLabel")}
                  </dt>
                  <dd className="font-mono font-bold tabular-nums text-[#f0d27c]">
                    {formatMoney(receiveValue, payoutCurrency)}
                  </dd>
                </div>
                <p className="pt-1 text-[9px] leading-4 text-neutral-600">
                  {t("player.withdraw.feeHint", {
                    rate: formatGatewayRatePercent(
                      selectedGateway?.feeRate ?? 0,
                      2,
                    ),
                  })}
                </p>
              </dl>

              {errorBanner}

              <button
                type="submit"
                disabled={submitting || matchingAccounts.length === 0}
                className="mt-5 h-11 w-full rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] shadow-[0_14px_36px_-14px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? t("player.withdraw.submitting")
                  : t("player.withdraw.submit")}
              </button>
            </form>
          )}
        </div>

        <div className="border-t border-[#d4af37]/10 bg-[#060606] px-5 py-3">
          <p className="text-center text-[9px] uppercase tracking-[0.18em] text-neutral-700">
            {t("player.withdraw.brandFooter", {
              brand: resolveBrandName(brandName),
            })}
          </p>
        </div>
      </section>
    </div>
  );
}

