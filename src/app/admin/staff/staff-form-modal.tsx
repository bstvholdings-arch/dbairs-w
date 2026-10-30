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
import { STAFF_ROLE_HINT_KEYS, STAFF_ROLE_LABEL_KEYS } from "@/lib/i18n-keys";

import {
  STAFF_PASSWORD_MAX_LENGTH,
  STAFF_PASSWORD_MIN_LENGTH,
  STAFF_ROLE_OPTIONS,
  STAFF_USERNAME_PATTERN,
  type StaffFormValues,
  type StaffMutationResponse,
  type StaffRow,
} from "./types";

/**
 * 新增 / 编辑员工弹窗。
 * - 新增：用户名 + 密码 + 角色
 * - 编辑：角色可改（改自己时锁定），密码留空表示不修改
 */
export function StaffFormModal({
  mode,
  member,
  lockRole = false,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  member?: StaffRow;
  /** 编辑自己时锁定角色：服务端同样会拒绝「修改自己的角色」。 */
  lockRole?: boolean;
  onClose: () => void;
  onSaved: (saved: StaffRow, mode: "create" | "edit") => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const titleId = useId();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<StaffFormValues>({
    username: member?.username ?? "",
    password: "",
    role: member?.role ?? "support",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      usernameRef.current?.focus();
      usernameRef.current?.select();
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

  function updateField<Key extends keyof StaffFormValues>(
    field: Key,
    value: StaffFormValues[Key],
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const username = form.username.trim();

    if (mode === "create" && !STAFF_USERNAME_PATTERN.test(username)) {
      setError(t("staff.form.error.username"));
      return;
    }

    if (form.password.length > 0) {
      if (
        form.password.length < STAFF_PASSWORD_MIN_LENGTH ||
        form.password.length > STAFF_PASSWORD_MAX_LENGTH
      ) {
        setError(
          t("staff.form.error.password", {
            min: STAFF_PASSWORD_MIN_LENGTH,
            max: STAFF_PASSWORD_MAX_LENGTH,
          }),
        );
        return;
      }
    } else if (mode === "create") {
      setError(
        t("staff.form.error.password", {
          min: STAFF_PASSWORD_MIN_LENGTH,
          max: STAFF_PASSWORD_MAX_LENGTH,
        }),
      );
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        mode === "create"
          ? "/api/admin/staff"
          : `/api/admin/staff/${member?.id}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "create"
              ? { username, password: form.password, role: form.role }
              : {
                  role: form.role,
                  ...(form.password ? { password: form.password } : {}),
                },
          ),
        },
      );
      const data: StaffMutationResponse = await response
        .json()
        .catch(() => ({}) as StaffMutationResponse);

      if (response.status === 401) {
        router.replace("/login?next=/admin/staff");
        return;
      }

      if (!response.ok || !data.success || !data.staff) {
        setError(data.error || t("staff.form.error.saveFailed"));
        return;
      }

      onSaved(data.staff, mode);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-3 py-6 backdrop-blur-sm sm:items-center">
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={() => {
          if (!submitting) {
            onClose();
          }
        }}
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-staff-modal={mode}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-[#0a0a0a] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
        <form onSubmit={handleSubmit}>
          <div className="flex items-start justify-between gap-3 border-b border-[#d4af37]/10 px-5 py-4">
            <div>
              <p className="text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/70">
                {t("staff.form.eyebrow")}
              </p>
              <h2
                id={titleId}
                className="mt-1.5 text-base font-semibold text-white"
              >
                {mode === "create"
                  ? t("staff.form.createTitle")
                  : t("staff.form.editTitle")}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-200 disabled:opacity-50"
            >
              ×
            </button>
          </div>

          <div className="space-y-4 px-5 py-5">
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("staff.form.username")}
              </span>
              <input
                ref={usernameRef}
                type="text"
                name="username"
                value={form.username}
                onChange={(event) =>
                  updateField("username", event.target.value)
                }
                disabled={mode === "edit"}
                autoComplete="off"
                placeholder={t("staff.form.usernamePlaceholder")}
                className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-sm text-neutral-200 outline-none transition-colors placeholder:font-sans placeholder:text-neutral-600 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 disabled:cursor-not-allowed disabled:text-neutral-500"
              />
              <span className="mt-1.5 block text-[10px] leading-4 text-neutral-600">
                {mode === "create"
                  ? t("staff.form.usernameHint")
                  : t("staff.form.usernameLocked")}
              </span>
            </label>

            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("staff.form.password")}
              </span>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={(event) =>
                  updateField("password", event.target.value)
                }
                autoComplete="new-password"
                placeholder={t("staff.form.passwordPlaceholder", {
                  min: STAFF_PASSWORD_MIN_LENGTH,
                })}
                className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
              />
              <span className="mt-1.5 block text-[10px] leading-4 text-neutral-600">
                {mode === "create"
                  ? t("staff.form.passwordCreateHint", {
                      min: STAFF_PASSWORD_MIN_LENGTH,
                      max: STAFF_PASSWORD_MAX_LENGTH,
                    })
                  : t("staff.form.passwordEditHint")}
              </span>
            </label>


            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("staff.form.role")}
              </span>
              <select
                value={form.role}
                onChange={(event) =>
                  updateField(
                    "role",
                    event.target.value as StaffFormValues["role"],
                  )
                }
                disabled={lockRole}
                className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-neutral-200 outline-none transition-colors focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 disabled:cursor-not-allowed disabled:text-neutral-500"
              >
                {STAFF_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role} className="bg-[#0a0a0a]">
                    {t(STAFF_ROLE_LABEL_KEYS[role])}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[10px] leading-4 text-neutral-600">
                {lockRole
                  ? t("staff.form.roleLocked")
                  : t(STAFF_ROLE_HINT_KEYS[form.role])}
              </span>
            </label>

            {error ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-[11px] leading-5 text-red-300">
                <span className="mt-0.5">!</span>
                <span>{error}</span>
              </div>
            ) : null}
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
              data-staff-submit={mode}
              className="h-10 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? t("common.saving")
                : mode === "create"
                  ? t("staff.form.createSubmit")
                  : t("staff.form.saveSubmit")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

