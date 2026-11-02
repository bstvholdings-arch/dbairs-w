import type { TranslationKey } from "@/lib/i18n-types";

/**
 * API 与集成中心（/admin/integrations）的共享定义。
 *
 * 本文件刻意不 import prisma / next/* / node:* —— 同一份常量与校验规则要同时被：
 *   1) 服务端接口：/api/admin/integrations、/api/admin/tenants/[id] 及其子路由
 *   2) 客户端页面：区域 A（回调地址）/ B（IP 白名单）/ D（商户对接资料与编辑弹窗）
 * 引用，才能保证「前端校验通过 = 后端接受」，不会出现两边规则各写一套的割裂。
 *
 * 生成密钥需要 node:crypto，单独放在 src/lib/integration-keys.ts（只有服务端引用）。
 */

/** active = 路由已上线可回调；planned = 已与商户约定地址、路由待接入。 */
export type IntegrationEndpointStatus = "active" | "planned";

/**
 * 区域 A 展示的系统回调地址。
 * path 必须对应真实的 Route Handler；尚未实现的路由一律标记为 planned，
 * 避免把 404 地址当成可用 webhook 发给支付商 / 游戏商。
 */
export const INTEGRATION_ENDPOINTS = [
  {
    id: "deposit",
    path: "/api/deposit/callback",
    labelKey: "integrations.endpoint.deposit",
    descKey: "integrations.endpoint.desc.deposit",
    status: "active",
  },
  {
    id: "withdrawal",
    path: "/api/withdrawal/callback",
    labelKey: "integrations.endpoint.withdrawal",
    descKey: "integrations.endpoint.desc.withdrawal",
    status: "active",
  },
  {
    id: "testCallback",
    path: "/api/deposit/test-callback",
    labelKey: "integrations.endpoint.testCallback",
    descKey: "integrations.endpoint.desc.testCallback",
    status: "active",
  },
  {
    id: "games",
    path: "/api/games/callback",
    labelKey: "integrations.endpoint.games",
    descKey: "integrations.endpoint.desc.games",
    status: "active",
  },
] as const satisfies readonly {
  id: string;
  path: string;
  labelKey: TranslationKey;
  descKey: TranslationKey;
  status: IntegrationEndpointStatus;
}[];

export type IntegrationEndpointId = (typeof INTEGRATION_ENDPOINTS)[number]["id"];

/** 区域 A 的单行数据（baseUrl 已在服务端拼好，客户端只负责展示与复制）。 */
export type IntegrationEndpointView = {
  id: string;
  url: string;
  labelKey: TranslationKey;
  descKey: TranslationKey;
  status: IntegrationEndpointStatus;
};

/** 区域 B 的单条白名单。 */
export type IntegrationIpRow = {
  id: string;
  ip: string;
  note: string | null;
  createdAt: string;
};

/**
 * 区域 C-1 的游戏商行（Game Providers 页签）。
 * maskedSecret 由服务端掩码，任何情况下都不下发 GameProvider.apiSecret 明文。
 */
export type IntegrationProviderRow = {
  id: string;
  name: string;
  apiEndpoint: string;
  merchantId: string;
  maskedSecret: string;
  hasSecret: boolean;
  status: string;
  isActive: boolean;
};

/** 区域 C-2 的支付通道行（Payment Gateways 页签）。 */
export type IntegrationGatewayRow = {
  id: string;
  name: string;
  providerType: string;
  gatewayType: string;
  currency: string;
  endpoint: string;
  maskedKey: string;
  hasKey: boolean;
  isActive: boolean;
  isPlatformGateway: boolean;
  /** 空串 = 平台公用通道；有值 = 商户专属通道的商户名。 */
  ownerName: string;
  reviewStatus: string;
};

/** 区域 D 的商户行，字段全部经过脱敏：绝不下发 Tenant.apiKey 明文。 */
export type IntegrationTenantRow = {
  id: string;
  name: string;
  domain: string;
  subdomain: string;
  status: string;
  contactEmail: string;
  apiCallbackUrl: string;
  backendIp: string;
  walletAddress: string;
  maskedKey: string;
  hasKey: boolean;
  apiKeyUpdatedAt: string | null;
};

/** GET /api/admin/integrations 的完整返回体，也是页面首屏的服务端快照。 */
export type IntegrationSnapshot = {
  baseUrl: string;
  endpoints: IntegrationEndpointView[];
  ipWhitelist: IntegrationIpRow[];
  providers: IntegrationProviderRow[];
  gateways: IntegrationGatewayRow[];
  tenants: IntegrationTenantRow[];
};

/** 拼接对外展示的完整回调地址（baseUrl 末尾斜杠会被去掉，避免出现 //）。 */
export function buildIntegrationUrl(baseUrl: string, path: string) {
  return `${baseUrl.trim().replace(/\/+$/, "")}${path}`;
}

/** 按 id 取回调路由的相对路径（邮件正文里拼完整地址时用）。 */
export function integrationEndpointPath(id: IntegrationEndpointId) {
  return INTEGRATION_ENDPOINTS.find((endpoint) => endpoint.id === id)?.path ?? "";
}

/**
 * API Key 掩码：sk-**** + 后 4 位。
 * 长度不足以保留后 4 位时整体打码，任何情况下都不回显完整密钥。
 */
export function maskApiKey(value: string | null | undefined) {
  const key = (value ?? "").trim();

  if (!key) {
    return "";
  }

  if (key.length <= 12) {
    return "sk-****";
  }

  return `sk-****${key.slice(-4)}`;
}

/**
 * 游戏商 Secret 脱敏：固定 8 个圆点 + 后 4 位。
 * 与 maskApiKey 分开命名，避免把「商户 API Key」和「游戏商签名密钥」混为一谈。
 */
export function maskIntegrationSecret(value: string | null | undefined) {
  const secret = (value ?? "").trim();

  if (!secret) {
    return "";
  }

  if (secret.length <= 8) {
    return "••••••••";
  }

  return `••••••••${secret.slice(-4)}`;
}

export const INTEGRATION_URL_MAX_LENGTH = 500;

/**
 * 读取游戏商 API Endpoint：返回 ""（未填写）、规范化后的 http(s) 地址，或 null（非法）。
 * 与商户专属回调地址同一套规则（必须是绝对地址），直接复用 readCallbackUrl 的实现。
 */
export function readIntegrationUrl(value: unknown): string | null {
  return readCallbackUrl(value);
}

/** 客户端表单用的布尔校验（空字符串返回 false）。 */
export function isValidIntegrationUrl(value: string) {
  return readIntegrationUrl(value) !== null && value.trim().length > 0;
}

export const MERCHANT_ID_MAX_LENGTH = 64;

// 商户号只允许常见字符，避免复制粘贴时带进换行 / 空格污染签名串。
const MERCHANT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** 读取游戏商分配的商户号：返回 ""（未填写）、合法商户号，或 null（非法）。 */
export function readMerchantId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text) {
    return "";
  }

  if (text.length > MERCHANT_ID_MAX_LENGTH || !MERCHANT_ID_PATTERN.test(text)) {
    return null;
  }

  return text;
}

export const API_SECRET_MAX_LENGTH = 200;

/**
 * 读取游戏商签名密钥：返回 ""（未填写 / 本次不修改），或去掉首尾空白的密钥。
 * 密钥内部不允许出现空白字符，否则签名结果会和上游对不上。
 */
export function readApiSecret(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text) {
    return "";
  }

  if (text.length > API_SECRET_MAX_LENGTH || /\s/.test(text)) {
    return null;
  }

  return text;
}

export const WALLET_ADDRESS_MAX_LENGTH = 128;

// 覆盖 TRC20（T 开头 base58）、ERC20（0x 开头 hex）与法币账号（IBAN 等带 - _ :）。
const WALLET_ADDRESS_PATTERN = /^[A-Za-z0-9:_-]+$/;

/** 读取商户结算钱包地址：返回 ""（未填写）、合法地址，或 null（非法）。 */
export function readWalletAddress(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text) {
    return "";
  }

  if (
    text.length > WALLET_ADDRESS_MAX_LENGTH ||
    !WALLET_ADDRESS_PATTERN.test(text)
  ) {
    return null;
  }

  return text;
}

/**
 * 读取商户后台出口 IP：返回 ""（未填写）、规范化后的小写 IP / CIDR 段，或 null（非法）。
 * 复用白名单的 isIpOrCidr，保证「商户资料里的 IP 能被直接加进白名单」。
 */
export function readBackendIp(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim().toLowerCase();

  if (!text) {
    return "";
  }

  return isIpOrCidr(text) ? text : null;
}

export const CONTACT_EMAIL_MAX_LENGTH = 120;


/** 与 src/lib/mailer.ts 的收件人校验同一口径，避免「看着能存，其实发不出去」。 */
const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * 读取对接邮箱：返回 ""（未填写）、规范化后的小写邮箱，或 null（格式非法）。
 * 与 src/lib/tenant-admin-email.ts 的 readTenantAdminEmail 保持同样的返回约定，
 * 便于接口里统一写 `if (email === null) return 400`。
 */
export function readContactEmail(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  if (!email) {
    return "";
  }

  if (email.length > CONTACT_EMAIL_MAX_LENGTH) {
    return null;
  }

  return CONTACT_EMAIL_PATTERN.test(email) ? email : null;
}

/** 客户端表单用的布尔校验（空字符串返回 false）。 */
export function isValidContactEmail(value: string) {
  return readContactEmail(value) !== null && value.trim().length > 0;
}

export const CALLBACK_URL_MAX_LENGTH = 500;

/**
 * 读取商户专属回调地址：返回 ""（未填写，表示沿用平台默认地址）、
 * 规范化后的 http(s) URL，或 null（非法）。只接受绝对地址，
 * 因为回调是服务端主动 POST 出去的，相对路径没有任何意义。
 */
export function readCallbackUrl(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();

  if (!raw) {
    return "";
  }

  if (raw.length > CALLBACK_URL_MAX_LENGTH) {
    return null;
  }

  if (!/^https?:\/\//i.test(raw)) {
    return null;
  }

  try {
    const url = new URL(raw);

    if (!url.hostname) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

/** 客户端表单用的布尔校验（空字符串返回 false）。 */
export function isValidCallbackUrl(value: string) {
  return readCallbackUrl(value) !== null && value.trim().length > 0;
}

const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// IPv6 只做结构性校验（完整展开 / 压缩写法的逐一校验对本场景收益很低），
// 真正的拦截交给网关与安全组；这里的目标是挡掉明显的手误。
const IPV6_PATTERN = /^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i;

/** 单个 IP 或 CIDR 段是否合法（IPv4 / IPv6）。 */
export function isIpOrCidr(value: string) {
  const text = value.trim();

  if (!text) {
    return false;
  }

  const parts = text.split("/");

  if (parts.length > 2) {
    return false;
  }

  const [address, prefix] = parts;

  if (address.includes(":")) {
    if (!IPV6_PATTERN.test(address)) {
      return false;
    }

    if (prefix === undefined) {
      return true;
    }

    return /^\d{1,3}$/.test(prefix) && Number(prefix) <= 128;
  }

  if (!IPV4_PATTERN.test(address)) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  return /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
}

/** 单次最多提交多少条：批量粘贴整段 Excel 时防止接口被拖死。 */
export const IP_WHITELIST_BATCH_LIMIT = 100;

/**
 * 解析批量粘贴的白名单文本：按换行 / 逗号 / 分号 / 空格切分，
 * 去空、去重（IPv6 统一小写）、校验，分别返回合法与非法的条目。
 * 接口和页面共用它，保证「页面上数到的条数」= 「接口实际处理的条数」。
 */
export function parseIpWhitelistInput(value: unknown) {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join("\n")
    : typeof value === "string"
      ? value
      : "";

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const token of raw.split(/[\s,;]+/)) {
    const entry = token.trim();

    if (!entry) {
      continue;
    }

    const normalized = entry.toLowerCase();

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);

    if (isIpOrCidr(entry)) {
      valid.push(normalized);
    } else {
      invalid.push(entry);
    }
  }

  return { valid, invalid };
}
