"use client";

import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import {
  DepositPaymentModal,
  type DepositGatewayOption,
} from "@/components/deposit-payment-modal";

type GatewayListResponse = {
  gateways?: DepositGatewayOption[];
  /** false = 该商户一条收款通道都没配；true = 配了但当前不可用。 */
  merchantConfigured?: boolean;
  error?: string;
};

export function PlayerDepositButton({
  playerId,
  playerName,
}: {
  playerId: string;
  playerName: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gateways, setGateways] = useState<DepositGatewayOption[]>([]);
  const [error, setError] = useState("");

  async function handleOpen() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/deposit/gateways", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data: GatewayListResponse = await response
        .json()
        .catch(() => ({}) as GatewayListResponse);

      if (!response.ok) {
        setError(data.error || t("tenantPlayers.deposit.loadFailed"));
        return;
      }

      const available = data.gateways ?? [];

      if (available.length === 0) {
        setError(
          t(
            data.merchantConfigured === false
              ? "tenantPlayers.deposit.merchantNoChannels"
              : "tenantPlayers.deposit.noGateways",
          ),
        );
        return;
      }

      setGateways(available);
      setOpen(true);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={loading}
        className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.08] px-3 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/45 hover:bg-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? t("tenantPlayers.deposit.loading") : t("tenantPlayers.deposit.action")}
      </button>
      {error ? (
        <p className="max-w-[180px] text-right text-[9px] leading-4 text-red-300">
          {error}
        </p>
      ) : null}
      {open ? (
        <DepositPaymentModal
          playerId={playerId}
          playerName={playerName}
          gateways={gateways}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}