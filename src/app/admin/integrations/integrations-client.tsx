"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import type {
  IntegrationGatewayRow,
  IntegrationIpRow,
  IntegrationProviderRow,
  IntegrationSnapshot,
  IntegrationTenantRow,
} from "@/lib/integrations";

import { GameProvidersTab } from "./game-providers-tab";
import { GlobalSettingsTab } from "./global-settings-tab";
import { MerchantsTab } from "./merchants-tab";
import { PaymentGatewaysTab } from "./payment-gateways-tab";
import {
  INTEGRATION_TABS,
  INTEGRATION_TAB_LABEL_KEYS,
  type IntegrationBanner,
  type IntegrationTab,
} from "./types";

/** 重置密钥后要「只显示一次」的明文密钥。 */
type IssuedKey = {
  tenantId: string;
  tenantName: string;
  apiKey: string;
};

type IpWhitelistResponse = {
  success?: boolean;
  added?: number;
  duplicated?: number;
  invalid?: string[];
  ipWhitelist?: IntegrationIpRow[];
  error?: string;
};

type ResetKeyResponse = {
  success?: boolean;
  apiKey?: string;
  maskedKey?: string;
  apiKeyUpdatedAt?: string | null;
  error?: string;
};

type SendKeyResponse = {
  success?: boolean;
  email?: string;
  emailSent?: boolean;
  error?: string;
};

/**
 * API 集成中心页面外壳：四个页签（Global / Providers / Gateways / Merchants）。
 *
 * 页签切换只改 React state，不触发路由跳转，因此：
 *   - 已输入但未提交的内容（IP 白名单文本、搜索关键词）需要由这里持有，
 *     切页签再切回来不会丢；
 *   - 重置密钥后的明文、顶部横幅也只在这里渲染一次。
 *
 * 写操作全部集中在 shell：子页签只负责展示与回调，避免四个页签各写一套 fetch。
 */
export function IntegrationsClient({
  initialSnapshot,
  initialTab = "global",
}: {
  initialSnapshot: IntegrationSnapshot;
  /** 首屏页签：来自 ?tab= 深链接，缺省为全局设置。 */
  initialTab?: IntegrationTab;
}) {
  const router = useRouter();
  const { t } = useLanguage();

  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [tab, setTab] = useState<IntegrationTab>(initialTab);
  const [banner, setBanner] = useState<IntegrationBanner | null>(null);
  const [issuedKey, setIssuedKey] = useState<IssuedKey | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyTenant, setBusyTenant] = useState<string | null>(null);
  const [busyIp, setBusyIp] = useState<string | null>(null);
  const [ipInput, setIpInput] = useState("");
  const [ipNote, setIpNote] = useState("");
  const [addingIp, setAddingIp] = useState(false);

  /** 复制到剪贴板：失败时不静默，提示手动选中（http 环境没有 clipboard API）。 */
  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      setBanner({ type: "error", text: t("integrations.banner.copyFailed") });
    }
  }

  /** 重新拉取整份快照：任何写操作之后都调用，保证表格与白名单跟数据库一致。 */
  async function reload() {
    try {
      const response = await fetch("/api/admin/integrations", {
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace("/login?next=/admin/integrations");
        return;
      }

      const data = (await response.json().catch(() => null)) as
        | IntegrationSnapshot
        | null;

      if (!response.ok || !data) {
        setBanner({ type: "error", text: t("integrations.error.load") });
        return;
      }

      setSnapshot(data);
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    }
  }

  async function handleAddIps() {
    if (!ipInput.trim()) {
      setBanner({ type: "error", text: t("integrations.sectionB.invalid") });
      return;
    }

    setAddingIp(true);
    setBanner(null);

    try {
      const response = await fetch("/api/admin/integrations/ip-whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips: ipInput, note: ipNote }),
      });

      if (response.status === 401) {
        router.replace("/login?next=/admin/integrations");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as
        IpWhitelistResponse;

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("integrations.error.network"),
        });
        return;
      }

      if (data.ipWhitelist) {
        const nextWhitelist = data.ipWhitelist;
        setSnapshot((current) => ({ ...current, ipWhitelist: nextWhitelist }));
      }

      setIpInput("");
      setIpNote("");
      setBanner({
        type: "success",
        text: t("integrations.sectionB.result", {
          added: data.added ?? 0,
          duplicated: data.duplicated ?? 0,
          invalid: data.invalid?.length ?? 0,
        }),
      });
      void reload();
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    } finally {
      setAddingIp(false);
    }
  }

  async function handleRemoveIp(row: IntegrationIpRow) {
    if (!window.confirm(t("integrations.confirm.removeIp", { ip: row.ip }))) {
      return;
    }

    setBusyIp(row.id);
    setBanner(null);

    try {
      const response = await fetch(
        `/api/admin/integrations/ip-whitelist/${row.id}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("integrations.error.network"),
        });
        return;
      }

      setSnapshot((current) => ({
        ...current,
        ipWhitelist: current.ipWhitelist.filter((item) => item.id !== row.id),
      }));
      setBanner({
        type: "success",
        text: t("integrations.banner.ipRemoved", { ip: row.ip }),
      });
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    } finally {
      setBusyIp(null);
    }
  }

  async function handleResetKey(tenant: IntegrationTenantRow) {
    if (
      !window.confirm(t("integrations.confirm.resetKey", { name: tenant.name }))
    ) {
      return;
    }

    setBusyTenant(tenant.id);
    setBanner(null);

    try {
      const response = await fetch(
        `/api/admin/tenants/${tenant.id}/reset-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      if (response.status === 401) {
        router.replace("/login?next=/admin/integrations");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as
        ResetKeyResponse;

      if (!response.ok || !data.success || !data.apiKey) {
        setBanner({
          type: "error",
          text: data.error || t("integrations.error.network"),
        });
        return;
      }

      setIssuedKey({
        tenantId: tenant.id,
        tenantName: tenant.name,
        apiKey: data.apiKey,
      });
      setSnapshot((current) => ({
        ...current,
        tenants: current.tenants.map((item) =>
          item.id === tenant.id
            ? {
                ...item,
                maskedKey: data.maskedKey ?? item.maskedKey,
                hasKey: true,
                apiKeyUpdatedAt:
                  data.apiKeyUpdatedAt ?? new Date().toISOString(),
              }
            : item,
        ),
      }));
      setBanner({
        type: "success",
        text: t("integrations.banner.keyReset", { name: tenant.name }),
      });
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    } finally {
      setBusyTenant(null);
    }
  }

  async function handleSendKey(tenant: IntegrationTenantRow) {
    if (!tenant.contactEmail) {
      setBanner({ type: "error", text: t("integrations.error.noContactEmail") });
      return;
    }

    if (!tenant.hasKey) {
      setBanner({ type: "error", text: t("integrations.error.noKey") });
      return;
    }

    setBusyTenant(`send:${tenant.id}`);
    setBanner(null);

    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}/send-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.status === 401) {
        router.replace("/login?next=/admin/integrations");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as SendKeyResponse;

      if (!response.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || t("integrations.error.network"),
        });
        return;
      }

      if (data.emailSent) {
        setBanner({
          type: "success",
          text: t("integrations.banner.emailSent", {
            email: data.email ?? tenant.contactEmail,
          }),
        });
      } else {
        setBanner({
          type: "error",
          text: t("integrations.banner.emailFailed", {
            error: data.error ?? "-",
          }),
        });
      }
    } catch {
      setBanner({ type: "error", text: t("integrations.error.network") });
    } finally {
      setBusyTenant(null);
    }
  }

  /** 单个游戏商保存成功：先本地替换整行，再静默刷新一次快照。 */
  function handleProviderSaved(provider: IntegrationProviderRow) {
    setSnapshot((current) => ({
      ...current,
      providers: current.providers.map((item) =>
        item.id === provider.id ? provider : item,
      ),
    }));
    setBanner({
      type: "success",
      text: t("integrations.banner.providerSaved", { name: provider.name }),
    });
    void reload();
  }

  /** 商户资料保存成功（Backend IP / Wallet / 邮箱 / 回调地址）。 */
  function handleTenantSaved(tenant: IntegrationTenantRow) {
    setSnapshot((current) => ({
      ...current,
      tenants: current.tenants.map((item) =>
        item.id === tenant.id ? tenant : item,
      ),
    }));
    setBanner({
      type: "success",
      text: t("integrations.banner.contactSaved", { name: tenant.name }),
    });
    void reload();
  }

  /**
   * 支付通道配置保存成功（超管兜底修正：endpoint / 收款钱包 / 密钥 / 启停）。
   * 与游戏商一致：先本地替换整行，再静默刷新一次快照，保证统计数字同步。
   */
  function handleGatewaySaved(gateway: IntegrationGatewayRow) {
    setSnapshot((current) => ({
      ...current,
      gateways: current.gateways.map((item) =>
        item.id === gateway.id ? gateway : item,
      ),
    }));
    setBanner({
      type: "success",
      text: t("integrations.banner.gatewaySaved", { name: gateway.name }),
    });
    void reload();
  }

  const tabCounts: Record<IntegrationTab, number> = {
    global: snapshot.endpoints.length,
    providers: snapshot.providers.length,
    gateways: snapshot.gateways.length,
    merchants: snapshot.tenants.length,
  };

  return (
    <div>
      <header>
        <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
          <span className="h-px w-6 bg-[#d4af37]/60" />
          {t("integrations.eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("integrations.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
          {t("integrations.subtitle")}
        </p>
      </header>

      <nav
        role="tablist"
        aria-label={t("integrations.tabs.aria")}
        className="mt-5 flex gap-1.5 overflow-x-auto rounded-xl border border-[#d4af37]/10 bg-[#0a0a0a]/70 p-1.5"
      >
        {INTEGRATION_TABS.map((item) => {
          const active = item === tab;

          return (
            <button
              key={item}
              type="button"
              role="tab"
              id={`integration-tab-${item}`}
              aria-selected={active}
              aria-controls={`integration-panel-${item}`}
              onClick={() => setTab(item)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-gradient-to-r from-[#b8912f]/25 via-[#f0d27c]/20 to-[#b8912f]/25 text-[#f8e6ae] ring-1 ring-[#d4af37]/35"
                  : "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-200"
              }`}
            >
              {t(INTEGRATION_TAB_LABEL_KEYS[item])}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                  active
                    ? "bg-[#d4af37]/20 text-[#f0d27c]"
                    : "bg-white/[0.05] text-neutral-500"
                }`}
              >
                {tabCounts[item]}
              </span>
            </button>
          );
        })}
      </nav>

      {banner ? (
        <div
          role="status"
          className={`mt-4 rounded-xl border px-4 py-3 text-[11px] leading-5 ${
            banner.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-red-400/20 bg-red-400/[0.06] text-red-300"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      {/* 重置密钥后的明文：与「新增商户管理员」一致，只显示这一次 */}
      {issuedKey ? (
        <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-4 py-3.5">
          <p className="text-xs font-semibold text-emerald-200">
            {t("integrations.reset.title", { name: issuedKey.tenantName })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="select-all break-all rounded-lg border border-emerald-400/20 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-emerald-100">
              {issuedKey.apiKey}
            </code>
            <button
              type="button"
              onClick={() =>
                void copyText(`issued:${issuedKey.tenantId}`, issuedKey.apiKey)
              }
              className="h-8 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 text-[10px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/20"
            >
              {copiedId === `issued:${issuedKey.tenantId}`
                ? t("integrations.sectionA.copied")
                : t("integrations.reset.copy")}
            </button>
            <button
              type="button"
              onClick={() => setIssuedKey(null)}
              className="h-8 rounded-lg border border-white/10 px-3 text-[10px] font-medium text-neutral-400 transition-colors hover:border-white/20 hover:text-neutral-200"
            >
              {t("integrations.reset.dismiss")}
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-emerald-300/80">
            {t("integrations.reset.hint")}
          </p>
        </div>
      ) : null}

      <div
        className="mt-5"
        role="tabpanel"
        id={`integration-panel-${tab}`}
        aria-labelledby={`integration-tab-${tab}`}
      >

        {tab === "global" ? (
          <GlobalSettingsTab
            baseUrl={snapshot.baseUrl}
            endpoints={snapshot.endpoints}
            ipWhitelist={snapshot.ipWhitelist}
            copiedId={copiedId}
            onCopy={(id, text) => void copyText(id, text)}
            ipInput={ipInput}
            ipNote={ipNote}
            onIpInputChange={setIpInput}
            onIpNoteChange={setIpNote}
            addingIp={addingIp}
            onAddIps={() => void handleAddIps()}
            busyIp={busyIp}
            onRemoveIp={(row) => void handleRemoveIp(row)}
          />
        ) : null}

        {tab === "providers" ? (
          <GameProvidersTab
            providers={snapshot.providers}
            onSaved={handleProviderSaved}
          />
        ) : null}

        {tab === "gateways" ? (
          <PaymentGatewaysTab
            gateways={snapshot.gateways}
            merchantCount={snapshot.tenants.length}
            onSaved={handleGatewaySaved}
          />
        ) : null}

        {tab === "merchants" ? (
          <MerchantsTab
            tenants={snapshot.tenants}
            busyTenant={busyTenant}
            onResetKey={(tenant) => void handleResetKey(tenant)}
            onSendKey={(tenant) => void handleSendKey(tenant)}
            onSaved={handleTenantSaved}
          />
        ) : null}
      </div>
    </div>
  );
}
