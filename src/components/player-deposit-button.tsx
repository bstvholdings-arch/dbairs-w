"use client";

import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  DepositPaymentModal,
  type DepositGatewayOption,
} from "@/components/deposit-payment-modal";

type GatewayListResponse = {
  gateways?: DepositGatewayOption[];
  error?: string;
};

type FlowStatus = "loading" | "ready" | "error";

/**
 * 受控的玩家充值流程：open 变成 true 后按当前登录玩家拉取可用网关，
 * 再复用后台同款收银台弹窗。身份完全由 httpOnly 玩家 Cookie 决定，前端不传 playerId。
 *
 * 独立成受控组件，是为了让大厅的核心功能岛、玩家中心等任意入口共用同一套充值逻辑，
 * 而不是各自复制一份「拉网关 + 打开弹窗」的代码。
 */
export function PlayerDepositFlow({
  open,
  playerName,
  onClose,
  onDeposited,
}: {
  open: boolean;
  playerName: string;
  onClose: () => void;
  onDeposited?: (balance?: string | null) => void;
}) {
  if (!open) {
    return null;
  }

  // 每次打开都挂载一个新的会话组件：状态自然从 loading 开始，
  // 不需要在 effect 里同步重置 state，关闭后再打开也不会残留上一次的错误。
  return (
    <PlayerDepositSession
      playerName={playerName}
      onClose={onClose}
      onDeposited={onDeposited}
    />
  );
}

function PlayerDepositSession({
  playerName,
  onClose,
  onDeposited,
}: {
  playerName: string;
  onClose: () => void;
  onDeposited?: (balance?: string | null) => void;
}) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<FlowStatus>("loading");
  const [gateways, setGateways] = useState<DepositGatewayOption[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/deposit/gateways", {
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
          setError(
            data.error ||
              (response.status === 401
                ? t("player.deposit.loginRequired")
                : t("player.deposit.loadFailed")),
          );
          return;
        }

        const available = data.gateways ?? [];

        if (available.length === 0) {
          setStatus("error");
          setError(t("player.deposit.noGateways"));
          return;
        }

        setGateways(available);
        setStatus("ready");
      } catch {
        if (!active || controller.signal.aborted) {
          return;
        }

        setStatus("error");
        setError(t("common.networkError"));
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [t]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (status === "ready" && gateways.length > 0) {
    return (
      <DepositPaymentModal
        playerName={playerName}
        gateways={gateways}
        onDepositSuccess={(balance) => onDeposited?.(balance)}
        onClose={onClose}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
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
        aria-label={t("deposit.title")}
        className="w-full max-w-sm rounded-2xl border border-[#d4af37]/25 bg-[#080808] px-6 py-7 text-center shadow-[0_30px_120px_-25px_rgba(212,175,55,0.4)]"
      >
        {status === "loading" ? (
          <>
            <span
              aria-hidden="true"
              className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[#d4af37]/25 border-t-[#f0d27c]"
            />
            <p className="mt-4 text-xs text-neutral-400">
              {t("player.deposit.loading")}
            </p>
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-red-400/30 bg-red-400/10 text-lg text-red-300"
            >
              !
            </span>
            <p className="mt-3 text-xs leading-5 text-neutral-300">{error}</p>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border border-white/10 px-4 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
        >
          {t("common.close")}
        </button>
      </section>
    </div>
  );
}

/**
 * 玩家自助充值按钮：点击后打开 PlayerDepositFlow。
 * 玩家中心等需要「一个按钮搞定充值」的场景直接用它。
 */
export function PlayerDepositButton({
  playerName,
  onDeposited,
  className,
  label,
}: {
  playerName: string;
  onDeposited?: (balance?: string | null) => void;
  className?: string;
  label?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_10px_30px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {label ?? t("player.deposit.action")}
      </button>
      <PlayerDepositFlow
        open={open}
        playerName={playerName}
        onClose={() => setOpen(false)}
        onDeposited={(balance) => {
          setOpen(false);
          onDeposited?.(balance);
        }}
      />
    </div>
  );
}
