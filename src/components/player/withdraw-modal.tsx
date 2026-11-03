"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { resolveBrandName } from "@/lib/brand";
import { formatCurrency, formatDisplayAmount } from "@/lib/currency";
import { GATEWAY_PROVIDER_LABEL_KEYS } from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import { formatGatewayRatePercent } from "@/lib/payment-gateway-rates";
import { playerErrorKey } from "@/lib/player-errors";
import { notifyPlayerWalletChanged } from "@/lib/player-wallet-events";
import {
  findWithdrawalCurrencyOptionById,
  withdrawalCurrencyOptionId,
  type PlayerWithdrawalAccountView,
} from "@/lib/withdrawal-accounts";

/**
 * 玩家中心黑金风提现弹窗。
 *
 * 三段式：选通道 → 选收款钱包 → 填金额（含预估手续费 / 预计到账）。
 * - 通道列表来自 GET /api/player/withdrawal-gateways，过滤口径与提单接口完全一致；
 * - 钱包只从玩家已绑定的收款账号里选，提交时只传 accountId，
 *   真实银行账号 / 链上地址由服务端自己取（前端拿到的银行账号是掩码，回传也不可信）；
 * - 提交走 POST /api/withdrawal/create，生成 PENDING 单；
 *   余额在代付成功回调时才扣减，弹窗里如实提示，不做「已扣款」的假象。
 */

export type PlayerWithdrawGatewayOption = {
  id: string;
  name: string;
  providerType: string;
  currency: string;
  /** 网关代付售价，0.1 = 10%；只用于展示预估手续费 */
  feeRate: string;
};

type AmountLimits = { min: string; max: string };

type GatewayListResponse = {
  success?: boolean;
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
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

function shortValue(value: string, head = 10, tail = 8) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * 提现金额 / 手续费 / 到账金额的展示：最多 6 位小数并去掉尾随 0。
 *
 * 这几个数字是「玩家要转出去的钱」，少给一位就转不到账，所以必须按原样展示；
 * 余额（当前余额 / 可提余额 / 在途金额）不属于这个口径，一律走
 * formatDisplayAmount —— 固定两位小数（530.500000 → 530.50）。
 */
function formatMoney(value: number, currency: string) {
  return formatCurrency(value, currency, {
    maximumFractionDigits: 6,
    trimZeros: true,
  });
}

function providerLabel(providerType: string, t: TFunction) {
  const key =
    GATEWAY_PROVIDER_LABEL_KEYS[
      providerType as keyof typeof GATEWAY_PROVIDER_LABEL_KEYS
    ];

  return key ? t(key) : providerType;
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

/** 钱包下拉框文案：加密显示网络 + 缩略地址，法币显示银行 + 掩码账号。 */
function accountLabel(account: PlayerWithdrawalAccountView, t: TFunction) {
  const option = findWithdrawalCurrencyOptionById(
    withdrawalCurrencyOptionId(account.currency, account.network),
  );
  const currencyLabel = option ? t(option.labelKey) : account.currency;

  if (account.accountType === "bank") {
    return [currencyLabel, account.bankName, account.accountNumber]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(" · ");
  }

  return `${currencyLabel} · ${shortValue(account.walletAddress ?? "")}`;
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
  const [gatewayId, setGatewayId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{
    id: string;
    amount: string;
    currency: string;
    walletAddress: string;
  } | null>(null);

  const pendingValue = Number(pendingWithdrawalAmount);
  const availableBalance = Math.max(
    0,
    round6(Number(balance) - (Number.isFinite(pendingValue) ? pendingValue : 0)),
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

        const first = available[0];
        const preferredAccount =
          accounts.find(
            (item) => item.currency === first.currency && item.isDefault,
          ) ?? accounts.find((item) => item.currency === first.currency);

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
  }, [accounts, t]);

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
  const currency = selectedGateway?.currency ?? "";
  const matchingAccounts = useMemo(
    () =>
      selectedGateway
        ? accounts.filter((item) => item.currency === selectedGateway.currency)
        : [],
    [accounts, selectedGateway],
  );

  const amountValue = Number(amount);
  const safeAmount =
    Number.isFinite(amountValue) && amountValue > 0 ? amountValue : 0;
  const feeRateValue = Number(selectedGateway?.feeRate ?? 0);
  const feeValue =
    safeAmount > 0 && Number.isFinite(feeRateValue) && feeRateValue > 0
      ? round6(safeAmount * feeRateValue)
      : 0;
  const receiveValue = Math.max(0, round6(safeAmount - feeValue));

  function handleGatewayChange(nextId: string) {
    setGatewayId(nextId);
    setError("");

    const next = gateways.find((item) => item.id === nextId);

    if (!next) {
      setAccountId("");
      return;
    }

    const preferred =
      accounts.find(
        (item) => item.currency === next.currency && item.isDefault,
      ) ?? accounts.find((item) => item.currency === next.currency);

    setAccountId(preferred?.id ?? "");
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
        currency: data.withdrawal.currency,
        walletAddress: data.withdrawal.walletAddress,
      });
      // 广播钱包变更：大厅顶栏等展示余额的组件会立即重新拉 /api/player/me，
      // 余额马上变成扣减后的可用余额（含在途提现单）。
      notifyPlayerWalletChanged();
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
                {submitted.walletAddress}
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
                      {item.name} · {providerLabel(item.providerType, t)} ·{" "}
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
                        {accountLabel(account, t)}
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
                        currency: currency || walletCurrency,
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
                      currency: currency || walletCurrency,
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
              </label>

              {currency && currency !== walletCurrency ? (
                <p className="mt-1.5 text-[10px] leading-4 text-amber-300/80">
                  {t("player.withdraw.channelCurrencyHint", {
                    currency,
                    walletCurrency,
                  })}
                </p>
              ) : null}

              {availableBalance > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const maxValue = Math.min(
                      availableBalance,
                      Number(limits.max),
                    );
                    setAmount(String(round6(maxValue)));
                    setError("");
                  }}
                  className="mt-2 inline-flex h-7 items-center rounded-lg border border-[#d4af37]/25 px-2.5 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
                >
                  {t("player.withdraw.amountAll")} ·{" "}
                  {formatMoney(
                    Math.min(availableBalance, Number(limits.max)),
                    currency || walletCurrency,
                  )}
                </button>
              ) : null}

              <dl className="mt-4 space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-neutral-500">
                    {t("player.withdraw.feeLabel")}
                  </dt>
                  <dd className="font-mono tabular-nums text-neutral-300">
                    {formatMoney(feeValue, currency || walletCurrency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-neutral-500">
                    {t("player.withdraw.receiveLabel")}
                  </dt>
                  <dd className="font-mono font-bold tabular-nums text-[#f0d27c]">
                    {formatMoney(receiveValue, currency || walletCurrency)}
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

