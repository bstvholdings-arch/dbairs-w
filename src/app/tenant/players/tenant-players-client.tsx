"use client";

import { useEffect } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatAmount, formatDate, formatInteger } from "@/lib/format";

import { PlayerDepositButton } from "./player-deposit-button";

type TenantPlayerRow = {
  id: string;
  username: string;
  balance: number;
  status: string;
  betRecords: number;
  createdAt: string;
};

export function TenantPlayersView({
  tenantName,
  total,
  players,
}: {
  tenantName: string;
  total: number;
  players: TenantPlayerRow[];
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  useEffect(() => {
    document.title = t("tenantPlayers.documentTitle");
  }, [t]);

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("tenantPlayers.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantPlayers.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          {t("tenantPlayers.subtitle", {
            tenant: tenantName,
            count: formatInteger(total),
          })}
        </p>
      </header>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="border-b border-[#d4af37]/10 px-5 py-4">
          <h2 className="text-sm font-medium text-neutral-200">
            {t("tenantPlayers.table.title")}
          </h2>
          <p className="mt-1 text-[10px] text-neutral-600">
            {t("tenantPlayers.table.subtitle")}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3 font-medium">
                  {t("tenantPlayers.table.username")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("tenantPlayers.table.balance")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("tenantPlayers.table.status")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("tenantPlayers.table.bets")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("tenantPlayers.table.deposit")}
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  {t("tenantPlayers.table.createdAt")}
                </th>
              </tr>
            </thead>
            <tbody>
              {players.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-xs text-neutral-600"
                  >
                    {t("tenantPlayers.table.empty")}
                  </td>
                </tr>
              ) : (
                players.map((player) => (
                  <tr
                    key={player.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-neutral-200">
                        {player.username}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                        {player.id.slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#f0d27c]">
                      ${formatAmount(player.balance)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${
                          player.status === "active"
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                            : "border-red-400/20 bg-red-400/10 text-red-300"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {player.status === "active"
                          ? t("tenantPlayers.status.active")
                          : player.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">
                      {formatInteger(player.betRecords)}
                    </td>
                    <td className="px-5 py-3.5">
                      <PlayerDepositButton
                        playerId={player.id}
                        playerName={player.username}
                      />
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-[10px] text-neutral-600">
                      {formatDate(player.createdAt, locale)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
