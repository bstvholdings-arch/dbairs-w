"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";

import { useLanguage } from "@/components/LanguageProvider";
import {
  buildThemeBackgroundStyle,
  DEFAULT_THEME_BACKGROUND,
  normalizeThemeBackground,
  THEME_BACKGROUNDS,
  THEME_BACKGROUND_ORDER,
  THEME_BACKGROUND_PREVIEW_PATH,
} from "@/lib/theme-backgrounds";
import { isValidTenantAdminEmail } from "@/lib/tenant-admin-email";
import {
  MAX_BACKUP_DOMAINS,
  formatBackupDomains,
  readBackupDomainsInput,
} from "@/lib/tenant-domains";

import {
  TENANT_STATUS_OPTIONS,
  WITHDRAWAL_APPROVAL_OPTIONS,
  type TenantAdminProvisionInfo,
  type TenantFormValues,
  type TenantMutationResponse,
  type TenantRow,
} from "./types";

/** 新增管理员成功后要「只显示一次」的凭据。 */
type IssuedCredentials = {
  username: string;
  email: string;
  password: string;
};

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
    // 备用域名池：进输入框时一行一个，提交前再归一化成数组
    backupDomains: formatBackupDomains(tenant?.backupDomains ?? []),
    status: tenant?.status ?? "active",
    withdrawalRequiredApprovals:
      tenant?.withdrawalRequiredApprovals ?? 1,
    // 老租户 / 脏数据统一回落到经典暗黑（= 改造前的大厅观感）
    themeBackground: tenant?.themeBackground ?? DEFAULT_THEME_BACKGROUND,
    adminEmail: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 保存成功但还需要用户确认（有凭据要抄 / 有提示要看）时，按钮变成「完成」。
  const [credentials, setCredentials] = useState<IssuedCredentials | null>(
    null,
  );
  const [adminNotice, setAdminNotice] = useState<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);
  // 开通邮件是否送达（发信失败不影响账号创建，靠这条提示引导超管手动转达）。
  const [emailNotice, setEmailNotice] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedDone, setSavedDone] = useState(false);

  // 当前选中的主题背景色（单选框下方的实时预览与说明都用它）。
  // 走 normalizeThemeBackground 兜底：万一数据脏了也只会退回经典暗黑，不会白屏。
  const selectedBackgroundId = normalizeThemeBackground(form.themeBackground);

  // 备用域名池的实时计数：格式不合法时按 0 显示（不误导成「已经填了 3 条」）
  const parsedBackupDomains = readBackupDomainsInput(form.backupDomains);
  const backupDomainCount = parsedBackupDomains.ok
    ? parsedBackupDomains.domains.length
    : 0;

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

  /** 复制「账号 + 密码」，方便老板直接发给商户。 */
  async function copyCredentials() {
    if (!credentials) {
      return;
    }

    const lines = [
      `${t("tenants.form.adminUsername")}: ${credentials.username}`,
      `${t("tenants.form.adminEmailLabel")}: ${credentials.email}`,
      `${t("tenants.form.adminTempPassword")}: ${credentials.password}`,
      `${t("tenants.form.adminLogin")}: /login`,
    ];

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const name = form.name.trim();
    const domain = form.domain.trim();
    const subdomain = form.subdomain.trim();
    // 新增租户时管理员邮箱是必填：后端用它创建 tenant_admin 账号并发送登录邮件。
    const adminEmail = form.adminEmail.trim();

    if (!name || !domain || !subdomain) {
      setError(t("tenants.form.error.required"));
      return;
    }

    if (!adminEmail && mode === "create") {
      setError(t("tenants.form.error.adminEmailRequired"));
      return;
    }

    if (adminEmail && !isValidTenantAdminEmail(adminEmail)) {
      setError(t("tenants.form.error.adminEmailInvalid"));
      return;
    }

    // 备用域名池：格式 / 数量先在前端拦一次（服务端还会再校验 + 查跨租户唯一性）。
    // 自己的主域名 / 子域名会被静默剔除，与后端 reserved 口径一致。
    const backupDomainsInput = readBackupDomainsInput(form.backupDomains, {
      reserved: [domain, subdomain],
    });

    if (!backupDomainsInput.ok) {
      setError(backupDomainsInput.error);
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
            backupDomains: backupDomainsInput.domains,
            adminEmail,
            withdrawalRequiredApprovals: form.withdrawalRequiredApprovals,
            // 主题背景色：只有这里能写（商户后台与装修页均无入口）
            themeBackground: normalizeThemeBackground(form.themeBackground),
            // 新建租户一律为 active（后端默认值），只有编辑时才提交状态。
            ...(mode === "edit" ? { status: form.status } : {}),
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

      const provision: TenantAdminProvisionInfo | undefined =
        data.tenantAdmin;

      if (provision?.status === "created" && provision.temporaryPassword) {
        // 明文临时密码只在这里出现一次：必须停下来让老板抄走。
        setCredentials({
          username: provision.username ?? "",
          email: provision.email ?? form.adminEmail.trim(),
          password: provision.temporaryPassword,
        });
        setEmailNotice({
          ok: provision.emailSent === true,
          error: provision.emailError,
        });
        setAdminNotice(null);
        setSavedDone(true);
        return;
      }

      if (provision && provision.status !== "created") {
        setEmailNotice(null);
        setAdminNotice({
          tone: provision.status === "exists" ? "success" : "warning",
          text:
            provision.message ??
            (provision.username
              ? t("tenants.form.adminExists", {
                  username: provision.username,
                })
              : t("tenants.form.error.saveFailed")),
        });
        setCredentials(null);
        setSavedDone(true);
        return;
      }

      onClose();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  // 弹窗通过 portal 挂到 document.body。
  // 后台布局里有 sticky 头部与滚动容器，只要有一个祖先元素带 transform / filter /
  // backdrop-blur（会生成 containing block），直接 fixed 的弹窗就会被裁切、或被
  // 后绘制出来的元素盖住，表现形式就是「弹窗里的下拉框点不动」。
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8">
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

            {/* 新建管理员成功：凭据只显示这一次，必须让老板先抄走 */}
            {credentials ? (
              <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-3.5 py-3 text-[11px] leading-5 text-emerald-200">
                <p className="text-xs font-semibold">
                  {t("tenants.form.adminCreated")}
                </p>
                <dl className="mt-2 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <dt className="text-[9px] uppercase tracking-[0.16em] text-emerald-300/70">
                      {t("tenants.form.adminUsername")}
                    </dt>
                    <dd className="select-all font-mono text-emerald-100">
                      {credentials.username}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <dt className="text-[9px] uppercase tracking-[0.16em] text-emerald-300/70">
                      {t("tenants.form.adminEmailLabel")}
                    </dt>
                    <dd className="select-all font-mono text-emerald-100">
                      {credentials.email}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <dt className="text-[9px] uppercase tracking-[0.16em] text-emerald-300/70">
                      {t("tenants.form.adminTempPassword")}
                    </dt>
                    <dd className="select-all font-mono text-emerald-100">
                      {credentials.password}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-emerald-300/80">
                  {t("tenants.form.adminPasswordNote")}
                </p>
                {emailNotice ? (
                  <p
                    className={`mt-1 ${
                      emailNotice.ok ? "text-emerald-300/80" : "text-amber-200"
                    }`}
                  >
                    {emailNotice.ok
                      ? t("tenants.form.adminEmailSent", {
                          email: credentials.email,
                        })
                      : t("tenants.form.adminEmailFailed", {
                          error: emailNotice.error ?? "-",
                        })}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyCredentials()}
                    className="h-8 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 text-[10px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/20"
                  >
                    {copied
                      ? t("tenants.form.adminCopied")
                      : t("tenants.form.adminCopy")}
                  </button>
                  <span className="font-mono text-[10px] text-emerald-300/70">
                    {t("tenants.form.adminLogin")}: /tenant/login
                  </span>
                </div>
              </div>
            ) : null}

            {adminNotice ? (
              <div
                className={`mt-4 rounded-xl border px-3.5 py-3 text-[11px] leading-5 ${
                  adminNotice.tone === "success"
                    ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-200"
                    : "border-amber-400/25 bg-amber-400/[0.06] text-amber-200"
                }`}
              >
                {adminNotice.text}
              </div>
            ) : null}

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

              {/* 多域名防封：备用域名池（玩家端 <DomainGuard /> 会按这个顺序自动切换线路） */}
              <label className="block">
                <span className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("tenants.form.backupDomains")}
                  <span className="font-mono normal-case tracking-normal text-neutral-700">
                    {t("tenants.form.backupDomainsCount", {
                      count: backupDomainCount,
                      max: MAX_BACKUP_DOMAINS,
                    })}
                  </span>
                </span>
                <textarea
                  value={form.backupDomains}
                  onChange={(event) =>
                    updateField("backupDomains", event.target.value)
                  }
                  rows={3}
                  spellCheck={false}
                  placeholder={t("tenants.form.backupDomainsPlaceholder")}
                  className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm leading-6 text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                />
                <span className="mt-1.5 block text-[10px] leading-5 text-neutral-600">
                  {t("tenants.form.backupDomainsHint")}
                </span>
              </label>

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

              {/* 主题背景色（Theme Background Color，15 选 1）：只在开站 / 编辑租户时可配。
                  商户后台与装修页都没有入口 —— 撤销商户自助切换是产品决策。
                  永远深色底：颜色只作用于环境光与卡片外框 / 文字底板描边。 */}
              <div
                className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-3.5"
                data-tenant-theme-background
                data-theme-background-selected={selectedBackgroundId}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("tenants.form.themeBackground")}
                  </span>
                  <span
                    className="text-[10px] text-[#f0d27c]"
                    data-theme-background-current
                  >
                    {t(THEME_BACKGROUNDS[selectedBackgroundId].labelKey)}
                  </span>
                </div>

                {/*
                  15 种主题色用「单选色卡」而不是原生 <select>：
                  - 原生下拉需要浏览器弹层，弹层被上层元素遮挡 / 被 portal 裁切时
                    表现就是「点了没反应」，且展开后看不到配色；
                  - 每张色卡常显 2 个色点（深色底 + 点缀色，与前台同源），
                    点一下立即高亮 + 下方实时预览跟着变，选择结果一眼可见；
                  - 用真实 <input type="radio">：鼠标、触屏、键盘（方向键）都能切换，
                    onChange 由浏览器保证触发，不依赖自定义弹层。
                */}
                <div
                  role="radiogroup"
                  aria-label={t("tenants.form.themeBackground")}
                  className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3"
                >
                  {THEME_BACKGROUND_ORDER.map((id) => {
                    const option = THEME_BACKGROUNDS[id];
                    const active = selectedBackgroundId === id;

                    return (
                      <label
                        key={id}
                        data-theme-background-option={id}
                        data-theme-background-active={
                          active ? "true" : "false"
                        }
                        className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-[#d4af37]/60 ${
                          active
                            ? "border-[#d4af37]/60 bg-[#d4af37]/[0.08]"
                            : "border-white/[0.08] bg-black/30 hover:border-white/20"
                        }`}
                      >
                        <input
                          type="radio"
                          name="themeBackground"
                          value={id}
                          checked={active}
                          onChange={() => updateField("themeBackground", id)}
                          className="sr-only"
                        />
                        <span
                          className="flex shrink-0 items-center gap-0.5"
                          aria-hidden="true"
                        >
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/18"
                            style={{ backgroundColor: option.base }}
                          />
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/18"
                            style={{ backgroundColor: option.accent }}
                          />
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-[10px] leading-4 ${active ? "font-semibold text-[#f0d27c]" : "text-neutral-400"}`}
                        >
                          {t(option.labelKey)}
                        </span>
                        <span
                          className={`text-[9px] ${active ? "text-[#f0d27c]" : "text-transparent"}`}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                      </label>
                    );
                  })}
                </div>

                {/* 实时预览：直接把选中的主题色套到前台同一套 .tb-* class 上，
                    深色底 + 呼吸光晕 + 卡片外框 / 文字底板描边都是真实渲染结果。 */}
                <div
                  className="tb-lobby-bg relative mt-2 flex items-center gap-3 overflow-hidden rounded-lg border border-white/[0.08] p-2.5"
                  style={
                    buildThemeBackgroundStyle(selectedBackgroundId) as CSSProperties
                  }
                  data-theme-background-preview={selectedBackgroundId}
                >
                  <span
                    aria-hidden="true"
                    className="tb-aura -left-6 -top-8 h-24 w-24"
                  />
                  <span
                    aria-hidden="true"
                    className="tb-card relative block h-[62px] w-[46px] shrink-0 overflow-hidden rounded-lg bg-[#05070c]"
                  >
                    <span className="tb-card__plate absolute inset-x-0 bottom-0 flex flex-col gap-0.5 px-1 py-0.5">
                      <span className="tb-card__name block truncate text-[6px] font-black uppercase leading-none">
                        DEMO
                      </span>
                      <span className="tb-card__provider inline-flex self-start rounded px-1 text-[5px] font-black uppercase italic leading-none">
                        PG
                      </span>
                    </span>
                  </span>
                  <span className="relative min-w-0">
                    <span className="block text-[11px] font-semibold text-neutral-200">
                      {t(THEME_BACKGROUNDS[selectedBackgroundId].labelKey)}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-neutral-500">
                      {t("tenants.form.themeBackgroundHint")}
                    </span>
                  </span>
                </div>

                <p className="mt-2 text-[10px] leading-4 text-neutral-600">
                  {t("tenants.form.themeBackgroundNote")}
                </p>

                <Link
                  href={THEME_BACKGROUND_PREVIEW_PATH}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex h-7 items-center rounded-lg border border-white/[0.08] px-2.5 text-[10px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
                >
                  {t("tenants.form.themeBackgroundPreview")}
                </Link>
              </div>

              {/* 新增租户必填：保存时自动建 tenant_admin 账号并把凭据发到该邮箱 */}
              <div className="rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.04] p-3.5">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                    {t("tenants.form.adminEmail")}
                    {mode === "create" ? (
                      <span className="ml-1 text-red-300/80" aria-hidden="true">
                        *
                      </span>
                    ) : null}
                  </span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    required={mode === "create"}
                    value={form.adminEmail}
                    onChange={(event) =>
                      updateField("adminEmail", event.target.value)
                    }
                    maxLength={120}
                    placeholder={t("tenants.form.adminEmailPlaceholder")}
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-sm text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30"
                  />
                </label>
                <p className="mt-1.5 text-[10px] leading-4 text-neutral-600">
                  {mode === "create"
                    ? t("tenants.form.adminEmailHintCreate")
                    : t("tenants.form.adminEmailHint")}
                </p>
                {tenant && tenant.admins.length > 0 ? (
                  <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                    {t("tenants.form.adminExisting", {
                      accounts: tenant.admins
                        .map((admin) => admin.email ?? admin.username)
                        .join("、"),
                    })}
                  </p>
                ) : null}
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
            {savedDone ? (
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-5 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90"
              >
                {t("tenants.form.done")}
              </button>
            ) : (
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
            )}
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

