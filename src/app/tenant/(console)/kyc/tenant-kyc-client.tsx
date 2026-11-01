"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatAmount, formatDate, formatInteger } from "@/lib/format";
import type {
  TenantKycDetail,
  TenantKycPage,
  TenantKycRow,
} from "@/lib/tenant-console";

/**
 * 商户 KYC 审核（黑金风格）。
 *
 * 列表只拿脱敏证件号；点「查看详情」才按 id 请求完整资料与图片地址，
 * 图片本身走 /api/tenant/kyc/files/[key]，同样只放行本租户会话。
 */

function buildHref(params: { q: string; status: string; page: number }) {
  const search = new URLSearchParams();

  if (params.q) {
    search.set("q", params.q);
  }

  if (params.status) {
    search.set("status", params.status);
  }

  if (params.page > 1) {
    search.set("page", String(params.page));
  }

  const qs = search.toString();

  return qs ? `/tenant/kyc?${qs}` : "/tenant/kyc";
}

export function TenantKycView({
  tenantName,
  data,
  query,
}: {
  tenantName: string;
  data: TenantKycPage;
  query: { q: string; status: string };
}) {
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const router = useRouter();

  const [banner, setBanner] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [detail, setDetail] = useState<TenantKycDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");

  useEffect(() => {
    document.title = t("tenantKyc.documentTitle");
  }, [t]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const filters = [
    { value: "", label: t("tenantKyc.filter.all") },
    { value: "PENDING", label: t("tenantKyc.counts.pending") },
    { value: "APPROVED", label: t("tenantKyc.counts.approved") },
    { value: "REJECTED", label: t("tenantKyc.counts.rejected") },
  ];

  const counters = [
    { key: "all", label: t("tenantKyc.counts.all"), value: data.counts.all },
    {
      key: "PENDING",
      label: t("tenantKyc.counts.pending"),
      value: data.counts.pending,
    },
    {
      key: "APPROVED",
      label: t("tenantKyc.counts.approved"),
      value: data.counts.approved,
    },
    {
      key: "REJECTED",
      label: t("tenantKyc.counts.rejected"),
      value: data.counts.rejected,
    },
  ];

  async function openDetail(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    setRejectMode(false);
    setRejectReason("");
    setBusy("");

    try {
      const response = await fetch(`/api/tenant/kyc/${id}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        kyc?: TenantKycDetail;
      } | null;

      if (!response.ok || !payload?.kyc) {
        setBanner({
          tone: "error",
          text: payload?.error || t("tenantKyc.detail.loadFailed"),
        });
        return;
      }

      setDetail(payload.kyc);
    } catch {
      setBanner({ tone: "error", text: t("common.networkError") });
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetail(null);
    setDetailError(null);
    setRejectMode(false);
    setRejectReason("");
    setBusy("");
  }

  async function review(action: "approve" | "reject") {
    if (!detail) {
      return;
    }

    if (action === "reject" && !rejectReason.trim()) {
      setDetailError(t("tenantKyc.error.reasonRequired"));
      setRejectMode(true);
      return;
    }

    if (
      action === "approve" &&
      !window.confirm(t("tenantKyc.actions.confirmApprove", { name: detail.playerName }))
    ) {
      return;
    }

    setBusy(action);
    setDetailError(null);

    try {
      const response = await fetch(`/api/tenant/kyc/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(
          action === "reject"
            ? { action, rejectReason: rejectReason.trim() }
            : { action },
        ),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setDetailError(payload?.error || t("tenantKyc.error.actionFailed"));
        return;
      }

      setBanner({
        tone: "ok",
        text: t(
          action === "approve"
            ? "tenantKyc.banner.approved"
            : "tenantKyc.banner.rejected",
          { name: detail.playerName },
        ),
      });
      closeDetail();
      router.refresh();
    } catch {
      setDetailError(t("common.networkError"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("tenantKyc.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("tenantKyc.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          {t("tenantKyc.subtitle", {
            tenant: tenantName,
            count: formatInteger(data.total),
          })}
        </p>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counters.map((counter) => {
          const active = (query.status || "all") === counter.key;

          return (
            <Link
              key={counter.key}
              href={buildHref({
                q: query.q,
                status: counter.key === "all" ? "" : counter.key,
                page: 1,
              })}
              className={`rounded-xl border px-3 py-2.5 transition-colors ${
                active
                  ? "border-[#d4af37]/40 bg-[#d4af37]/10"
                  : "border-white/[0.06] bg-[#0a0a0a]/70 hover:border-[#d4af37]/25"
              }`}
            >
              <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">
                {counter.label}
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-[#f0d27c]">
                {formatInteger(counter.value)}
              </p>
            </Link>
          );
        })}
      </div>

      <form
        action="/tenant/kyc"
        method="get"
        className="mt-4 flex flex-col gap-2 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-3 sm:flex-row sm:items-center"
      >
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={64}
          placeholder={t("tenantKyc.search.placeholder")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/40 px-3 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-[#d4af37]/45 focus:outline-none"
        />
        <select
          name="status"
          defaultValue={query.status}
          className="h-9 rounded-lg border border-white/[0.08] bg-black/40 px-3 text-xs text-neutral-300 focus:border-[#d4af37]/45 focus:outline-none"
        >
          {filters.map((filter) => (
            <option key={filter.value || "all"} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-4 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/20"
        >
          {t("tenantKyc.search.submit")}
        </button>
        <Link
          href="/tenant/kyc"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-white/[0.08] px-3 text-[11px] text-neutral-400 transition-colors hover:text-neutral-200"
        >
          {t("tenantKyc.search.reset")}
        </Link>
      </form>

      {banner ? (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-[11px] ${
            banner.tone === "ok"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/25 bg-red-400/10 text-red-200"
          }`}
        >
          {banner.text}
        </p>
      ) : null}

      <section className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-white/[0.05] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-4 py-3 font-medium">
                  {t("tenantKyc.table.player")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantKyc.table.realName")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantKyc.table.idNumber")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantKyc.table.status")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantKyc.table.submittedAt")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("tenantKyc.table.reviewedAt")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("tenantKyc.table.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-xs text-neutral-600"
                  >
                    {t("tenantKyc.table.empty")}
                  </td>
                </tr>
              ) : (
                data.items.map((row: TenantKycRow) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-4 py-3.5">
                      <p className="text-sm text-neutral-200">{row.playerName}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                        {row.playerEmail ?? row.playerId.slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-neutral-300">
                      {row.realName}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-neutral-400">
                      {row.idNumberMasked}
                    </td>
                    <td className="px-4 py-3.5">
                      <KycStatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[10px] text-neutral-500">
                      {formatDate(row.submittedAt, locale)}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[10px] text-neutral-500">
                      {row.reviewedAt ? formatDate(row.reviewedAt, locale) : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => void openDetail(row.id)}
                        disabled={detailLoading}
                        className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/20 px-2.5 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t("tenantKyc.actions.view")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[10px] text-neutral-500">
        <span>
          {t("tenantKyc.pagination.summary", {
            page: formatInteger(data.page),
            pages: formatInteger(totalPages),
            total: formatInteger(data.total),
          })}
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={buildHref({
              q: query.q,
              status: query.status,
              page: Math.max(1, data.page - 1),
            })}
            aria-disabled={data.page <= 1}
            className={`inline-flex h-8 items-center rounded-lg border px-3 transition-colors ${
              data.page <= 1
                ? "pointer-events-none border-white/[0.05] text-neutral-700"
                : "border-[#d4af37]/20 text-[#f0d27c] hover:bg-[#d4af37]/10"
            }`}
          >
            {t("tenantKyc.pagination.prev")}
          </Link>
          <Link
            href={buildHref({
              q: query.q,
              status: query.status,
              page: Math.min(totalPages, data.page + 1),
            })}
            aria-disabled={data.page >= totalPages}
            className={`inline-flex h-8 items-center rounded-lg border px-3 transition-colors ${
              data.page >= totalPages
                ? "pointer-events-none border-white/[0.05] text-neutral-700"
                : "border-[#d4af37]/20 text-[#f0d27c] hover:bg-[#d4af37]/10"
            }`}
          >
            {t("tenantKyc.pagination.next")}
          </Link>
        </div>
      </div>

      {detail ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("tenantKyc.detail.title")}
          onClick={closeDetail}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="my-4 w-full max-w-4xl rounded-2xl border border-[#d4af37]/20 bg-[#0b0b0b] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]"
          >
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
                  {t("tenantKyc.detail.title")}
                </p>
                <h2 className="mt-1.5 truncate text-lg font-semibold text-white">
                  {detail.playerName}
                </h2>
                <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                  {detail.playerEmail ?? detail.playerId.slice(0, 8)}
                </p>
              </div>
              <KycStatusBadge status={detail.status} />
            </header>

            <div className="grid gap-4 p-4 sm:grid-cols-[1.05fr_0.95fr] sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <KycImageFrame
                  label={t("tenantKyc.detail.front")}
                  url={detail.idCardFrontUrl}
                />
                <KycImageFrame
                  label={t("tenantKyc.detail.back")}
                  url={detail.idCardBackUrl}
                />
                <p className="text-[10px] leading-4 text-neutral-600 sm:col-span-2">
                  {t("tenantKyc.detail.imageHint")}
                </p>
              </div>

              <dl className="space-y-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px]">
                <DetailRow
                  label={t("tenantKyc.detail.balance")}
                  value={`$${formatAmount(detail.player.balance)}`}
                />
                <DetailRow
                  label={t("tenantKyc.detail.playerStatus")}
                  value={detail.player.status}
                />
                <DetailRow
                  label={t("tenantKyc.detail.realName")}
                  value={detail.realName}
                />
                <DetailRow
                  label={t("tenantKyc.detail.idNumber")}
                  value={detail.idNumber}
                  mono
                />
                <DetailRow
                  label={t("tenantKyc.detail.submittedAt")}
                  value={formatDate(detail.submittedAt, locale)}
                />
                <DetailRow
                  label={t("tenantKyc.detail.reviewedAt")}
                  value={
                    detail.reviewedAt
                      ? formatDate(detail.reviewedAt, locale)
                      : "—"
                  }
                />
                {detail.reviewedBy ? (
                  <DetailRow
                    label={t("tenantKyc.detail.reviewer")}
                    value={detail.reviewedBy}
                  />
                ) : null}
                {detail.rejectReason ? (
                  <div className="rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.16em] text-red-300/80">
                      {t("tenantKyc.detail.rejectReason")}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-red-200">
                      {detail.rejectReason}
                    </p>
                  </div>
                ) : null}
              </dl>
            </div>

            <footer className="border-t border-white/[0.06] p-4 sm:p-5">
              {rejectMode ? (
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                    {t("tenantKyc.detail.rejectReasonLabel")}
                  </span>
                  <textarea
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    rows={3}
                    maxLength={200}
                    placeholder={t("tenantKyc.detail.rejectReasonPlaceholder")}
                    className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-red-400/40 focus:outline-none"
                  />
                </label>
              ) : null}

              {detailError ? (
                <p className="mt-2 text-[11px] text-red-300">{detailError}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDetail}
                  className="h-9 rounded-xl border border-white/[0.08] px-4 text-[11px] text-neutral-400 transition-colors hover:text-neutral-200"
                >
                  {t("tenantKyc.actions.close")}
                </button>

                {detail.status === "PENDING" ? (
                  <>
                    {rejectMode ? (
                      <button
                        type="button"
                        onClick={() => void review("reject")}
                        disabled={busy !== ""}
                        className="h-9 rounded-xl border border-red-400/30 px-4 text-[11px] text-red-300 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === "reject"
                          ? t("tenantKyc.actions.working")
                          : t("tenantKyc.actions.reject")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDetailError(null);
                          setRejectMode(true);
                        }}
                        className="h-9 rounded-xl border border-red-400/30 px-4 text-[11px] text-red-300 transition-colors hover:bg-red-400/10"
                      >
                        {t("tenantKyc.actions.reject")}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void review("approve")}
                      disabled={busy !== ""}
                      className="h-9 rounded-xl bg-gradient-to-r from-[#b8860b] via-[#d4af37] to-[#f0d27c] px-4 text-[11px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === "approve"
                        ? t("tenantKyc.actions.working")
                        : t("tenantKyc.actions.approve")}
                    </button>
                  </>
                ) : null}
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function KycStatusBadge({
  status,
}: {
  status: "PENDING" | "APPROVED" | "REJECTED";
}) {
  const { t } = useLanguage();

  const tone =
    status === "APPROVED"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
      : status === "REJECTED"
        ? "border-red-400/25 bg-red-400/10 text-red-300"
        : "border-amber-400/25 bg-amber-400/10 text-amber-300";

  const label =
    status === "APPROVED"
      ? t("tenantKyc.status.approved")
      : status === "REJECTED"
        ? t("tenantKyc.status.rejected")
        : t("tenantKyc.status.pending");

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.04] pb-2 last:border-0 last:pb-0">
      <dt className="shrink-0 text-[9px] uppercase tracking-[0.16em] text-neutral-600">
        {label}
      </dt>
      <dd
        className={`min-w-0 break-all text-right text-neutral-300 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * 证件图片预览。
 *
 * 这里的 src 是 /api/tenant/kyc/files/<key>：浏览器会带上管理员 Cookie，
 * 接口校验「本租户确实提交过这张图」后才返回文件；把 URL 复制给别人打开只会 404。
 * 生产环境换成对象存储签名 URL 时，这个组件不用改。
 */
function KycImageFrame({
  label,
  url,
}: {
  label: string;
  url: string | null;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">
        {label}
      </p>
      <div className="mt-1.5 overflow-hidden rounded-xl border border-white/[0.08] bg-black/50">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={label}
              className="h-44 w-full object-contain transition-opacity hover:opacity-90"
            />
          </a>
        ) : (
          <p className="flex h-44 items-center justify-center text-[11px] text-neutral-600">
            —
          </p>
        )}
      </div>
    </div>
  );
}
