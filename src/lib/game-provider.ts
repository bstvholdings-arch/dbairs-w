import { createHmac, timingSafeEqual } from "node:crypto";

import { fetchMockProviderGames, type MockGameSeed } from "./game-catalog";
import {
  readApiSecret,
  readIntegrationUrl,
  readMerchantId,
} from "./integrations";

/**
 * 游戏商对接底层（Game Provider Client）。
 *
 * 目前阶段：所有「请求游戏商」的动作都是 **模拟** —— 不发起任何网络调用，
 * 只按 GameProvider 里配置好的 apiEndpoint / merchantId / apiSecret 组出
 * 「真实接入时会发出的那个请求」（URL、商户号、签名），再用 Mock 目录顶上。
 *
 * 等拿到 PG Soft 等厂商的《API 接口对接文档》后，只需要替换本文件里的
 * `fetchProviderCatalog()` 与 `buildGameLaunchTicket()` 内部实现：
 *   - 目录同步：POST /api/v1/games/list（换成文档里的真实路径与参数）
 *   - 游戏启动：URL + token 的拼装规则按文档调整
 * 上层的同步接口 / 启动接口 / 回调接口无需改动。
 */

/** 未配置 Endpoint 时使用的占位地址：只会出现在「模拟请求」描述里，不会被真正请求。 */
export const MOCK_PROVIDER_ENDPOINT = "https://mock.game-provider.local";

/** 未配置密钥时使用的占位密钥：仅用于让 Mock 签名串看起来完整，绝不代表安全能力。 */
const MOCK_PROVIDER_SECRET = "mock-provider-secret";

/** 对接文档落地后，这些路径按厂商文档替换即可。 */
export const GAME_PROVIDER_CATALOG_PATH = "/api/v1/games/list";
export const GAME_PROVIDER_LAUNCH_PATH = "/api/v1/game/launch";

/** 一把启动 token 的有效期（毫秒）。 */
const LAUNCH_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * 从数据库读出的游戏商配置（只在服务端使用）。
 * apiSecret 明文只参与签名，永远不会进入响应体。
 */
export type GameProviderCredentials = {
  id: string;
  name: string;
  apiEndpoint: string | null;
  merchantId: string | null;
  apiSecret: string | null;
};

export type GameProviderConnection = {
  id: string;
  name: string;
  /** 规范化后的 base URL；未配置为空串 */
  apiEndpoint: string;
  /** 商户号；未配置为空串 */
  merchantId: string;
  /** 签名密钥明文；未配置为空串。只允许留在服务端内存里。 */
  apiSecret: string;
  /** endpoint + merchantId + apiSecret 三项齐全 */
  configured: boolean;
  /** 配置缺失 / 非法的可读提示，接口原样下发给后台排查 */
  warnings: string[];
};

/**
 * 把 GameProvider 行解析成「可用的连接配置」。
 * 即使配置不全也不抛错：同步接口照样能跑 Mock 目录，只是把 warnings 带回后台，
 * 方便商户在看到「同步成功」的同时知道还差哪几项才能接真实接口。
 */
export function resolveGameProviderConnection(
  provider: GameProviderCredentials,
): GameProviderConnection {
  const warnings: string[] = [];

  const endpoint = readIntegrationUrl(provider.apiEndpoint);
  const merchantId = readMerchantId(provider.merchantId);
  const apiSecret = readApiSecret(provider.apiSecret);

  if (endpoint === null) {
    warnings.push("API Endpoint 格式不正确：必须是 http(s) 开头的绝对地址");
  }

  if (merchantId === null) {
    warnings.push("商户号格式不正确：只允许字母、数字与 . _ -，最长 64 位");
  }

  if (apiSecret === null) {
    warnings.push("签名密钥格式不正确：不能包含空格，最长 200 位");
  }

  const safeEndpoint = endpoint ?? "";
  const safeMerchantId = merchantId ?? "";
  const safeSecret = apiSecret ?? "";

  if (!safeEndpoint) {
    warnings.push("未配置 API Endpoint：当前使用 Mock 游戏目录，不会请求真实游戏商");
  }

  if (!safeMerchantId) {
    warnings.push("未配置商户号：真实接入前必须填写游戏商分配的 merchantId");
  }

  if (!safeSecret) {
    warnings.push("未配置签名密钥：真实回调验签前必须填写 apiSecret");
  }

  return {
    id: provider.id,
    name: provider.name,
    apiEndpoint: safeEndpoint,
    merchantId: safeMerchantId,
    apiSecret: safeSecret,
    configured: Boolean(safeEndpoint && safeMerchantId && safeSecret),
    warnings,
  };
}

/** 拼接游戏商地址：去掉 base 末尾斜杠，避免出现 //api/v1/... 。 */
export function joinProviderUrl(baseUrl: string, path: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");

  if (!base) {
    return path;
  }

  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * 模拟请求的可读描述：写进同步接口的响应里，
 * 让后台能直接看到「如果现在接真实接口，会往哪儿发什么」。
 */
export type ProviderRequestTrace = {
  mode: "mock";
  method: "POST";
  url: string;
  merchantId: string;
  /** 只回显签名前缀，完整签名 / 密钥永远不会下发 */
  signaturePreview: string;
  signedAt: string;
};

export type ProviderCatalogFetch = {
  games: MockGameSeed[];
  request: ProviderRequestTrace;
};

export type GameLaunchInput = {
  /** 游戏商侧游戏编码（Game.externalId） */
  gameCode: string;
  playerId: string;
  tenantId: string;
  currency: string;
  language: string;
  /** 商户自己的回跳地址，可为空 */
  returnUrl: string;
};

export type GameLaunchTicket = {
  mode: "mock";
  url: string;
  token: string;
  expiresAt: string;
  warnings: string[];
};

/**
 * 游戏商请求签名：hex(HMAC-SHA256(rawBody, apiSecret))。
 * 回调验签、目录同步签名共用同一套算法，换成真实厂商时按文档调整即可。
 */
export function createProviderSignature(secret: string, rawBody: string) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * 校验游戏商回调签名。
 * header 支持裸 hex，也兼容 `sha256=<hex>` 写法；长度不等时直接失败（timingSafeEqual 要求等长）。
 */
export function verifyProviderSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
) {
  if (!signatureHeader || !secret) {
    return false;
  }

  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  const expectedHex = createProviderSignature(secret, rawBody);
  const providedBuffer = Buffer.from(provided.trim().toLowerCase(), "hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

/**
 * 回调是否强制验签：生产环境默认强制；本地开发默认放行，方便 Postman 模拟。
 * 与支付回调（PAYMENT_CALLBACK_REQUIRE_SIGNATURE）保持同一套开关语义。
 */
export function providerCallbackSignatureRequired() {
  const configured = process.env.GAME_CALLBACK_REQUIRE_SIGNATURE?.trim().toLowerCase();

  if (configured === "true") {
    return true;
  }

  if (configured === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

/**
 * 「请求游戏商拉取游戏列表」。
 *
 * 当前实现是 Mock：返回内置目录 + 一份模拟请求描述，不发起网络请求。
 * 真实接入时把这里换成 `await fetch(trace.url, { ... })` 并解析厂商返回的
 * 游戏数组（映射成 MockGameSeed 的形状）即可，game-sync.ts 无需改动。
 */
export async function fetchProviderCatalog(
  connection: GameProviderConnection,
): Promise<ProviderCatalogFetch> {
  const signedAt = new Date().toISOString();
  const body = JSON.stringify({
    merchantId: connection.merchantId || "mock-merchant",
    currency: "USDT",
    locale: "en",
  });
  const signature = createProviderSignature(
    connection.apiSecret || MOCK_PROVIDER_SECRET,
    body,
  );

  return {
    games: fetchMockProviderGames(connection.name),
    request: {
      mode: "mock",
      method: "POST",
      url: joinProviderUrl(
        connection.apiEndpoint || MOCK_PROVIDER_ENDPOINT,
        GAME_PROVIDER_CATALOG_PATH,
      ),
      merchantId: connection.merchantId || "(未配置)",
      signaturePreview: `sha256=${signature.slice(0, 12)}…`,
      signedAt,
    },
  };
}

/**
 * 生成玩家进入游戏的测试地址（Seamless Wallet 启动票据）。
 *
 * 真实接入时的典型流程是：平台带着 merchantId + playerId + gameCode + 签名
 * 请求游戏商的 launch 接口，拿到对方返回的一次性游戏地址。这里为了能立刻联调，
 * 直接按同样的参数拼一个「测试 Game URL」：域名来自 API Endpoint，
 * token 用 API Secret 签名（未配置时用占位密钥）。
 */
export function buildGameLaunchTicket(
  connection: GameProviderConnection,
  input: GameLaunchInput,
): GameLaunchTicket {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + LAUNCH_TOKEN_TTL_MS);
  const merchantId = connection.merchantId || "mock-merchant";
  const rawToken = `${merchantId}.${input.playerId}.${input.gameCode}.${issuedAt.getTime()}`;
  const signature = createProviderSignature(
    connection.apiSecret || MOCK_PROVIDER_SECRET,
    rawToken,
  );
  const token = `${Buffer.from(rawToken, "utf8").toString("base64url")}.${signature.slice(0, 32)}`;

  const url = new URL(
    joinProviderUrl(
      connection.apiEndpoint || MOCK_PROVIDER_ENDPOINT,
      GAME_PROVIDER_LAUNCH_PATH,
    ),
  );

  url.searchParams.set("merchantId", merchantId);
  url.searchParams.set("gameCode", input.gameCode);
  url.searchParams.set("playerId", input.playerId);
  url.searchParams.set("currency", input.currency);
  url.searchParams.set("language", input.language);
  url.searchParams.set("token", token);
  url.searchParams.set("expiresAt", expiresAt.toISOString());

  if (input.returnUrl) {
    url.searchParams.set("returnUrl", input.returnUrl);
  }

  return {
    mode: "mock",
    url: url.toString(),
    token,
    expiresAt: expiresAt.toISOString(),
    warnings: connection.warnings,
  };
}

const CURRENCY_PATTERN = /^[A-Z]{2,10}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/;
const GAME_CODE_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

/** 币种：默认 USDT，非法返回 ""。 */
export function readGameCurrency(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "USDT";
  }

  if (typeof value !== "string") {
    return "";
  }

  const currency = value.trim().toUpperCase();

  return CURRENCY_PATTERN.test(currency) ? currency : "";
}

/** 语言：默认 zh，非法返回 ""。 */
export function readGameLanguage(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "zh";
  }

  if (typeof value !== "string") {
    return "";
  }

  const language = value.trim();

  return LANGUAGE_PATTERN.test(language) ? language : "";
}

/** 游戏编码 / 上游单号这类「短标识」：只允许常见安全字符，非法返回 null。 */
export function readGameCode(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  return GAME_CODE_PATTERN.test(text) ? text : null;
}
