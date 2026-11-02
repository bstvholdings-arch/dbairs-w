"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/components/LanguageProvider";
import { TenantBrandLockup } from "@/components/brand/tenant-brand";
import { formatDate } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n-types";
import { buildStorefrontTheme } from "@/lib/storefront";

/**
 * 玩家实名认证表单（黑金风格）。
 *
 * 流程：本地选图 → POST /api/player/kyc/upload 拿受控 URL →
 * POST /api/player/kyc 提交姓名 / 证件号 / 两张图片 → 状态变 PENDING。
 * 被驳回后可修改资料并重新提交；审核中 / 已通过时表单锁定，只读展示。
 */

export type PlayerKycRecord = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  realName: string;
  idNumber: string;
  idCardFrontUrl: string | null;
  idCardBackUrl: string | null;
  rejectReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
};

/** 接口错误码 -> 词典 key，保证中英文都有兜底文案。 */
const KYC_ERROR_KEYS: Record<string, TranslationKey> = {
  unauthorized: "player.error.unauthorized",
  kyc_pending: "player.kyc.form.lockedPending",
  kyc_already_approved: "player.kyc.form.lockedApproved",
  kyc_conflict: "player.kyc.error.submitFailed",
  real_name_invalid: "player.kyc.form.required",
  id_number_invalid: "player.kyc.form.required",
  id_card_missing: "player.kyc.form.required",
  id_card_invalid: "player.kyc.error.uploadFailed",
  id_card_duplicated: "player.kyc.error.uploadFailed",
  invalid_request: "player.kyc.error.submitFailed",
  upload_failed: "player.kyc.error.uploadFailed",
  file_too_large: "player.kyc.error.fileTooLarge",
  invalid_file_type: "player.kyc.error.fileType",
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const INPUT_CLASS =
  "mt-1.5 h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-brand/50 focus:ring-1 focus:ring-brand/25";

const STATUS_TONES: Record<string, string> = {
  NONE: "border-white/[0.08] bg-white/[0.03] text-neutral-400",
  PENDING: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  APPROVED: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  REJECTED: "border-red-400/25 bg-red-400/10 text-red-300",
};

function statusLabelKey(status: string): TranslationKey {
  if (status === "PENDING") {
    return "player.kyc.status.pending";
  }

  if (status === "APPROVED") {
    return "player.kyc.status.approved";
  }

  if (status === "REJECTED") {
    return "player.kyc.status.rejected";
  }

  return "player.kyc.status.none";
}

export function PlayerKycClient({
  themeColor,
  tenantName,
  tenantLogoUrl,
  playerName,
  kyc: initialKyc,
}: {
  themeColor: string;
  tenantName: string;
  /** 商户品牌 Logo（Tenant.logoUrl）；没配则由 TenantBrandLockup 用商户名首字母占位 */
  tenantLogoUrl: string | null;
  playerName: string;
  kyc: PlayerKycRecord | null;
}) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const theme = useMemo(() => buildStorefrontTheme(themeColor), [themeColor]);

  const [kyc, setKyc] = useState<PlayerKycRecord | null>(initialKyc);
  const [realName, setRealName] = useState(initialKyc?.realName ?? "");
  const [idNumber, setIdNumber] = useState(initialKyc?.idNumber ?? "");
  const [frontUrl, setFrontUrl] = useState(initialKyc?.idCardFrontUrl ?? "");
  const [backUrl, setBackUrl] = useState(initialKyc?.idCardBackUrl ?? "");
  const [uploading, setUploading] = useState<"" | "front" | "back">("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [toast, setToast] = useState<TranslationKey | null>(null);

  const frontInput = useRef<HTMLInputElement | null>(null);
  const backInput = useRef<HTMLInputElement | null>(null);

  const status = kyc?.status ?? "NONE";
  const editable = status === "NONE" || status === "REJECTED";

  async function handleUpload(side: "front" | "back", file: File) {
    setErrorKey(null);
    setToast(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setErrorKey("player.kyc.error.fileType");
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setErrorKey("player.kyc.error.fileTooLarge");
      return;
    }

    setUploading(side);

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/player/kyc/upload", {
        method: "POST",
        body: form,
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        code?: string;
      } | null;

      if (!response.ok || !payload?.url) {
        setErrorKey(
          KYC_ERROR_KEYS[payload?.code ?? ""] ?? "player.kyc.error.uploadFailed",
        );
        return;
      }

      if (side === "front") {
        setFrontUrl(payload.url);
      } else {
        setBackUrl(payload.url);
      }
    } catch {
      setErrorKey("player.kyc.error.uploadFailed");
    } finally {
      setUploading("");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setToast(null);

    if (!realName.trim() || !idNumber.trim() || !frontUrl || !backUrl) {
      setErrorKey("player.kyc.form.required");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch("/api/player/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          realName,
          idNumber,
          idCardFrontUrl: frontUrl,
          idCardBackUrl: backUrl,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        kyc?: PlayerKycRecord;
        code?: string;
      } | null;

      if (!response.ok || !payload?.kyc) {
        setErrorKey(
          KYC_ERROR_KEYS[payload?.code ?? ""] ?? "player.kyc.error.submitFailed",
        );
        return;
      }

      setKyc(payload.kyc);
      setToast("player.kyc.submitted");
      router.refresh();
    } catch {
      setErrorKey("player.kyc.error.submitFailed");
    } finally {
      setBusy(false);
    }
  }

  const bannerText =
    status === "APPROVED"
      ? t("player.kyc.banner.approved")
      : status === "PENDING"
        ? t("player.kyc.banner.pending")
        : status === "REJECTED"
          ? t("player.kyc.banner.rejected", {
              reason: kyc?.rejectReason ?? "",
            })
          : t("player.kyc.banner.required");

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
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)] [-webkit-mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-brand/10 bg-[#050505]/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            {/* 顶栏品牌：Logo + 商户名，小字标出本页性质（实名认证） */}
            <TenantBrandLockup
              brandName={tenantName}
              logoUrl={tenantLogoUrl}
              size="md"
              tagline={t("player.kyc.eyebrow")}
              taglineClassName="block"
            />
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/player/profile"
              className="hidden h-9 items-center rounded-full border border-white/[0.08] px-4 text-[11px] font-semibold text-neutral-400 transition-colors hover:border-brand/30 hover:text-brand-soft sm:inline-flex"
            >
              {t("player.kyc.backToProfile")}
            </Link>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1100px] px-4 pb-16 pt-6 sm:px-6">
        <header>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-brand-soft/80">
            {t("player.kyc.eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-black text-neutral-50 sm:text-3xl">
            {t("player.kyc.title")}
          </h1>
          <p className="mt-1.5 text-xs leading-5 text-neutral-500">
            {t("player.kyc.subtitle")}
          </p>
        </header>

        <section className="mt-5 rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.08] via-[#0a0a0a] to-[#050505] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.24em] text-neutral-500">
                {playerName}
              </p>
              <p className="mt-1 text-sm font-semibold text-neutral-100">
                {bannerText}
              </p>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                STATUS_TONES[status] ?? STATUS_TONES.NONE
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {t(statusLabelKey(status))}
            </span>
          </div>

          {kyc?.rejectReason ? (
            <p className="mt-3 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] leading-5 text-red-200">
              {t("player.kyc.rejectedReason")}：{kyc.rejectReason}
            </p>
          ) : null}

          {kyc ? (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-neutral-500">
              <span>
                {t("player.kyc.submittedAt")}：
                {formatDate(kyc.submittedAt, locale)}
              </span>
              {kyc.reviewedAt ? (
                <span>
                  {t("player.kyc.reviewedAt")}：
                  {formatDate(kyc.reviewedAt, locale)}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        {toast ? (
          <p className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">
            {t(toast)}
          </p>
        ) : null}

        {errorKey ? (
          <p className="mt-3 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
            {t(errorKey)}
          </p>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="mt-4 rounded-2xl border border-white/[0.06] bg-[#080808]/80 p-4 sm:p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                {t("player.kyc.form.realName")}
              </span>
              <input
                type="text"
                value={realName}
                onChange={(event) => setRealName(event.target.value)}
                maxLength={64}
                disabled={!editable}
                placeholder={t("player.kyc.form.realNamePlaceholder")}
                autoComplete="name"
                className={INPUT_CLASS}
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                {t("player.kyc.form.idNumber")}
              </span>
              <input
                type="text"
                value={idNumber}
                onChange={(event) => setIdNumber(event.target.value)}
                maxLength={32}
                disabled={!editable}
                placeholder={t("player.kyc.form.idNumberPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <UploadField
              label={t("player.kyc.form.front")}
              url={frontUrl}
              disabled={!editable}
              busy={uploading === "front"}
              inputRef={frontInput}
              chooseLabel={t("player.kyc.form.chooseFile")}
              uploadingLabel={t("player.kyc.form.uploading")}
              onPick={(file) => void handleUpload("front", file)}
            />
            <UploadField
              label={t("player.kyc.form.back")}
              url={backUrl}
              disabled={!editable}
              busy={uploading === "back"}
              inputRef={backInput}
              chooseLabel={t("player.kyc.form.chooseFile")}
              uploadingLabel={t("player.kyc.form.uploading")}
              onPick={(file) => void handleUpload("back", file)}
            />
          </div>

          <p className="mt-3 text-[10px] leading-4 text-neutral-600">
            {t("player.kyc.form.fileHint")} · {t("player.kyc.form.privacy")}
          </p>

          <button
            type="submit"
            disabled={!editable || busy || uploading !== ""}
            className="mt-4 h-11 w-full rounded-xl bg-gradient-to-r from-brand-deep via-brand to-brand-soft text-xs font-bold text-brand-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? t("player.kyc.form.submitting")
              : status === "REJECTED"
                ? t("player.kyc.form.resubmit")
                : t("player.kyc.form.submit")}
          </button>
        </form>
      </main>
    </div>
  );
}

function UploadField({
  label,
  url,
  disabled,
  busy,
  inputRef,
  chooseLabel,
  uploadingLabel,
  onPick,
}: {
  label: string;
  url: string;
  disabled: boolean;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  chooseLabel: string;
  uploadingLabel: string;
  onPick: (file: File) => void;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
        {label}
      </p>

      <div className="mt-1.5 flex h-40 items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/[0.12] bg-black/40">
        {url ? (
          // 受控接口：/api/player/kyc/files/<key>，只有本人会话能读到
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span className="text-2xl text-neutral-700">+</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            onPick(file);
          }

          // 允许连续选择同一张图（否则第二次 change 不触发）
          event.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] text-[11px] font-semibold text-neutral-400 transition-colors hover:border-brand/30 hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? uploadingLabel : chooseLabel}
      </button>
    </div>
  );
}
