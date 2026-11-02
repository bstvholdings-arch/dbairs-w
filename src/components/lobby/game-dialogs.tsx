"use client";

import type { ReactNode } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/currency";
import type { TranslationKey } from "@/lib/i18n-types";
import { DEPOSIT_PRESETS } from "@/lib/lobby-wallet";

/** 通用弹窗外壳：遮罩 + 金边面板。Esc / 点击遮罩关闭由调用方处理。 */
export function ModalShell({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/80 backdrop-blur-md"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-brand/25 bg-[#080808] shadow-[0_40px_120px_-30px_var(--sf-a50)]"
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-soft to-transparent"
        />
        {children}
      </section>
    </div>
  );
}

/** 「正在连接游戏商」提示：模拟跳转到游戏端。 */
export function ConnectingDialog({
  titleId,
  providerName,
  onClose,
}: {
  titleId: string;
  providerName: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  return (
    <ModalShell labelledBy={titleId} onClose={onClose}>
      <div className="flex flex-col items-center px-5 pb-5 pt-7 text-center">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand-soft/25" />
          <span className="absolute inset-1.5 rounded-full border border-brand-soft/40" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-brand-soft shadow-[0_0_16px_var(--sf-soft-a95)]" />
        </span>
        <h2 id={titleId} className="mt-4 text-sm font-semibold text-neutral-100">
          {t("lobby.connecting", { provider: providerName })}
        </h2>
        <p className="mt-1.5 text-[10px] leading-4 text-neutral-500">
          {t("lobby.connectingHint")}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 h-9 w-full rounded-xl border border-white/10 text-[11px] text-neutral-400 transition-colors hover:border-brand/30 hover:text-neutral-200"
        >
          {t("common.cancel")}
        </button>
      </div>
    </ModalShell>
  );
}

/** 演示充值弹窗：只改页面展示余额，不产生真实交易。 */
export function DepositDialog({
  titleId,
  balance,
  amount,
  currency = DEFAULT_CURRENCY,
  onSelectAmount,
  onConfirm,
  onClose,
}: {
  titleId: string;
  balance: number;
  amount: number;
  /** 租户记账货币：符号按它渲染，默认 MYR */
  currency?: string;
  onSelectAmount: (amount: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  return (
    <ModalShell labelledBy={titleId} onClose={onClose}>
      <div className="px-5 pb-5 pt-6">
        <h2 id={titleId} className="text-sm font-semibold text-neutral-100">
          {t("lobby.deposit.title")}
        </h2>
        <p className="mt-1 text-[10px] leading-4 text-neutral-500">
          {t("lobby.deposit.subtitle")}
        </p>

        <div className="mt-4 flex items-center justify-between rounded-xl border border-brand/20 bg-brand/[0.06] px-3 py-2.5">
          <span className="text-[9px] uppercase tracking-[0.2em] text-neutral-500">
            {t("lobby.balance")}
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums text-brand-pale">
            {formatCurrency(balance, currency)}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {DEPOSIT_PRESETS.map((preset) => {
            const selected = preset === amount;

            return (
              <button
                key={preset}
                type="button"
                onClick={() => onSelectAmount(preset)}
                aria-pressed={selected}
                className={`h-10 rounded-xl border font-mono text-xs font-semibold tabular-nums transition-all ${
                  selected
                    ? "border-brand-soft/70 bg-gradient-to-r from-brand-soft/25 to-brand-deep/10 text-brand-pale shadow-[0_10px_24px_-14px_var(--sf-a90)]"
                    : "border-white/[0.08] bg-white/[0.02] text-neutral-400 hover:border-brand/30 hover:text-brand-soft"
                }`}
              >
                ${preset}
              </button>
            );
          })}
        </div>

        <p className="mt-3 rounded-lg border border-brand/15 bg-black/40 px-3 py-2 text-[10px] leading-5 text-[#cdb478]">
          {t("lobby.deposit.demoNotice")}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-xl border border-white/[0.08] text-[11px] text-neutral-400 transition-colors hover:border-brand/20 hover:text-neutral-200"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 flex-1 rounded-xl bg-gradient-to-r from-brand-deep via-brand-soft to-brand-deep text-[11px] font-bold text-brand-ink shadow-[0_12px_30px_-14px_var(--sf-a95)] transition-opacity hover:opacity-90"
          >
            {t("lobby.deposit.confirm")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * 「即将上线」提示：Login / Register / Mission / Referral 目前都是占位入口，
 * 点击只弹提示，不产生任何请求。
 */
export function ComingSoonDialog({
  titleId,
  titleKey,
  bodyKey,
  icon,
  onClose,
}: {
  titleId: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  icon: ReactNode;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  return (
    <ModalShell labelledBy={titleId} onClose={onClose}>
      <div className="flex flex-col items-center px-5 pb-5 pt-7 text-center">
        <span className="relative flex h-16 w-16 items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-brand-soft/20 blur-lg animate-[halo-breathe_2.8s_ease-in-out_infinite] motion-reduce:animate-none"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border border-brand/35"
          />
          <span className="relative text-brand-soft">{icon}</span>
        </span>
        <span className="mt-4 rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.24em] text-brand-soft">
          {t("lobby.comingSoon.badge")}
        </span>
        <h2
          id={titleId}
          className="mt-3 text-base font-black tracking-tight text-neutral-50"
        >
          {t(titleKey)}
        </h2>
        <p className="mt-2 text-[11px] leading-5 text-neutral-400">
          {t(bodyKey)}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 h-10 w-full rounded-xl bg-gradient-to-r from-brand-deep via-brand-soft to-brand-deep text-[11px] font-bold text-brand-ink shadow-[0_12px_30px_-14px_var(--sf-a95)] transition-opacity hover:opacity-90"
        >
          {t("lobby.comingSoon.close")}
        </button>
      </div>
    </ModalShell>
  );
}

