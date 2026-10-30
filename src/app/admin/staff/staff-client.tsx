"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import {
  PERMISSION_LABEL_KEYS,
  STAFF_ROLE_HINT_KEYS,
  STAFF_ROLE_LABEL_KEYS,
} from "@/lib/i18n-keys";
import { ROLE_PERMISSIONS, type StaffRole } from "@/lib/rbac";

import { StaffFormModal } from "./staff-form-modal";
import { STAFF_ROLE_OPTIONS, type StaffRow } from "./types";

function roleBadgeClass(role: StaffRole) {
  if (role === "super_admin") {
    return "border-[#d4af37]/30 bg-[#d4af37]/10 text-[#f0d27c]";
  }

  if (role === "finance") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  }

  if (role === "tech") {
    return "border-sky-400/25 bg-sky-400/10 text-sky-300";
  }

  return "border-neutral-400/25 bg-white/[0.04] text-neutral-300";
}

export function StaffClient({
  initialStaff,
  currentUserId,
}: {
  initialStaff: StaffRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [staff, setStaff] = useState(initialStaff);
  const [modal, setModal] = useState<{
    mode: "create" | "edit";
    member?: StaffRow;
  } | null>(null);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleSaved(saved: StaffRow, mode: "create" | "edit") {
    setStaff((current) => {
      const exists = current.some((member) => member.id === saved.id);

      if (!exists) {
        return [...current, saved];
      }

      return current.map((member) =>
        member.id === saved.id ? saved : member,
      );
    });
    setBanner({
      type: "success",
      text:
        mode === "create" ? t("staff.banner.created") : t("staff.banner.saved"),
    });
    setModal(null);
    router.refresh();
  }

  async function handleDelete(member: StaffRow) {
    const confirmed = window.confirm(
      t("staff.confirm.delete", { name: member.username }),
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(member.id);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/staff/${member.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (response.status === 401) {
        router.replace("/login?next=/admin/staff");
        return;
      }

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("staff.error.deleteFailed"),
        });
        return;
      }

      setStaff((current) =>
        current.filter((item) => item.id !== member.id),
      );
      setBanner({
        type: "success",
        text: t("staff.banner.deleted", { name: member.username }),
      });
      router.refresh();
    } catch {
      setBanner({ type: "error", text: t("staff.error.deleteNetwork") });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("staff.header.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("staff.header.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            {t("staff.header.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          data-staff-action="create"
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 sm:self-auto"
        >
          <span className="text-base leading-none">+</span>
          {t("staff.actions.create")}
        </button>
      </header>

      {banner ? (
        <div
          role="status"
          className={`mt-5 rounded-xl border px-4 py-3 text-[11px] leading-5 ${
            banner.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-red-400/20 bg-red-400/[0.06] text-red-300"
          }`}
        >
          {banner.text}
        </div>
      ) : null}



      {/* 权限矩阵：授权前先看清每个角色能进哪些页面 / 调哪些接口 */}
      <section className="mt-5 rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#d4af37]/70">
            {t("staff.matrix.title")}
          </h2>
          <p className="text-[10px] text-neutral-600">
            {t("staff.matrix.hint")}
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STAFF_ROLE_OPTIONS.map((role) => (
            <div
              key={role}
              data-staff-matrix-role={role}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${roleBadgeClass(role)}`}
                >
                  {t(STAFF_ROLE_LABEL_KEYS[role])}
                </span>
                <span className="font-mono text-[9px] text-neutral-700">
                  {ROLE_PERMISSIONS[role].length}
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-5 text-neutral-500">
                {t(STAFF_ROLE_HINT_KEYS[role])}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {ROLE_PERMISSIONS[role].map((permission) => (
                  <span
                    key={permission}
                    className="rounded-md border border-[#d4af37]/12 bg-[#d4af37]/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-neutral-400"
                  >
                    {t(PERMISSION_LABEL_KEYS[permission])}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>


      <section className="mt-5 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3.5 font-medium">
                  {t("staff.table.username")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("staff.table.role")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("staff.table.createdAt")}
                </th>
                <th className="px-5 py-3.5 text-right font-medium">
                  {t("staff.table.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-5 py-12 text-center text-xs text-neutral-600"
                  >
                    {t("staff.table.empty")}
                  </td>
                </tr>
              ) : (
                staff.map((member) => {
                  const deleting = deletingId === member.id;
                  const isSelf = member.id === currentUserId;

                  return (
                    <tr
                      key={member.id}
                      data-staff-username={member.username}
                      data-staff-role={member.role}
                      className="border-b border-white/[0.04] text-xs transition-colors last:border-b-0 hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d4af37]/25 bg-[#d4af37]/10 text-[10px] font-semibold text-[#f0d27c]">
                            {member.username.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="font-mono text-[11px] text-neutral-200">
                            {member.username}
                          </span>
                          {isSelf ? (
                            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] text-emerald-300">
                              {t("staff.table.self")}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${roleBadgeClass(member.role)}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {t(STAFF_ROLE_LABEL_KEYS[member.role])}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[10px] text-neutral-600">
                        {formatDate(member.createdAt, locale)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setModal({ mode: "edit", member })}
                            disabled={deleting}
                            data-staff-action="edit"
                            className="inline-flex h-8 items-center rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 text-[10px] text-[#f0d27c] transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 disabled:opacity-50"
                          >
                            {t("staff.actions.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(member)}
                            disabled={deleting || isSelf}
                            title={
                              isSelf ? t("staff.error.selfDelete") : undefined
                            }
                            data-staff-action="delete"
                            className="inline-flex h-8 items-center rounded-lg border border-red-400/20 px-3 text-[10px] text-red-300 transition-colors hover:border-red-400/40 hover:bg-red-400/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {deleting
                              ? t("common.deleting")
                              : t("common.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d4af37]/10 px-5 py-3 text-[10px] text-neutral-600">
          <span>{t("staff.footer.count", { count: staff.length })}</span>
          <span>{t("staff.footer.security")}</span>
        </div>
      </section>

      {modal ? (
        <StaffFormModal
          mode={modal.mode}
          member={modal.member}
          lockRole={modal.member?.id === currentUserId}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
