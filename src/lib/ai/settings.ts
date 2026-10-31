import { prisma } from "@/lib/prisma";

import {
  DEFAULT_AI_BASE_URLS,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  isAiProvider,
  type AiProviderValue,
} from "./constants";
import type { AiConnectionConfig } from "./provider";

/**
 * AI 全局接入配置（AiSettings）与运行时连接解析。
 *
 * 安全边界：
 * - 本模块只在服务端使用；对外返回的 apiKey 必须是掩码后的字符串。
 * - 保存时如果前端回传的仍是掩码（未修改），保留数据库里的原 Key。
 * - 不允许把 Key 写入日志或错误信息。
 */

export const GLOBAL_AI_SETTINGS_ID = "global";

export class AiSettingsError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AiSettingsError";
    this.status = status;
  }
}

export type AiSettingsSource = "database" | "environment" | "none" | "disabled";

export type AiSettingsSnapshot = {
  provider: AiProviderValue;
  /** 永远只返回掩码，例如 sk-****abcd；未配置时为空字符串。 */
  apiKey: string;
  baseUrl: string;
  model: string;
  isActive: boolean;
  hasApiKey: boolean;
  source: AiSettingsSource;
  updatedAt: string | null;
};

export type ResolvedAiConnection = AiConnectionConfig & {
  configured: boolean;
  provider: AiProviderValue;
  source: AiSettingsSource;
};

export type SaveAiSettingsInput = {
  provider: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  isActive?: unknown;
  clearApiKey?: unknown;
};

type AiSettingsRow = {
  id: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * 对外展示用的 Key 掩码：sk-1234567890abcd → sk-****abcd。
 * 太短的 Key 一律只保留末 4 位，避免反向推出全文。
 */
export function maskApiKey(apiKey: string): string {
  const value = apiKey.trim();

  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return "****";
  }

  const prefix = value.startsWith("sk-") ? "sk-" : value.slice(0, 2);

  return `${prefix}****${value.slice(-4)}`;
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function envConnection() {
  return {
    apiKey: (process.env.AI_API_KEY ?? "").trim(),
    baseUrl: normalizeBaseUrl(
      process.env.AI_BASE_URL ?? DEFAULT_AI_BASE_URLS.openai,
    ),
    model: (process.env.AI_MODEL ?? "gpt-4o-mini").trim(),
  };
}

function providerOf(value: string | undefined | null): AiProviderValue {
  return isAiProvider(value) ? value : DEFAULT_AI_PROVIDER;
}

function defaultModelFor(provider: AiProviderValue): string {
  return provider === "openai" ? "gpt-4o-mini" : DEFAULT_AI_MODEL;
}

function snapshotOf(
  row: AiSettingsRow | null,
  env: ReturnType<typeof envConnection>,
): AiSettingsSnapshot {
  const provider = providerOf(row?.provider);
  const databaseKey = (row?.apiKey ?? "").trim();
  const active = row ? row.isActive : true;
  const storedKey = databaseKey || env.apiKey;
  const effectiveKey = active ? storedKey : "";
  const source: AiSettingsSource = !active
    ? "disabled"
    : databaseKey
      ? "database"
      : env.apiKey
        ? "environment"
        : "none";

  return {
    provider,
    // 即使临时停用也保留掩码，方便管理员确认 Key 仍在库中。
    apiKey: maskApiKey(storedKey),
    baseUrl:
      normalizeBaseUrl(row?.baseUrl ?? "") ||
      env.baseUrl ||
      DEFAULT_AI_BASE_URLS[provider],
    model: row?.model?.trim() || env.model || defaultModelFor(provider),
    isActive: active,
    hasApiKey: Boolean(effectiveKey),
    source,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** 读取（或创建）全局配置行。seed 也会提前创建，这里兜底首次访问。 */
async function ensureAiSettingsRow(): Promise<AiSettingsRow> {
  return prisma.aiSettings.upsert({
    where: { id: GLOBAL_AI_SETTINGS_ID },
    update: {},
    create: {
      id: GLOBAL_AI_SETTINGS_ID,
      provider: DEFAULT_AI_PROVIDER,
      apiKey: "",
      baseUrl: DEFAULT_AI_BASE_URLS.deepseek,
      model: DEFAULT_AI_MODEL,
      isActive: true,
    },
  });
}

/** 后台展示数据：Key 已掩码；若数据库为空但环境变量有 Key，会标记 source=environment。 */
export async function getAiSettingsSnapshot(): Promise<AiSettingsSnapshot> {
  const row = await ensureAiSettingsRow();
  return snapshotOf(row, envConnection());
}

/**
 * 解析一次真实模型调用的连接参数。
 *
 * - 数据库已保存 Key 且 isActive=true → 使用数据库；
 * - 数据库没有 Key → 兼容旧部署，回退 AI_API_KEY；
 * - isActive=false → 明确禁用，不再回退环境变量；
 * - Agent 选择 DeepSeek 模型但全局供应商是 OpenAI（或反之）时，回退全局模型。
 */
export async function resolveAiConnection(
  agentModel?: string | null,
): Promise<ResolvedAiConnection> {
  const row = await prisma.aiSettings.findUnique({
    where: { id: GLOBAL_AI_SETTINGS_ID },
  });
  const env = envConnection();
  const provider = providerOf(row?.provider);

  if (row && !row.isActive) {
    return {
      configured: false,
      provider,
      source: "disabled",
      apiKey: "",
      baseUrl:
        normalizeBaseUrl(row.baseUrl) || DEFAULT_AI_BASE_URLS[provider],
      model: row.model.trim() || defaultModelFor(provider),
    };
  }

  const databaseKey = (row?.apiKey ?? "").trim();
  const apiKey = databaseKey || env.apiKey;
  const source: AiSettingsSource = databaseKey
    ? "database"
    : env.apiKey
      ? "environment"
      : "none";

  const baseUrl =
    normalizeBaseUrl(row?.baseUrl ?? "") ||
    env.baseUrl ||
    DEFAULT_AI_BASE_URLS[provider];

  const globalModel =
    row?.model?.trim() || env.model || defaultModelFor(provider);
  const requestedModel = agentModel?.trim() || globalModel;
  const requestedProvider = requestedModel.startsWith("deepseek")
    ? "deepseek"
    : requestedModel.startsWith("gpt")
      ? "openai"
      : provider;

  return {
    configured: Boolean(apiKey),
    provider,
    source,
    apiKey,
    baseUrl,
    model: requestedProvider === provider ? requestedModel : globalModel,
  };
}

function validateBaseUrl(value: string): string {
  const normalized = normalizeBaseUrl(value);

  if (!normalized) {
    return "";
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new AiSettingsError("Base URL 不是合法网址");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AiSettingsError("Base URL 只支持 http / https");
  }

  return normalized;
}

/**
 * 保存全局接入配置。apiKey 为空或仍等于掩码时，保留原 Key；
 * 显式传 clearApiKey=true 才会清空。
 */
export async function saveAiSettings(
  input: SaveAiSettingsInput,
): Promise<AiSettingsSnapshot> {
  if (!isAiProvider(input.provider)) {
    throw new AiSettingsError("供应商只能是 deepseek 或 openai");
  }

  const provider = input.provider;
  const current = await ensureAiSettingsRow();
  const baseUrlInput =
    typeof input.baseUrl === "string"
      ? validateBaseUrl(input.baseUrl)
      : normalizeBaseUrl(current.baseUrl);
  const baseUrl = baseUrlInput || DEFAULT_AI_BASE_URLS[provider];
  const model =
    typeof input.model === "string" && input.model.trim()
      ? input.model.trim().slice(0, 120)
      : defaultModelFor(provider);
  const isActive =
    typeof input.isActive === "boolean" ? input.isActive : current.isActive;

  let apiKey = current.apiKey;
  const clearApiKey = input.clearApiKey === true;
  const providedKey =
    typeof input.apiKey === "string" ? input.apiKey.trim() : "";

  if (clearApiKey) {
    apiKey = "";
  } else if (providedKey && providedKey !== maskApiKey(current.apiKey)) {
    if (providedKey.includes("****")) {
      throw new AiSettingsError(
        "检测到掩码字符串，请输入完整 API Key；不修改请留空",
      );
    }

    if (providedKey.length > 512) {
      throw new AiSettingsError("API Key 长度超出限制");
    }

    apiKey = providedKey;
  }

  const updated = await prisma.aiSettings.upsert({
    where: { id: GLOBAL_AI_SETTINGS_ID },
    update: { provider, apiKey, baseUrl, model, isActive },
    create: {
      id: GLOBAL_AI_SETTINGS_ID,
      provider,
      apiKey,
      baseUrl,
      model,
      isActive,
    },
  });

  return snapshotOf(updated, envConnection());
}
