/**
 * 首页【游戏商商标网格 / 品牌墙】(Provider Showcase) 的可见性与顺序。
 *
 * 规则只写在这一个文件里，后台排序面板、后台保存接口、玩家大厅品牌墙共用，
 * 避免「后台看到一套顺序、前台渲染另一套」：
 * - showInShowcase = false → 品牌墙不展示该游戏商（展馆页 /provider/[code] 与游戏目录照旧可用）；
 * - sortOrder 越大越靠前，相同则按名称升序，与 prisma 的 orderBy 完全一致；
 * - 后台上下移动时按步长 10 重新倒排，第一张最大，方便以后手工插入而不必整表重排。
 */

/** 排序步长：相邻两张卡片的 sortOrder 间隔 */
export const SHOWCASE_SORT_STEP = 10;

/** sortOrder 允许的绝对值上限（防止脏数据把整型写溢出） */
export const SHOWCASE_SORT_LIMIT = 1_000_000;

/** 单次批量保存的条数上限 */
export const SHOWCASE_REORDER_MAX_ROWS = 500;

/** 品牌墙需要的最小字段：数据库行、接口返回值、内置回退目录都满足这个形状 */
export type ShowcaseProviderLike = {
  id: string;
  name: string;
  sortOrder?: number | null;
  showInShowcase?: boolean | null;
};

/** 后台 / 接口之间的批量排序入参 */
export type ShowcaseOrderInput = {
  id: string;
  sortOrder: number;
  showInShowcase: boolean;
};

/**
 * 是否进入品牌墙。
 * 缺字段（内置回退目录、旧接口）一律按「展示」处理，保证前端不会因为少一个字段而白屏。
 */
export function isShowcaseVisible(provider: {
  showInShowcase?: boolean | null;
}): boolean {
  return provider.showInShowcase !== false;
}

/** sortOrder 降序 → 名称升序，与 `orderBy: [{ sortOrder: "desc" }, { name: "asc" }]` 一致 */
export function sortShowcaseProviders<T extends ShowcaseProviderLike>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((left, right) => {
    const byOrder = (right.sortOrder ?? 0) - (left.sortOrder ?? 0);

    return byOrder !== 0 ? byOrder : left.name.localeCompare(right.name);
  });
}

/** 品牌墙真正渲染的列表：先过滤 showInShowcase，再按 sortOrder 从大到小排列 */
export function selectShowcaseProviders<T extends ShowcaseProviderLike>(
  rows: readonly T[],
): T[] {
  return sortShowcaseProviders(rows.filter(isShowcaseVisible));
}

/** 上移 / 下移一位；越界或找不到时原样返回（后台按钮同时会禁用） */
export function moveShowcaseProvider<T extends { id: string }>(
  rows: readonly T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const next = [...rows];
  const index = next.findIndex((row) => row.id === id);
  const target = index + direction;

  if (index < 0 || target < 0 || target >= next.length) {
    return next;
  }

  [next[index], next[target]] = [next[target], next[index]];

  return next;
}

/**
 * 按数组顺序倒排 sortOrder：第一张 = 总数 × 步长，最后一张 = 步长。
 * 保存后前台按 sortOrder 降序读库，顺序与后台列表完全一致。
 */
export function withShowcaseSortOrder<T extends { id: string }>(
  rows: readonly T[],
): (T & { sortOrder: number })[] {
  const total = rows.length;

  return rows.map((row, index) => ({
    ...row,
    sortOrder: (total - index) * SHOWCASE_SORT_STEP,
  }));
}

/**
 * 校验 PATCH /api/admin/providers/reorder 的请求体。
 * 接受 `[{ id, sortOrder, showInShowcase }]` 或 `{ providers: [...] }`（由调用方先解包）。
 * 任何一条不合法就整体拒绝，返回 null —— 不允许「部分保存」造成前后台顺序错位。
 */
export function readShowcaseOrderInput(
  value: unknown,
): ShowcaseOrderInput[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  if (value.length > SHOWCASE_REORDER_MAX_ROWS) {
    return null;
  }

  const seen = new Set<string>();
  const rows: ShowcaseOrderInput[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const input = item as Record<string, unknown>;
    const id = typeof input.id === "string" ? input.id.trim() : "";

    if (!id || seen.has(id)) {
      return null;
    }

    const rawSortOrder = input.sortOrder;
    const sortOrder =
      typeof rawSortOrder === "number"
        ? rawSortOrder
        : typeof rawSortOrder === "string" && rawSortOrder.trim()
          ? Number(rawSortOrder)
          : 0;

    if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > SHOWCASE_SORT_LIMIT) {
      return null;
    }

    if (typeof input.showInShowcase !== "boolean") {
      return null;
    }

    seen.add(id);
    rows.push({ id, sortOrder, showInShowcase: input.showInShowcase });
  }

  return rows;
}
