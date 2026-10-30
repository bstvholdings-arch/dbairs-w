"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { formatDate } from "@/lib/format";
import { LOBBY_CATEGORY_LABEL_KEYS } from "@/lib/i18n-keys";
import { normalizeGameCategory } from "@/lib/lobby-games";

import type {
  AdminGameRow,
  AdminProviderOption,
  Banner,
  GameListResponse,
  GameMutationResponse,
  GameSyncResponse,
} from "./types";

/**
 * 游戏库管理：控制单款游戏的排序权重与上下架。
 * 排序口径与前台大厅一致（sortOrder 越大越靠前）。
 *
 * 数据流：表格数据以客户端 /api/admin/games 为准。
 * 切换游戏商、上下架、改排序、同步之后都会重新拉一次列表，
 * 避免出现「URL 已经变了但表格还是旧数据」的情况。
 */

/** 仅开发环境打印调试日志（生产构建会把这个常量折叠成 false）。 */
const DEBUG = process.env.NODE_ENV !== "production";

function debug(...args: unknown[]) {
  if (DEBUG) {
    console.log("[admin/games]", ...args);
  }
}

export function GamesClient({
  initialGames,
  providers,
  activeProviderId,
  unresolvedProviderId = null,
}: {
  initialGames: AdminGameRow[];
  providers: AdminProviderOption[];
  activeProviderId: string | null;
  /** URL 里带了 providerId 但匹配不到任何游戏商时传入原始值，用于提示。 */
  unresolvedProviderId?: string | null;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const filterLabelId = useId();
  const [games, setGames] = useState(initialGames);
  const [filterId, setFilterId] = useState<string | null>(activeProviderId);
  const [banner, setBanner] = useState<Banner | null>(() =>
    unresolvedProviderId
      ? {
          type: "error",
          text: t("games.error.providerNotFound", {
            providerId: unresolvedProviderId,
          }),
        }
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  // 请求序号：快速切换游戏商时丢弃过期响应，避免旧数据覆盖新数据。
  const latestRequest = useRef(0);
  // 记录最近一次实际加载的筛选值：URL 变化后若已经加载过同一筛选就不再重复请求。
  const lastLoadedFilter = useRef<string | null | undefined>(undefined);
  // 首屏数据由服务端 page.tsx 查好，跳过第一次 effect 的重复请求。
  const skipFirstFilterEffect = useRef(true);

  const activeProvider =
    providers.find((provider) => provider.id === filterId) ?? null;

  /** 按当前游戏商重新拉取列表（写操作成功后也用它刷新表格）。 */
  const loadGames = useCallback(
    async (providerId: string | null) => {
      const requestId = latestRequest.current + 1;
      latestRequest.current = requestId;
      const url = providerId
        ? `/api/admin/games?providerId=${encodeURIComponent(providerId)}`
        : "/api/admin/games";

      debug("GET list", { url, requestId });
      lastLoadedFilter.current = providerId;
      setLoading(true);

      try {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (requestId !== latestRequest.current) {
          debug("drop stale list response", {
            requestId,
            latest: latestRequest.current,
          });
          return;
        }

        if (response.status === 401) {
          debug("list returned 401, redirecting to login");
          router.replace("/login?next=/admin/games");
          return;
        }

        const data = (await response
          .json()
          .catch(() => ({}))) as GameListResponse;

        if (!response.ok || !Array.isArray(data.games)) {
          debug("list failed", { status: response.status, data });
          setBanner({
            type: "error",
            text: data.error || t("games.error.loadFailed"),
          });
          return;
        }

        debug("list loaded", {
          providerId,
          count: data.games.length,
          providers: Array.from(new Set(data.games.map((game) => game.providerName))),
        });
        setGames(data.games);
      } catch (error) {
        debug("list network error", error);

        if (requestId === latestRequest.current) {
          setBanner({ type: "error", text: t("games.error.network") });
        }
      } finally {
        if (requestId === latestRequest.current) {
          setLoading(false);
        }
      }
    },
    [router, t],
  );

  // URL 的 providerId 变化时（浏览器前进/后退、外部跳转）重新拉数据。
  // 点筛选 Tab 时 selectProvider 已经拉过一次，这里用 lastLoadedFilter 去重。
  useEffect(() => {
    if (skipFirstFilterEffect.current) {
      skipFirstFilterEffect.current = false;
      return;
    }

    if (activeProviderId === lastLoadedFilter.current) {
      debug("providerId prop already loaded, skip", { activeProviderId });
      setFilterId(activeProviderId);
      return;
    }

    debug("providerId prop changed", { activeProviderId });
    setFilterId(activeProviderId);
    void loadGames(activeProviderId);
  }, [activeProviderId, loadGames]);

  async function patchGame(
    game: AdminGameRow,
    body: Record<string, unknown>,
  ): Promise<AdminGameRow | null> {
    debug("PATCH game", { id: game.id, name: game.name, body });

    const response = await fetch(`/api/admin/games/${game.id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: GameMutationResponse = await response
      .json()
      .catch(() => ({}) as GameMutationResponse);

    debug("PATCH result", { status: response.status, data });

    if (response.status === 401) {
      router.replace("/login?next=/admin/games");
      return null;
    }

    if (!response.ok || !data.success || !data.game) {
      setBanner({
        type: "error",
        text: data.error || t("games.error.saveFailed"),
      });
      return null;
    }

    // 先就地更新这一行，点击后立刻有反馈；
    // 整表刷新交给调用方（sortOrder 变化会改变行顺序，必须以服务端为准）。
    setGames((current) =>
      current.map((row) => (row.id === data.game?.id ? data.game : row)),
    );

    return data.game;
  }

  async function handleToggleActive(game: AdminGameRow) {
    const nextActive = !game.isActive;
    debug("toggle storefront", {
      id: game.id,
      name: game.name,
      nextActive,
    });
    setSavingId(game.id);
    setBanner(null);

    try {
      const saved = await patchGame(game, { isActive: nextActive });

      if (saved) {
        setBanner({
          type: "success",
          text: nextActive
            ? t("games.banner.listed", { name: game.name })
            : t("games.banner.unlisted", { name: game.name }),
        });
        // 以数据库为准刷新整表（上下架可能影响其他行？不会，但保持单一数据源）。
        await loadGames(filterId);
      }
    } catch (error) {
      debug("toggle storefront failed", error);
      setBanner({ type: "error", text: t("games.error.network") });
    } finally {
      setSavingId(null);
    }
  }

  async function handleSortOrderCommit(
    game: AdminGameRow,
    nextOrder: number,
  ): Promise<boolean> {
    if (!Number.isInteger(nextOrder) || nextOrder < 0 || nextOrder > 999999) {
      debug("sortOrder rejected", { id: game.id, nextOrder });
      setBanner({ type: "error", text: t("games.error.orderInvalid") });
      return false;
    }

    if (nextOrder === game.sortOrder) {
      debug("sortOrder unchanged, skip PATCH", { id: game.id, nextOrder });
      return true;
    }

    debug("commit sortOrder", { id: game.id, from: game.sortOrder, nextOrder });
    setSavingId(game.id);
    setBanner(null);

    try {
      const saved = await patchGame(game, { sortOrder: nextOrder });

      if (!saved) {
        return false;
      }

      setBanner({
        type: "success",
        text: t("games.banner.orderSaved", {
          name: game.name,
          order: saved.sortOrder,
        }),
      });
      // sortOrder 变化会改变行顺序，重新拉一次让表格与数据库一致。
      await loadGames(filterId);

      return true;
    } catch (error) {
      debug("commit sortOrder failed", error);
      setBanner({ type: "error", text: t("games.error.network") });
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function handleSyncAll() {
    debug("sync all providers start");
    setSyncingAll(true);
    setBanner(null);

    try {
      const response = await fetch("/api/admin/games/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as GameSyncResponse;

      debug("sync all response", { status: response.status, data });

      if (response.status === 401) {
        router.replace("/login?next=/admin/games");
        return;
      }

      if (!response.ok || !data.success || !data.totals) {
        setBanner({
          type: "error",
          text: data.error || t("games.error.syncFailed"),
        });
        return;
      }

      setBanner({
        type: "success",
        text: t("games.banner.syncedAll", {
          providers: data.totals.providers,
          created: data.totals.created,
          updated: data.totals.updated,
        }),
      });
      // 同步可能新增游戏或刷新名称，重新拉列表（保留当前游戏商筛选）。
      await loadGames(filterId);
    } catch (error) {
      debug("sync all failed", error);
      setBanner({ type: "error", text: t("games.error.syncNetwork") });
    } finally {
      setSyncingAll(false);
    }
  }

  function selectProvider(providerId: string | null) {
    if (providerId === filterId) {
      return;
    }

    debug("select provider", { from: filterId, to: providerId });
    // 乐观高亮 + 立刻拉数据：不依赖 router.push 的往返，点击马上有反应。
    setFilterId(providerId);
    setBanner(null);
    void loadGames(providerId);
    router.push(
      providerId
        ? `/admin/games?providerId=${encodeURIComponent(providerId)}`
        : "/admin/games",
    );
  }

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-[#d4af37]/70">
            <span className="h-px w-6 bg-[#d4af37]/60" />
            {t("games.header.eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {activeProvider ? activeProvider.name : t("games.header.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            {t("games.header.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link
            href="/admin/providers"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 px-4 text-xs text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
          >
            {t("games.actions.backToProviders")}
          </Link>
          <button
            type="button"
            onClick={() => void handleSyncAll()}
            disabled={syncingAll}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] px-4 text-xs font-bold text-[#171105] shadow-[0_12px_32px_-12px_rgba(212,175,55,0.8)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-3.5 w-3.5 ${syncingAll ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 12a8 8 0 1 1-2.3-5.6" />
              <path d="M20 4v4h-4" />
            </svg>
            {syncingAll
              ? t("games.actions.syncing")
              : t("games.actions.syncAll")}
          </button>
        </div>
      </header>

      {banner ? (
        <div
          role="status"
          aria-live="polite"
          className={`mt-5 rounded-xl border px-4 py-3 text-[11px] leading-5 ${
            banner.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-red-400/20 bg-red-400/[0.06] text-red-300"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      <div
        role="group"
        aria-labelledby={filterLabelId}
        className="mt-5 flex flex-wrap items-center gap-1.5"
      >
        <span id={filterLabelId} className="sr-only">
          {t("games.filter.label")}
        </span>
        <button
          type="button"
          onClick={() => selectProvider(null)}
          aria-pressed={filterId === null}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[10px] transition-colors ${
            filterId === null
              ? "border-[#f0d27c]/60 bg-[#f0d27c]/15 text-[#f8e9b0]"
              : "border-white/[0.06] bg-white/[0.02] text-neutral-500 hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
          }`}
        >
          {t("games.filter.all")}
        </button>
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => selectProvider(provider.id)}
            aria-pressed={filterId === provider.id}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[10px] transition-colors ${
              filterId === provider.id
                ? "border-[#f0d27c]/60 bg-[#f0d27c]/15 text-[#f8e9b0]"
                : "border-white/[0.06] bg-white/[0.02] text-neutral-500 hover:border-[#d4af37]/30 hover:text-[#f0d27c]"
            }`}
          >
            {provider.name}
            {provider.isActive ? null : (
              <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[8px] uppercase tracking-[0.1em] text-neutral-500">
                {t("games.filter.providerUnlisted")}
              </span>
            )}
          </button>
        ))}
      </div>


      <section
        aria-busy={loading}
        className="mt-4 overflow-hidden rounded-2xl border border-[#d4af37]/10 bg-[#0a0a0a]/70"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-[#d4af37]/10 bg-white/[0.02] text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                <th className="px-5 py-3.5 font-medium">
                  {t("games.table.game")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("games.table.provider")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("games.table.category")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("games.table.order")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("games.table.storefront")}
                </th>
                <th className="px-5 py-3.5 font-medium">
                  {t("games.table.syncedAt")}
                </th>
              </tr>
            </thead>
            <tbody
              className={
                loading ? "opacity-60 transition-opacity" : "transition-opacity"
              }
            >
              {games.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-xs text-neutral-600"
                  >
                    {loading ? t("games.rows.loading") : t("games.table.empty")}
                  </td>
                </tr>
              ) : (
                games.map((game) => {
                  const saving = savingId === game.id;

                  return (
                    <tr
                      key={game.id}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"
                    >
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-neutral-200">
                          {game.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                          {game.externalId}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-neutral-400">
                        {game.providerName}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-neutral-400">
                          {t(
                            LOBBY_CATEGORY_LABEL_KEYS[
                              normalizeGameCategory(game.category)
                            ],
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <SortOrderInput
                          sortOrder={game.sortOrder}
                          disabled={saving}
                          ariaLabel={t("games.row.sortOrderAria", {
                            name: game.name,
                          })}
                          onCommit={(nextOrder) =>
                            handleSortOrderCommit(game, nextOrder)
                          }
                        />
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(game)}
                          disabled={saving}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            game.isActive
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300 hover:border-emerald-400/40"
                              : "border-red-400/20 bg-red-400/10 text-red-300 hover:border-red-400/40"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {game.isActive
                            ? t("games.row.listed")
                            : t("games.row.unlisted")}
                        </button>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[10px] text-neutral-600">
                        {formatDate(game.syncedAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d4af37]/10 px-5 py-3 text-[10px] text-neutral-600">
          <span aria-live="polite">
            {loading
              ? t("games.rows.loading")
              : t("games.footer.count", { count: games.length })}
          </span>
          <span>{t("games.footer.hint")}</span>
        </div>
      </section>
    </div>
  );
}

/**
 * 排序权重输入框。
 *
 * 用受控 state 而不是 defaultValue：保存成功 / 同步 / 切换游戏商之后，
 * 服务端返回的 sortOrder 会同步回输入框，不会出现「数字还是旧的」。
 * 回车或失焦（blur）都会提交；提交失败回滚到服务端值。
 */
function SortOrderInput({
  sortOrder,
  disabled,
  ariaLabel,
  onCommit,
}: {
  sortOrder: number;
  disabled: boolean;
  ariaLabel: string;
  onCommit: (nextOrder: number) => Promise<boolean>;
}) {
  const [value, setValue] = useState(String(sortOrder));
  const [lastSortOrder, setLastSortOrder] = useState(sortOrder);
  const [busy, setBusy] = useState(false);

  // 服务端排序值变化（保存成功 / 同步 / 切换游戏商）后同步输入框，
  // 用「渲染期修正 state」的官方写法，避免 effect 里 setState 引发的级联渲染。
  if (sortOrder !== lastSortOrder) {
    setLastSortOrder(sortOrder);
    setValue(String(sortOrder));
  }

  async function commit() {
    if (busy) {
      return;
    }

    const trimmed = value.trim();
    const nextOrder = Number(trimmed);

    // 空值或非整数：直接回滚，不打扰后端。
    if (trimmed === "" || !Number.isInteger(nextOrder)) {
      debug("sortOrder input invalid, rollback", { value, sortOrder });
      setValue(String(sortOrder));
      return;
    }

    if (nextOrder === sortOrder) {
      setValue(String(sortOrder));
      return;
    }

    setBusy(true);
    const saved = await onCommit(nextOrder);
    setBusy(false);

    if (!saved) {
      setValue(String(sortOrder));
    }
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={999999}
      value={value}
      disabled={disabled || busy}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setValue(String(sortOrder));
          event.currentTarget.blur();
        }
      }}
      aria-label={ariaLabel}
      className="h-8 w-20 rounded-md border border-white/10 bg-black/40 px-2 text-center font-mono text-[11px] text-neutral-200 focus:border-[#d4af37]/40 focus:outline-none disabled:opacity-50"
    />
  );
}

