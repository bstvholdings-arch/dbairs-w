import { Prisma } from "@prisma/client";

import { createCallbackSignature } from "./payment-gateway";
import { normalizePayoutCurrency } from "./withdrawal-channels";
import { prisma } from "./prisma";
import { WITHDRAWAL_STATUS_PROCESSING } from "./withdrawal-status";
import {
  returnWithdrawalToManualReview,
  settleWithdrawalSuccess,
} from "./withdrawal-settlement";

/**
 * 自动出款引擎（Auto Payout）+ 人工兜底。
 *
 * 一句话口径：**能自动就自动，不能自动就一定能人工。**
 *
 * 路由 A（自动）：商户打开开关 + 该通道配了代付 API + 单笔不超上限 +
 *   当日额度没熔断 + KYC 通过 + 红利流水已打满 → `status=processing, isAuto=true`，
 *   立刻调商户的代付 API 打款，成功即结算（扣余额 + 写出金流水）。
 * 路由 B（人工）：以上**任意一项**不满足 → `status=pending, isAuto=false`，
 *   进 /tenant/withdrawals 的人工审批队列，商户 Approve 即出款、Reject 即驳回。
 *
 * 三条硬规则：
 * 1. fail-closed：配置读不出来 / 字段非法 → 视为「关闭自动出款」，宁可全人工；
 * 2. 平台通道不允许自动代付（资金不经过平台，AGENTS.md 第 1 条），
 *    只有商户自己的通道（ownerId = 本站）且填了 payoutEndpoint 才算「配了代付 API」；
 * 3. 熔断：当日自动出款总额 + 本单 > dailyAutoLimit 时，本单立刻转人工，
 *    不需要定时任务去「关开关」——额度是每次提单实时算的，过了线自然就全人工了。
 */

export type AutoPayoutConfig = {
  isEnabled: boolean;
  /** 单笔自动出款上限（本站记账币种） */
  maxAutoAmount: number;
  /** 每日自动出款总限额（本站记账币种） */
  dailyAutoLimit: number;
};

/** 默认值：开关**关闭**（新租户不会一上线就自动打钱），限额给出可用的初始值 */
export const DEFAULT_AUTO_PAYOUT_CONFIG: AutoPayoutConfig = {
  isEnabled: false,
  maxAutoAmount: 100,
  dailyAutoLimit: 1000,
};

/** 单笔上限 / 日限额的硬性上界：超过这个数一定是填错了（10 亿），不接受 */
export const AUTO_PAYOUT_AMOUNT_CAP = 1_000_000_000;

function readAmount(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value ?? NaN);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.min(
    Math.round(number * 100) / 100,
    AUTO_PAYOUT_AMOUNT_CAP,
  );
}

/**
 * 读侧唯一口径：`Tenant.autoPayoutConfig` → 结构化配置。
 *
 * null / 脏数据 / 缺字段一律回落默认值（isEnabled=false），
 * 所以老租户升级后行为不变：**全部走人工审核**，商户自己打开开关才生效。
 */
export function normalizeAutoPayoutConfig(value: unknown): AutoPayoutConfig {
  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_AUTO_PAYOUT_CONFIG };
    }
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_AUTO_PAYOUT_CONFIG };
  }

  const record = raw as Record<string, unknown>;

  return {
    isEnabled: record.isEnabled === true,
    maxAutoAmount: readAmount(
      record.maxAutoAmount,
      DEFAULT_AUTO_PAYOUT_CONFIG.maxAutoAmount,
    ),
    dailyAutoLimit: readAmount(
      record.dailyAutoLimit,
      DEFAULT_AUTO_PAYOUT_CONFIG.dailyAutoLimit,
    ),
  };
}

export type AutoPayoutConfigParseResult =
  | { ok: true; config: AutoPayoutConfig }
  | { ok: false; message: string };

/**
 * 写侧校验：商户在配置面板提交的三个字段。
 *
 * 允许部分提交（只改一个也合法），但**只要提交了就必须合法** ——
 * 不做「猜一个能用的值」，与备用域名的写入口径一致。
 */
export function parseAutoPayoutConfigInput(
  input: unknown,
): AutoPayoutConfigParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "自动出款配置格式不正确" };
  }

  const record = input as Record<string, unknown>;
  const base = normalizeAutoPayoutConfig(record.current);
  const next: AutoPayoutConfig = { ...base };

  if (record.isEnabled !== undefined) {
    if (typeof record.isEnabled !== "boolean") {
      return { ok: false, message: "自动出款开关只能是 true / false" };
    }

    next.isEnabled = record.isEnabled;
  }

  for (const [field, label] of [
    ["maxAutoAmount", "单笔自动出款上限"],
    ["dailyAutoLimit", "每日自动出款总额"],
  ] as const) {
    const value = record[field];

    if (value === undefined) {
      continue;
    }

    const number = typeof value === "number" ? value : Number(String(value).trim());

    if (!Number.isFinite(number)) {
      return { ok: false, message: `${label}必须是数字` };
    }

    if (number < 0) {
      return { ok: false, message: `${label}不能是负数` };
    }

    if (number > AUTO_PAYOUT_AMOUNT_CAP) {
      return { ok: false, message: `${label}超出允许范围` };
    }

    next[field] = Math.round(number * 100) / 100;
  }

  // 打开自动出款的前提是限额有意义：全是 0 等于「一单都不自动」，
  // 与其让商户以为开了却没生效，不如直接拒绝。
  if (next.isEnabled && (next.maxAutoAmount <= 0 || next.dailyAutoLimit <= 0)) {
    return {
      ok: false,
      message: "开启自动出款前，请把单笔上限与每日总额都设为大于 0 的金额",
    };
  }

  return { ok: true, config: next };
}

/* ------------------------------------------------------------------ *
 * 风险 / 路由原因
 * ------------------------------------------------------------------ */

export const AUTO_PAYOUT_RISK = {
  /** 自动出款已受理，正在等代付商结果 */
  autoQueued: "auto_queued",
  /** 自动出款成功 */
  autoPaid: "auto_paid",
  /** 代付 API 调用失败 → 已退回人工队列 */
  autoPayoutFailed: "auto_payout_failed",
  /** 代付成功但扣款失败（余额被并发花掉）→ 需人工对账 */
  autoPayoutUnsettled: "auto_payout_unsettled",
  /** 商户关着自动出款开关 */
  manualDisabled: "manual_disabled",
  /** 该通道没配代付 API */
  manualNoPayoutApi: "manual_no_payout_api",
  /** 超过单笔自动上限 */
  manualOverSingleLimit: "manual_over_single_limit",
  /** 当日自动出款额度已熔断 */
  manualDailyLimit: "manual_daily_limit",
  /** 实名未通过 */
  manualKycPending: "manual_kyc_pending",
  /** 红利流水未打满 */
  manualBonusTurnover: "manual_bonus_turnover",
} as const;

export type AutoPayoutRiskStatus =
  (typeof AUTO_PAYOUT_RISK)[keyof typeof AUTO_PAYOUT_RISK];

export type AutoPayoutRoute = "auto" | "manual";

export type AutoPayoutRoutingDecision = {
  route: AutoPayoutRoute;
  riskStatus: AutoPayoutRiskStatus;
};

/**
 * 智能路由的**唯一判定函数**（纯函数，不查库、不联网，便于按纯逻辑推演 / 复用）。
 *
 * 判定顺序刻意排成「先看有没有代付能力，再看商户策略，最后看风控」：
 * 没有代付 API 时，无论开关开没开都只能是人工 —— 这是产品要求的硬结论。
 */
export function evaluateAutoPayoutRoute(input: {
  config: AutoPayoutConfig;
  /** 该通道是否配了真实可用的代付 API（商户自有通道 + http(s) 地址） */
  hasPayoutApi: boolean;
  /** 提现金额（本站记账币种） */
  amount: number;
  /** 实名是否通过 */
  kycApproved: boolean;
  /** 红利流水还差多少（0 = 已打满） */
  bonusTurnoverOutstanding: number;
  /** 当日已自动出款总额 */
  dailyAutoPaidAmount: number;
  /** 当日已自动出款笔数（仅用于提示，不参与判定） */
  dailyAutoCount?: number;
}): AutoPayoutRoutingDecision {
  if (!input.hasPayoutApi) {
    return { route: "manual", riskStatus: AUTO_PAYOUT_RISK.manualNoPayoutApi };
  }

  if (!input.config.isEnabled) {
    return { route: "manual", riskStatus: AUTO_PAYOUT_RISK.manualDisabled };
  }

  if (!input.kycApproved) {
    return { route: "manual", riskStatus: AUTO_PAYOUT_RISK.manualKycPending };
  }

  if (input.bonusTurnoverOutstanding > 0) {
    return {
      route: "manual",
      riskStatus: AUTO_PAYOUT_RISK.manualBonusTurnover,
    };
  }

  // 限额被配成 0 视为「不自动」（fail-closed），不能因为 0 <= 0 就放行
  if (
    input.config.maxAutoAmount <= 0 ||
    input.amount > input.config.maxAutoAmount
  ) {
    return {
      route: "manual",
      riskStatus: AUTO_PAYOUT_RISK.manualOverSingleLimit,
    };
  }

  // 熔断：当日已出 + 本单 > 日限额 → 本单立刻转人工。
  // 用「已出 + 本单」而不是「已出」判断，才能保证「一天不超过 dailyAutoLimit」，
  // 否则最后几笔会把总额冲过头。
  if (
    input.config.dailyAutoLimit <= 0 ||
    input.dailyAutoPaidAmount + input.amount > input.config.dailyAutoLimit
  ) {
    return {
      route: "manual",
      riskStatus: AUTO_PAYOUT_RISK.manualDailyLimit,
    };
  }

  return { route: "auto", riskStatus: AUTO_PAYOUT_RISK.autoQueued };
}

/**
 * 「每个自然日」的起点（服务器本地时区 00:00）。
 *
 * 之所以按自然日而不是「滚动 24 小时」：商户看的是「今天还剩多少额度」，
 * 滚动窗口会让额度在半夜随机恢复，完全无法对账。
 */
export function startOfPayoutDay(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toAmount(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }

  const number = Number(value.toString());

  return Number.isFinite(number) ? number : 0;
}

/**
 * 当日自动出款用量：只统计 `isAuto=true` 且**已经占住额度**的单
 * （processing 在途 + success 已出款；failed 不算，钱没出去）。
 *
 * 注意 `isAuto=true` 但最终由人工点掉的那笔也算：它当初占的就是自动额度，
 * 算进来是刻意偏保守（宁可早点熔断转人工，也不要让钱多出去）。
 */
export async function loadAutoPayoutDailyUsage(input: {
  tenantId: string;
  now?: Date;
}): Promise<{ amount: number; count: number }> {
  const aggregate = await prisma.withdrawal.aggregate({
    where: {
      tenantId: input.tenantId,
      isAuto: true,
      status: { in: [WITHDRAWAL_STATUS_PROCESSING, "success"] },
      createdAt: { gte: startOfPayoutDay(input.now) },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    amount: toAmount(aggregate._sum.amount),
    count: aggregate._count._all,
  };
}

/** 代付地址必须是真的 http(s) 地址，否则等于没配（fail-closed） */
export function isUsablePayoutEndpoint(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const text = value.trim();

  if (!text || text.length > 500) {
    return false;
  }

  try {
    const url = new URL(text);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 提单时的智能路由（查库版）
 * ------------------------------------------------------------------ */

export type WithdrawalRoutingContext = AutoPayoutRoutingDecision & {
  config: AutoPayoutConfig;
  /** 当日已自动出款总额（含在途） */
  dailyAutoPaidAmount: number;
  /** 当日已自动出款笔数 */
  dailyAutoCount: number;
  /** 该通道是否配了可用的代付 API */
  hasPayoutApi: boolean;
};

/**
 * 提单瞬间的路由判定：读商户配置 + 当日用量 + 通道代付能力，算出 route / riskStatus。
 *
 * 只读，不写库 —— 落库（status / isAuto / riskStatus）由调用方完成，
 * 这样「判定逻辑」可以被单测直接覆盖，不需要造一堆提现单。
 */
export async function evaluateWithdrawalRouting(input: {
  tenantId: string;
  gateway: { id: string; ownerId: string | null; payoutEndpoint: string | null };
  amount: Prisma.Decimal | number | string;
  kycApproved: boolean;
  /** 红利流水还差多少（loadBonusTurnoverLock().outstanding） */
  bonusTurnoverOutstanding: number;
  now?: Date;
}): Promise<WithdrawalRoutingContext> {
  const [tenant, usage] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { autoPayoutConfig: true },
    }),
    loadAutoPayoutDailyUsage({ tenantId: input.tenantId, now: input.now }),
  ]);

  const config = normalizeAutoPayoutConfig(tenant?.autoPayoutConfig);
  // 平台通道（ownerId=null）永远没有代付能力：钱不经过平台，这是合法底线。
  const hasPayoutApi =
    input.gateway.ownerId === input.tenantId &&
    isUsablePayoutEndpoint(input.gateway.payoutEndpoint);

  const decision = evaluateAutoPayoutRoute({
    config,
    hasPayoutApi,
    amount: toAmount(input.amount),
    kycApproved: input.kycApproved,
    bonusTurnoverOutstanding: toAmount(input.bonusTurnoverOutstanding),
    dailyAutoPaidAmount: usage.amount,
    dailyAutoCount: usage.count,
  });

  return {
    ...decision,
    config,
    dailyAutoPaidAmount: usage.amount,
    dailyAutoCount: usage.count,
    hasPayoutApi,
  };
}

/* ------------------------------------------------------------------ *
 * 调商户的代付 API
 * ------------------------------------------------------------------ */

/** 代付请求超时：超过 15 秒还没回就按失败处理并转人工（不能让玩家一直等） */
export const AUTO_PAYOUT_TIMEOUT_MS = 15_000;

export type GatewayPayoutResult =
  | { ok: true; txHash: string | null }
  | { ok: false; error: string };

/** 从代付商响应里挑一个能当流水号的字段 */
function readPayoutReference(payload: Record<string, unknown>): string | null {
  for (const field of [
    "txHash",
    "txId",
    "transactionId",
    "transactionNo",
    "orderNo",
    "reference",
    "id",
  ]) {
    const value = payload[field];

    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 200);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function isPayoutSuccess(payload: Record<string, unknown>) {
  if (payload.success === true) {
    return true;
  }

  const code = payload.code;
  const status = typeof payload.status === "string" ? payload.status : "";

  if (code === 0 || code === "0") {
    return true;
  }

  return ["success", "succeeded", "paid", "completed", "processing"].includes(
    status.toLowerCase(),
  );
}

/**
 * 调商户自己配置的代付 API（出款）。
 *
 * 约定（写进 README，商户对接时按这个实现）：
 *   POST {PaymentGateway.payoutEndpoint}
 *   Headers: content-type: application/json
 *            x-gateway-id: <网关 id>
 *            x-idempotency-key: <提现单 id>（重试不会重复打款）
 *            x-gateway-signature: sha256=hex(HMAC-SHA256(rawBody, apiKey))
 *   Body: { withdrawalId, merchantOrderNo, amount, currency, destination,
 *           callbackUrl, requestedAt }
 *   Response: { success: true, txHash? } 或 { code: "0", orderNo? }
 *             非 2xx / success=false 一律视为失败 → 转人工审核。
 *
 * 为什么签名用 HMAC-SHA256(apiKey)：与回调验签（verifyCallbackSignature）同一套
 * 密钥与算法，商户只需要实现一次，不用为「收款」和「出款」各写一套加解密。
 */
export async function requestGatewayPayout(input: {
  withdrawalId: string;
  amount: string;
  currency: string;
  destination: string;
  gateway: {
    id: string;
    name: string;
    payoutEndpoint: string | null;
    apiKey: string;
  };
  callbackUrl?: string;
}): Promise<GatewayPayoutResult> {
  if (!isUsablePayoutEndpoint(input.gateway.payoutEndpoint)) {
    return { ok: false, error: "该通道未配置代付 API 地址" };
  }

  const endpoint = (input.gateway.payoutEndpoint ?? "").trim();
  const payload = {
    withdrawalId: input.withdrawalId,
    merchantOrderNo: input.withdrawalId,
    amount: input.amount,
    currency: input.currency,
    destination: input.destination,
    callbackUrl: input.callbackUrl ?? null,
    requestedAt: new Date().toISOString(),
  };
  const rawBody = JSON.stringify(payload);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-gateway-id": input.gateway.id,
        "x-idempotency-key": input.withdrawalId,
        "x-gateway-signature": `sha256=${createCallbackSignature(
          rawBody,
          input.gateway.apiKey,
        )}`,
      },
      body: rawBody,
      signal: AbortSignal.timeout(AUTO_PAYOUT_TIMEOUT_MS),
      cache: "no-store",
    });

    const text = await response.text();
    let data: Record<string, unknown> = {};

    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      data =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `代付 API 返回 ${response.status}`,
      };
    }

    if (!isPayoutSuccess(data)) {
      const message =
        typeof data.message === "string"
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : "代付 API 未返回成功";

      return { ok: false, error: message.slice(0, 200) };
    }

    return { ok: true, txHash: readPayoutReference(data) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "代付 API 超时"
          : "代付 API 请求失败",
    };
  }
}

export type AutoPayoutExecutionResult =
  | { status: "paid"; txHash: string | null; balance: string | null }
  | {
      status: "manual_review";
      reason:
        | "not_processing"
        | "no_gateway"
        | "insufficient_balance"
        | "payout_api_failed"
        | "settle_failed";
      error: string | null;
    }
  /** 代付已成功但扣款失败（余额被并发花掉）——保持 processing，等人工对账 */
  | { status: "unsettled"; txHash: string | null };

/** 回调地址：优先用环境变量里的站点根地址，没有就不传（代付商可自行配置） */
function buildWithdrawalCallbackUrl() {
  const base =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "";

  if (!base) {
    return undefined;
  }

  return `${base.replace(/\/+$/, "")}/api/withdrawal/callback`;
}

/**
 * 自动出款执行器：`processing` 单 → 调代付 API → 成功即结算 / 失败退回人工。
 *
 * 调用点：POST /api/withdrawal/create 判定为「路由 A」之后立刻执行。
 * 整个过程是「先占状态、再打款、最后结算」，任何一步失败都有明确落点：
 *   - 代付 API 失败 / 超时 → 退回 pending（riskStatus=auto_payout_failed），商户一键 Approve 兜底；
 *   - 代付成功但扣款失败 → 保持 processing + riskStatus=auto_payout_unsettled，
 *     宁可让商户看到异常单，也不能「钱付出去了、账上没扣」还悄悄标成功。
 */
export async function runAutoPayout(input: {
  withdrawalId: string;
  tenantId: string;
}): Promise<AutoPayoutExecutionResult> {
  const withdrawal = await prisma.withdrawal.findFirst({
    where: { id: input.withdrawalId, tenantId: input.tenantId },
    select: {
      id: true,
      amount: true,
      currency: true,
      walletAddress: true,
      status: true,
      player: { select: { balance: true } },
      gateway: {
        select: { id: true, name: true, payoutEndpoint: true, apiKey: true },
      },
    },
  });

  if (!withdrawal || withdrawal.status !== WITHDRAWAL_STATUS_PROCESSING) {
    return {
      status: "manual_review",
      reason: "not_processing",
      error: "该提现单不在自动出款处理中",
    };
  }

  if (!withdrawal.gateway) {
    await returnWithdrawalToManualReview({
      withdrawalId: withdrawal.id,
      tenantId: input.tenantId,
      riskStatus: AUTO_PAYOUT_RISK.autoPayoutFailed,
    });

    return { status: "manual_review", reason: "no_gateway", error: "通道已不存在" };
  }

  const amountNumber = Number(withdrawal.amount.toString());
  const balance = Number(withdrawal.player?.balance?.toString() ?? "0");

  // 预检余额：钱还没出去，直接退回人工（不要先把款打出去再发现扣不动）。
  if (!Number.isFinite(balance) || balance < amountNumber) {
    await returnWithdrawalToManualReview({
      withdrawalId: withdrawal.id,
      tenantId: input.tenantId,
      riskStatus: AUTO_PAYOUT_RISK.autoPayoutFailed,
    });

    return {
      status: "manual_review",
      reason: "insufficient_balance",
      error: "玩家余额不足",
    };
  }

  const payout = await requestGatewayPayout({
    withdrawalId: withdrawal.id,
    amount: withdrawal.amount.toFixed(2),
    currency: normalizePayoutCurrency(withdrawal.currency),
    destination: withdrawal.walletAddress,
    gateway: withdrawal.gateway,
    callbackUrl: buildWithdrawalCallbackUrl(),
  });

  if (!payout.ok) {
    await returnWithdrawalToManualReview({
      withdrawalId: withdrawal.id,
      tenantId: input.tenantId,
      riskStatus: AUTO_PAYOUT_RISK.autoPayoutFailed,
    });

    return {
      status: "manual_review",
      reason: "payout_api_failed",
      error: payout.error,
    };
  }

  const settled = await settleWithdrawalSuccess({
    withdrawalId: withdrawal.id,
    tenantId: input.tenantId,
    fromStatuses: [WITHDRAWAL_STATUS_PROCESSING],
    txHash: payout.txHash,
    riskStatus: AUTO_PAYOUT_RISK.autoPaid,
  });

  if (settled.settled) {
    return {
      status: "paid",
      txHash: payout.txHash,
      balance: settled.balance,
    };
  }

  if (settled.reason === "insufficient_balance") {
    // 款已经出去了但扣款失败：保持 processing + 打标，交给人工对账，
    // 绝不能悄悄置 success（那就等于凭空多给玩家一笔钱）。
    await prisma.withdrawal.updateMany({
      where: {
        id: withdrawal.id,
        tenantId: input.tenantId,
        status: WITHDRAWAL_STATUS_PROCESSING,
      },
      data: {
        riskStatus: AUTO_PAYOUT_RISK.autoPayoutUnsettled,
        txHash: payout.txHash,
      },
    });

    return { status: "unsettled", txHash: payout.txHash };
  }

  return {
    status: "manual_review",
    reason: "settle_failed",
    error: settled.reason,
  };
}

/* ------------------------------------------------------------------ *
 * 商户后台「自动出款引擎」配置面板（读 / 写）
 * ------------------------------------------------------------------ */

export type TenantPayoutEngineGateway = {
  id: string;
  name: string;
  providerType: string;
  isActive: boolean;
  /** 已配置的代付 API 地址（空 = 没配） */
  payoutEndpoint: string;
  /** 是否算「配了真实可用的代付 API」 */
  hasPayoutApi: boolean;
};

export type TenantPayoutEngineSnapshot = {
  /** 本站记账币种：限额、金额一律按它渲染 */
  currency: string;
  config: AutoPayoutConfig;
  /** 当日已自动出款总额（含在途） */
  dailyAutoPaidAmount: number;
  dailyAutoCount: number;
  /** 当日还剩多少自动出款额度（不小于 0） */
  dailyRemaining: number;
  /** 熔断状态：已达 / 超日限额，今天后续订单全部转人工 */
  breakerTripped: boolean;
  gateways: TenantPayoutEngineGateway[];
  /** 配了代付 API 的通道数（0 = 所有提现都只能人工） */
  payoutReadyCount: number;
  /** 正在自动出款中的笔数（processing） */
  processingCount: number;
  /** 待人工审批的笔数（pending） */
  pendingCount: number;
};

/**
 * 商户后台读侧：配置 + 当日用量 + 通道代付能力，一次查完（页面首屏与 GET 接口共用）。
 * 全部按 tenantId 过滤；平台通道不出现（`isPlatformGateway: false`）。
 */
export async function loadTenantPayoutEngine(
  tenantId: string,
): Promise<TenantPayoutEngineSnapshot> {
  const [tenant, usage, gateways, processingCount, pendingCount] =
    await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { currency: true, autoPayoutConfig: true },
      }),
      loadAutoPayoutDailyUsage({ tenantId }),
      prisma.paymentGateway.findMany({
        where: { ownerId: tenantId, isPlatformGateway: false },
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          providerType: true,
          isActive: true,
          payoutEndpoint: true,
        },
      }),
      prisma.withdrawal.count({ where: { tenantId, status: "processing" } }),
      prisma.withdrawal.count({ where: { tenantId, status: "pending" } }),
    ]);

  const config = normalizeAutoPayoutConfig(tenant?.autoPayoutConfig);
  const serializedGateways = gateways.map((gateway) => ({
    id: gateway.id,
    name: gateway.name,
    providerType: gateway.providerType,
    isActive: gateway.isActive,
    payoutEndpoint: gateway.payoutEndpoint ?? "",
    hasPayoutApi: isUsablePayoutEndpoint(gateway.payoutEndpoint),
  }));

  return {
    currency: normalizePayoutCurrency(tenant?.currency),
    config,
    dailyAutoPaidAmount: usage.amount,
    dailyAutoCount: usage.count,
    dailyRemaining: Math.max(0, config.dailyAutoLimit - usage.amount),
    breakerTripped: config.isEnabled && usage.amount >= config.dailyAutoLimit,
    gateways: serializedGateways,
    payoutReadyCount: serializedGateways.filter((item) => item.hasPayoutApi).length,
    processingCount,
    pendingCount,
  };
}

/** 写侧：只写自己的租户（tenantId 来自 guardTenantApi 的会话，不接受前端传入） */
export async function saveTenantAutoPayoutConfig(input: {
  tenantId: string;
  config: AutoPayoutConfig;
}) {
  await prisma.tenant.update({
    where: { id: input.tenantId },
    data: {
      autoPayoutConfig: {
        isEnabled: input.config.isEnabled,
        maxAutoAmount: input.config.maxAutoAmount,
        dailyAutoLimit: input.config.dailyAutoLimit,
      },
    },
  });
}

/**
 * 写侧：保存某条通道的代付 API 地址。
 *
 * `where` 里同时带上 ownerId 与 isPlatformGateway=false：
 * 别家的通道 / 平台通道在这里等价于「不存在」，商户无法把自己的代付地址
 * 挂到平台通道上（那就等于平台代付，触碰资金池红线）。
 */
export async function saveGatewayPayoutEndpoint(input: {
  tenantId: string;
  gatewayId: string;
  endpoint: string;
}): Promise<"ok" | "not_found"> {
  const endpoint = input.endpoint.trim();

  const updated = await prisma.paymentGateway.updateMany({
    where: {
      id: input.gatewayId,
      ownerId: input.tenantId,
      isPlatformGateway: false,
    },
    data: { payoutEndpoint: endpoint ? endpoint.slice(0, 500) : null },
  });

  return updated.count > 0 ? "ok" : "not_found";
}

/**
 * 批量保存代付 API 地址（配置面板一次保存多条通道）。
 *
 * 先一次性校验「这些通道是不是全是自己的」，任意一条不属于本站就整批拒绝
 * ——不做「跳过别家的、只存自己的」，那会让商户以为保存成功而实际没生效。
 */
export async function saveTenantPayoutEndpoints(input: {
  tenantId: string;
  entries: { gatewayId: string; endpoint: string }[];
}): Promise<"ok" | "not_found"> {
  const entries = input.entries.filter(
    (entry) => typeof entry.gatewayId === "string" && entry.gatewayId,
  );

  if (entries.length === 0) {
    return "ok";
  }

  const ids = [...new Set(entries.map((entry) => entry.gatewayId))];
  const owned = await prisma.paymentGateway.findMany({
    where: {
      id: { in: ids },
      ownerId: input.tenantId,
      isPlatformGateway: false,
    },
    select: { id: true },
  });

  if (owned.length !== ids.length) {
    return "not_found";
  }

  await prisma.$transaction(
    entries.map((entry) => {
      const endpoint = entry.endpoint.trim();

      return prisma.paymentGateway.update({
        where: { id: entry.gatewayId },
        data: { payoutEndpoint: endpoint ? endpoint.slice(0, 500) : null },
      });
    }),
  );

  return "ok";
}





