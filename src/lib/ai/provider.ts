/**
 * 极简 OpenAI 兼容 Chat Completions 客户端。
 *
 * 项目没有引入任何 AI SDK；只要服务商兼容 /chat/completions（OpenAI、DeepSeek、
 * Moonshot、OneAPI、vLLM…）即可。运行时连接优先使用数据库 AiSettings，
 * 未配置时回退到环境变量：
 *   AI_API_KEY   —— 必填；为空时调用方自动降级为本地规则回复
 *   AI_BASE_URL  —— 默认 https://api.openai.com/v1
 *   AI_MODEL     —— 默认 gpt-4o-mini
 *
 * 这里只做「一轮补全」，多轮 / 工具循环由 /api/ai/chat 负责。
 */

export type AiProviderToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AiProviderMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: AiProviderToolCall[];
    }
  | { role: "tool"; content: string; tool_call_id: string };

export type AiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AiCompletion = {
  content: string;
  toolCalls: AiProviderToolCall[];
  model: string;
  /** true = 未配置 API Key，使用本地规则兜底，界面上需要提示。 */
  fallback: boolean;
  finishReason: string | null;
};

/** 一次真实请求使用的连接参数（来自数据库 AiSettings 或环境变量）。 */
export type AiConnectionConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export class AiProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
  }
}

type OpenAiToolCall = {
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
};

type OpenAiMessage = {
  content?: unknown;
  tool_calls?: unknown;
};

type OpenAiChoice = {
  message?: OpenAiMessage;
  finish_reason?: unknown;
};

type OpenAiResponse = {
  choices?: unknown;
  error?: {
    message?: unknown;
  };
};

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeToolCalls(value: unknown): AiProviderToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const calls: AiProviderToolCall[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const call = raw as OpenAiToolCall;
    const name = readString(call.function?.name);
    const args = call.function?.arguments;

    if (!name) {
      continue;
    }

    calls.push({
      id: readString(call.id) || `call_${calls.length + 1}`,
      type: "function",
      function: {
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      },
    });
  }

  return calls;
}

export function getAiRuntimeConfig() {
  const apiKey = (process.env.AI_API_KEY ?? "").trim();
  const baseUrl = (
    process.env.AI_BASE_URL ?? "https://api.openai.com/v1"
  ).trim().replace(/\/+$/, "");
  const model = (process.env.AI_MODEL ?? "gpt-4o-mini").trim();

  return {
    configured: Boolean(apiKey),
    apiKey,
    baseUrl,
    model,
  };
}

export function isAiConfigured() {
  return getAiRuntimeConfig().configured;
}

export async function requestChatCompletion(
  messages: AiProviderMessage[],
  options: {
    tools?: AiToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    /** 传入数据库配置；不传时回退到环境变量。 */
    connection?: AiConnectionConfig;
  } = {},
): Promise<AiCompletion> {
  const config: AiConnectionConfig =
    options.connection ??
    (() => {
      const runtime = getAiRuntimeConfig();
      return {
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        model: runtime.model,
      };
    })();

  if (!config.apiKey.trim()) {
    throw new AiProviderError(
      "未配置 AI API Key，无法调用云端模型。请先在「AI 控制中心 → 模型接入」保存 Key，或使用本地规则兜底。",
      503,
    );
  }

  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const model = config.model.trim() || "gpt-4o-mini";

  const tools = options.tools ?? [];
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 800,
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      // AI 回复必须实时，禁止 Next.js 数据缓存复用上一次补全。
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AiProviderError(`AI 服务网络异常：${reason}`, 502);
  }

  let payload: OpenAiResponse;

  try {
    payload = (await response.json()) as OpenAiResponse;
  } catch {
    throw new AiProviderError(
      `AI 服务返回了非 JSON 响应（HTTP ${response.status}）`,
      502,
    );
  }

  if (!response.ok) {
    const message =
      readString(payload.error?.message) ||
      `AI 服务调用失败（HTTP ${response.status}）`;
    throw new AiProviderError(message, response.status >= 500 ? 502 : 400);
  }

  const choices = Array.isArray(payload.choices)
    ? (payload.choices as OpenAiChoice[])
    : [];
  const choice = choices[0];

  if (!choice?.message) {
    throw new AiProviderError("AI 服务没有返回任何回复", 502);
  }

  return {
    content: readString(choice.message.content).trim(),
    toolCalls: normalizeToolCalls(choice.message.tool_calls),
    model,
    fallback: false,
    finishReason: readString(choice.finish_reason) || null,
  };
}
