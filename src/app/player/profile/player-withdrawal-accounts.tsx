"use client";

import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n-types";
import { playerErrorKey } from "@/lib/player-errors";
import {
  WITHDRAWAL_CURRENCY_OPTIONS,
  findWithdrawalCurrencyOptionById,
  readWithdrawalAccountDraft,
  withdrawalCurrencyOptionId,
  type PlayerWithdrawalAccountView,
} from "@/lib/withdrawal-accounts";

/**
 * 安全 Tab 的【提现账号】动态模块：全球法币 + 加密货币收款账号。
 *
 * - 上方是已绑定账号列表（默认账号用黑金描边 + 呼吸光晕标注，可设为默认 / 删除）；
 * - 下方是动态表单：先选「币种 / 方式」，加密货币只要求钱包地址，
 *   法币要求银行名称 / 银行账号 / 账户持有人姓名；
 * - 数据完全受控：所有写操作返回完整列表后通过 onChange 回写给玩家中心，
 *   避免本地与服务端两份状态不一致。
 */

const FIELD_CLASS =
  "mt-1.5 h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-neutral-100 outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-neutral-600 focus:border-brand/60 focus:bg-white/[0.06] focus:ring-1 focus:ring-brand/25";

function shortValue(value: string, head = 12, tail = 8) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function accountLabelKey(account: PlayerWithdrawalAccountView) {
  return (
    findWithdrawalCurrencyOptionById(
      withdrawalCurrencyOptionId(account.currency, account.network),
    )?.labelKey ?? null
  );
}

function AccountCard({
  account,
  index,
  busy,
  onSetDefault,
  onRemove,
}: {
  account: PlayerWithdrawalAccountView;
  index: number;
  busy: boolean;
  onSetDefault: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useLanguage();
  const labelKey = accountLabelKey(account);
  const isBank = account.accountType === "bank";

  return (
    <article
      className={`withdrawal-account-card group relative overflow-hidden rounded-2xl border p-3.5 transition-[border-color,background-color,box-shadow] duration-500 ${
        account.isDefault
          ? "withdrawal-account-default border-brand/40 bg-gradient-to-br from-brand/[0.12] via-white/[0.02] to-transparent"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]"
      }`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span aria-hidden="true" className="withdrawal-account-sheen" />

      <div className="relative flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full bg-gradient-to-r from-brand-deep via-brand to-brand-soft px-2.5 py-1 text-[10px] font-black tracking-wide text-brand-ink">
            {labelKey ? t(labelKey) : account.currency}
          </span>
          <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            {isBank
              ? t("player.security.bankTag")
              : t("player.security.cryptoTag")}
          </span>
          {account.isDefault ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/[0.10] px-2 py-0.5 text-[9px] font-bold text-brand-pale">
              <span
                aria-hidden="true"
                className="withdrawal-default-dot h-1.5 w-1.5 rounded-full bg-brand-soft"
              />
              {t("player.security.defaultAccount")}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {account.isDefault ? null : (
            <button
              type="button"
              onClick={() => onSetDefault(account.id)}
              disabled={busy}
              className="h-8 rounded-lg border border-brand/30 px-2.5 text-[10px] font-semibold text-brand-soft transition-colors duration-300 hover:border-brand/60 hover:bg-brand/10 disabled:opacity-50"
            >
              {t("player.security.setDefault")}
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(account.id)}
            disabled={busy}
            className="h-8 rounded-lg border border-white/[0.08] px-2.5 text-[10px] font-semibold text-neutral-400 transition-colors duration-300 hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
          >
            {t("player.security.removeAccount")}
          </button>
        </div>
      </div>

      <div className="relative mt-2.5 space-y-0.5 text-[11px] leading-5">
        {isBank ? (
          <>
            <p className="truncate text-neutral-200">{account.bankName}</p>
            <p className="font-mono text-neutral-400">
              {account.accountNumber}
            </p>
            <p className="truncate text-neutral-500">{account.accountName}</p>
          </>
        ) : (
          <p className="break-all font-mono text-neutral-300">
            {shortValue(account.walletAddress ?? "")}
          </p>
        )}
      </div>
    </article>
  );
}

export function PlayerWithdrawalAccounts({
  accounts,
  onChange,
}: {
  accounts: PlayerWithdrawalAccountView[];
  onChange: (accounts: PlayerWithdrawalAccountView[]) => void;
}) {
  const { t } = useLanguage();

  const [optionId, setOptionId] = useState<string>(
    WITHDRAWAL_CURRENCY_OPTIONS[0].id,
  );
  const [walletAddress, setWalletAddress] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [notice, setNotice] = useState<TranslationKey | null>(null);

  const option = useMemo(
    () =>
      findWithdrawalCurrencyOptionById(optionId) ??
      WITHDRAWAL_CURRENCY_OPTIONS[0],
    [optionId],
  );

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function errorKeyFor(code: string | undefined): TranslationKey {
    if (code === "network") {
      return "common.networkError";
    }

    return playerErrorKey(code) ?? "player.error.generic";
  }

  async function sendRequest(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; code?: string }> {
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        credentials: "same-origin",
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json().catch(() => ({}))) as {
        accounts?: PlayerWithdrawalAccountView[];
        code?: string;
      };

      if (!response.ok || !data.accounts) {
        return { ok: false, code: data.code };
      }

      onChange(data.accounts);
      return { ok: true };
    } catch {
      return { ok: false, code: "network" };
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setNotice(null);

    const body =
      option.accountType === "crypto"
        ? { currency: option.currency, network: option.network, walletAddress }
        : {
            currency: option.currency,
            network: option.network,
            bankName,
            accountNumber,
            accountName,
          };

    // 先本地校验一次：与后端同一份规则，省掉一次无效请求。
    const parsed = readWithdrawalAccountDraft(body);

    if (!parsed.ok) {
      setErrorKey(errorKeyFor(parsed.code));
      return;
    }

    setBusyId("form");

    try {
      const result = await sendRequest(
        "/api/player/withdrawal-accounts",
        "POST",
        body,
      );

      if (!result.ok) {
        setErrorKey(errorKeyFor(result.code));
        return;
      }

      setWalletAddress("");
      setBankName("");
      setAccountNumber("");
      setAccountName("");
      setNotice("player.security.accountSaved");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDefault(id: string) {
    setErrorKey(null);
    setNotice(null);
    setBusyId(id);

    try {
      const result = await sendRequest(
        `/api/player/withdrawal-accounts/${id}`,
        "PATCH",
        { isDefault: true },
      );

      if (!result.ok) {
        setErrorKey(errorKeyFor(result.code));
        return;
      }

      setNotice("player.security.accountDefaultSet");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    if (!window.confirm(t("player.security.removeAccountConfirm"))) {
      return;
    }

    setErrorKey(null);
    setNotice(null);
    setBusyId(id);

    try {
      const result = await sendRequest(
        `/api/player/withdrawal-accounts/${id}`,
        "DELETE",
      );

      if (!result.ok) {
        setErrorKey(errorKeyFor(result.code));
        return;
      }

      setNotice("player.security.accountRemoved");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
            {t("player.security.withdrawalList")}
          </p>
          <span className="font-mono text-[10px] text-neutral-600">
            {accounts.length}
          </span>
        </div>

        {accounts.length === 0 ? (
          <div className="withdrawal-fields mt-2 rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.02] px-4 py-5 text-center">
            <p className="text-[11px] font-semibold text-neutral-300">
              {t("player.security.withdrawalEmpty")}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-neutral-600">
              {t("player.security.withdrawalEmptyHint")}
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {accounts.map((account, index) => (
              <AccountCard
                key={account.id}
                account={account}
                index={index}
                busy={busyId !== null}
                onSetDefault={(id) => void handleSetDefault(id)}
                onRemove={(id) => void handleRemove(id)}
              />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"
      >
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
            {t("player.security.withdrawalMethod")}
          </span>
          <div className="relative">
            <select
              value={optionId}
              onChange={(event) => {
                setOptionId(event.target.value);
                setErrorKey(null);
              }}
              className={`${FIELD_CLASS} cursor-pointer appearance-none pr-10`}
            >
              {WITHDRAWAL_CURRENCY_OPTIONS.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  className="bg-[#0b0b0b] text-neutral-100"
                >
                  {t(item.labelKey)}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="pointer-events-none absolute right-3 top-[calc(50%+0.2rem)] h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
            >
              <path
                d="M6 9l6 6 6-6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </label>

        {/* key = option.id：切换币种时整组字段重新挂载，触发一次黑金淡入动画 */}
        <div key={option.id} className="withdrawal-fields mt-3 space-y-3">
          {option.accountType === "crypto" ? (
            <>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                  {t("player.security.walletLabel")}
                </span>
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(event) => setWalletAddress(event.target.value)}
                  placeholder={option.network === "TRC20" ? "T..." : "0x..."}
                  autoComplete="off"
                  spellCheck={false}
                  className={`${FIELD_CLASS} font-mono`}
                />
              </label>
              <p className="text-[10px] leading-4 text-neutral-600">
                {t("player.security.cryptoHint")}
              </p>
            </>
          ) : (
            <>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                  {t("player.security.bankName")}
                </span>
                <input
                  type="text"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                  placeholder="Maybank / 中国工商银行"
                  autoComplete="off"
                  className={FIELD_CLASS}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                    {t("player.security.bankAccount")}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={accountNumber}
                    onChange={(event) => setAccountNumber(event.target.value)}
                    placeholder="1234 5678 9012"
                    autoComplete="off"
                    spellCheck={false}
                    className={`${FIELD_CLASS} font-mono`}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                    {t("player.security.accountHolder")}
                  </span>
                  <input
                    type="text"
                    value={accountName}
                    onChange={(event) => setAccountName(event.target.value)}
                    placeholder="TAN AH KOW"
                    autoComplete="off"
                    className={FIELD_CLASS}
                  />
                </label>
              </div>
            </>
          )}
        </div>

        {errorKey ? (
          <p role="alert" className="mt-2.5 text-[11px] text-red-300">
            {t(errorKey)}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="withdrawal-fields mt-2.5 text-[11px] font-semibold text-brand-soft"
          >
            {t(notice)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busyId !== null}
          className="relative mt-3 h-11 w-full overflow-hidden rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft text-xs font-bold text-brand-ink transition-all duration-300 hover:shadow-[0_12px_32px_-14px_var(--sf-a80)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="relative z-10">
            {busyId === "form"
              ? t("player.security.saving")
              : t("player.security.saveAccount")}
          </span>
          <span aria-hidden="true" className="withdrawal-button-sheen" />
        </button>
      </form>
    </div>
  );
}

