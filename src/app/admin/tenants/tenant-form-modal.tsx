"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useLanguage } from "@/components/LanguageProvider";

import {
  TENANT_STATUS_OPTIONS,
  WITHDRAWAL_APPROVAL_OPTIONS,
  type TenantFormValues,
  type TenantMutationResponse,
  type TenantRow,
} from "./types";

export function TenantFormModal({
  mode,
  tenant,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  tenant?: TenantRow;
  onClose: () => void;
  onSaved: (tenant: TenantRow) => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<TenantFormValues>({
    name: tenant?.name ?? "",
    domain: tenant?.domain ?? "",
    subdomain: tenant?.subdomain ?? "",
    status: tenant?.status ?? "active",
    withdrawalRequiredApprovals:
      tenant?.withdrawalRequiredApprovals ?? 1,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, submitting]);

  function updateField<Key extends keyof TenantFormValues>(
    field: Key,
    value: TenantFormValues[Key],
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const name = form.name.trim();
    const domain = form.domain.trim();
    const subdomain = form.subdomain.trim();

    if (!name || !domain || !subdomain) {
      setError(t("tenants.form.error.required"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        mode === "create"
          ? "/api/admin/tenants"
          : `/api/admin/tenants/${tenant?.id}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            domain,
            subdomain,
            ...(mode === "edit"
              ? {
                  status: form.status,
                  withdrawalRequiredApprovals:
                    form.withdrawalRequiredApprovals,
                }
              : {
                  withdrawalRequiredApprovals:
                    form.withdrawalRequiredApprovals,
                }),
          }),
        },
      );
      const data: TenantMutationResponse = await response
        .json()
        .catch(() => ({}) as TenantMutationResponse);

      if (response.status === 401) {
        router.replace("/login?next=/admin/tenants");
        return;
      }

      if (!response.ok || !data.success || !data.tenant) {
        setError(data.error || t("tenants.form.error.saveFailed"));
        return;
      }

      onSaved(data.tenant);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label={t("tenants.form.backdropAria")}
        onClick={onClose}
        disabled={submitting}
        className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f0d27c]/80 to-transparent" />
        <form onSubmit={handleSubmit}>
          <div className="max-h-[80vh] overflow-y-auto px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] uppercase tracking-[0.22em] text-[#d4af37]/60">
                  {t("tenants.form.eyebrow")}
                </p>
                <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
                  {mode === "create"
                    ? t("tenants.form.createTitle")
                    : t("tenants.form.editTitle")}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-white/20 hover:text-neutral-200 disabled:opacity-50"
                aria-label={t("common.close")}
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenants.form.name")}
                </span>
                <input
                  ref={nameRef}
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  maxLength={80}
                  placeholder={t("tenants.form.namePlaceholder")}
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("tenants.form.domain")}
                  </span>
                  <input
                    value={form.domain}
                    onChange={(event) =>
                      updateField("domain", event.target.value)
                    }
                    placeholder="example.com"
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("tenants.form.subdomain")}
                  </span>
                  <input
                    value={form.subdomain}
                    onChange={(event) =>
                      updateField("subdomain", event.target.value)
                    }
                    placeholder="winvora"
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                  />
                </label>
              </div>


              <div className="grid gap-4 sm:grid-cols-2">
                {mode === "edit" ? (
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("tenants.form.status")}
                    </span>
                    <select
                      value={form.status}
                      onChange={(event) =>
                        updateField("status", event.target.value)
                      }
                      className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                    >
                      {TENANT_STATUS_OPTIONS.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          className="bg-[#0a0a0a]"
                        >
                          {t(option.labelKey)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("tenants.form.approvals")}
                  </span>
                  <select
                    value={form.withdrawalRequiredApprovals}
                    onChange={(event) =>
                      updateField(
                        "withdrawalRequiredApprovals",
                        Number(event.target.value),
                      )
                    }
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                  >
                    {WITHDRAWAL_APPROVAL_OPTIONS.map((value) => (
                      <option key={value} value={value} className="bg-[#0a0a0a]">
                        {t("tenants.form.approvers", { count: value })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-[11px] leading-5 text-red-300">
                  <span className="mt-0.5">!</span>
                  <span>{error}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-[#d4af37]/10 bg-[#080808]/80 px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-10 rounded-xl border border-white/[0.08] px-4 text-xs text-neutral-400 transition-colors hover:border-[#d4af37]/20 hover:text-neutral-200 disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? t("common.saving")
                : mode === "create"
                  ? t("tenants.form.createSubmit")
                  : t("tenants.form.saveSubmit")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

