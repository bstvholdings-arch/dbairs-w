import type { TranslationKey } from "@/lib/i18n-types";

/**
 * AI 对话 / 线索相关的共享常量与纯函数。
 *
 * 这里不 import Prisma 或 next/*，因此客户端组件、API 路由和 Prisma seed
 * 都可以安全复用同一套校验与图表聚合逻辑，避免「后台看到的分类」
 * 与「接口写入的分类」各写一套。
 */

export const AI_AGENT_TYPES = ["sales", "tech", "support"] as const;

export type AiAgentTypeValue = (typeof AI_AGENT_TYPES)[number];

/** 销冠 AI 是默认智能体。 */
export const DEFAULT_AI_AGENT: AiAgentTypeValue = "sales";

export const AI_CHAT_ROLES = ["user", "assistant"] as const;

export type AiChatRoleValue = (typeof AI_CHAT_ROLES)[number];

export const LEAD_STATUSES = ["pending", "success", "failed"] as const;

export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

/** 战败原因最多 5 个字：价格贵 / 没流量 / 怕黑台 / 不信任 / 不会推。 */
export const MAX_FAIL_REASON_LENGTH = 5;

/** 单条聊天记录落库上限（字符）。 */
export const MAX_CHAT_CONTENT_LENGTH = 8000;

/** 单次用户输入上限（字符），防止把整本 PDF 塞进模型。 */
export const MAX_CHAT_MESSAGE_LENGTH = 4000;

/** 每次对话回传给模型的历史条数。 */
export const CHAT_HISTORY_LIMIT = 20;

export type FailReasonBucketKey = "price" | "trust" | "promotion" | "other";

export type FailReasonBucket = {
  key: FailReasonBucketKey;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  /** 图表里的固定配色，保证饼图与柱状图颜色一致。 */
  color: string;
  /** 命中任一关键词即归入该桶。 */
  keywords: readonly string[];
};

/**
 * 战败原因归桶。
 *
 * 看板固定展示「价格贵 / 不信任 / 不会推」三条主线，
 * 其余原因统一进「其他」，但线索明细表仍然保留 AI 给出的原始 5 字标签。
 */
export const FAIL_REASON_BUCKETS: readonly FailReasonBucket[] = [
  {
    key: "price",
    labelKey: "aiConsole.reason.price",
    hintKey: "aiConsole.reason.priceHint",
    color: "#d4af37",
    keywords: ["价格", "贵", "预算", "没钱", "费用", "成本", "付不起"],
  },
  {
    key: "trust",
    labelKey: "aiConsole.reason.trust",
    hintKey: "aiConsole.reason.trustHint",
    color: "#f87171",
    keywords: ["不信任", "不信", "黑台", "跑路", "骗子", "骗人", "安全", "靠谱", "怕被"],
  },
  {
    key: "promotion",
    labelKey: "aiConsole.reason.promotion",
    hintKey: "aiConsole.reason.promotionHint",
    color: "#38bdf8",
    keywords: [
      "不会推",
      "不会推广",
      "不会引流",
      "没流量",
      "无流量",
      "没资源",
      "无资源",
      "没渠道",
      "没玩家",
      "没客户",
    ],
  },
  {
    key: "other",
    labelKey: "aiConsole.reason.other",
    hintKey: "aiConsole.reason.otherHint",
    color: "#8a8a8a",
    keywords: [],
  },
];

export function isAiAgentType(value: unknown): value is AiAgentTypeValue {
  return (
    typeof value === "string" &&
    (AI_AGENT_TYPES as readonly string[]).includes(value)
  );
}

export function isAiChatRole(value: unknown): value is AiChatRoleValue {
  return (
    typeof value === "string" &&
    (AI_CHAT_ROLES as readonly string[]).includes(value)
  );
}

export function isLeadStatus(value: unknown): value is LeadStatusValue {
  return (
    typeof value === "string" &&
    (LEAD_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * 清洗 AI 工具返回的战败原因：
 * 去空格 / 标点，只保留文字与数字，并截断到 5 个字。
 * 无法清洗出内容时返回 null（调用方不得落库）。
 */
export function normalizeFailReason(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(
    /[\s\u3000,，.。!！?？、;；:："'“”‘’()（）[\]【】<>《》/\\|~`@#$%^&*+=_-]/g,
    "",
  );

  if (!cleaned) {
    return null;
  }

  return Array.from(cleaned).slice(0, MAX_FAIL_REASON_LENGTH).join("");
}

export function bucketKeyForReason(
  reason: string | null | undefined,
): FailReasonBucketKey {
  const text = (reason ?? "").trim();

  if (!text) {
    return "other";
  }

  for (const bucket of FAIL_REASON_BUCKETS) {
    if (bucket.key === "other") {
      continue;
    }

    if (bucket.keywords.some((keyword) => text.includes(keyword))) {
      return bucket.key;
    }
  }

  return "other";
}

export type ReasonCount = {
  reason: string;
  count: number;
};

/** 按原始标签统计（价格贵 8、没流量 3 …），同一标签精确合并。 */
export function countFailReasons(
  reasons: readonly (string | null | undefined)[],
): ReasonCount[] {
  const counts = new Map<string, number>();

  for (const raw of reasons) {
    const reason = (raw ?? "").trim();

    if (!reason) {
      continue;
    }

    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export type FailureBucketSummary = {
  key: FailReasonBucketKey;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  color: string;
  count: number;
  /** 0–1，展示时用 formatPercent。 */
  ratio: number;
  /** 该桶下最常见的原始标签，最多 3 个。 */
  examples: string[];
};

export type FailureSummary = {
  total: number;
  buckets: FailureBucketSummary[];
};

/** 把原始标签统计聚合成看板的饼图 / 柱状图数据。 */
export function summarizeFailureBuckets(
  reasonCounts: readonly ReasonCount[],
): FailureSummary {
  const totals = new Map<FailReasonBucketKey, number>(
    FAIL_REASON_BUCKETS.map((bucket) => [bucket.key, 0]),
  );
  const examples = new Map<FailReasonBucketKey, ReasonCount[]>(
    FAIL_REASON_BUCKETS.map((bucket) => [bucket.key, []]),
  );

  let total = 0;

  for (const item of reasonCounts) {
    if (item.count <= 0) {
      continue;
    }

    const key = bucketKeyForReason(item.reason);
    totals.set(key, (totals.get(key) ?? 0) + item.count);
    examples.get(key)?.push(item);
    total += item.count;
  }

  const buckets = FAIL_REASON_BUCKETS.map((bucket) => {
    const count = totals.get(bucket.key) ?? 0;

    return {
      key: bucket.key,
      labelKey: bucket.labelKey,
      hintKey: bucket.hintKey,
      color: bucket.color,
      count,
      ratio: total > 0 ? count / total : 0,
      examples: (examples.get(bucket.key) ?? [])
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((item) => item.reason),
    };
  });

  return { total, buckets };
}

export function successRate(
  successCount: number,
  totalCount: number,
): number {
  if (totalCount <= 0) {
    return 0;
  }

  return successCount / totalCount;
}
