/**
 * REDIRECT_URL（网银跳转）充值通道的「支持银行」清单。
 *
 * 为什么单独一个文件：
 * - 商户后台（/tenant/payments 通道表单）要用它渲染勾选框；
 * - 玩家收银台（/api/deposit/gateways + 充值弹窗）要用它渲染银行卡片；
 * - 服务端 /api/deposit/create 要用它校验玩家提交的银行。
 * 三处必须是同一份清单、同一套归一化规则，否则「后台能勾、玩家点不动」
 * 或者「玩家能选、服务端拒收」。
 *
 * 存库口径只认 `code`（小写 slug，如 maybank / public_bank），
 * 展示名是银行自己的专有名词（Maybank / CIMB Bank…），中英一致，不进词典。
 */

export type GatewayBankOption = {
  /** 存库与拼进支付链接的口径（小写 slug） */
  code: string;
  /** 玩家 / 商户看到的银行名（专有名词，不翻译） */
  label: string;
};

/**
 * 内置银行目录。
 *
 * 只放「网银跳转 / 托管收银台」里最常见的一批（马来西亚为主，兼顾国际银行），
 * 商户不在清单里的银行可以在后台用「其他银行」手工补充 —— 不要为了加一家银行
 * 就改代码，那会让升级变成业务动作。
 */
export const GATEWAY_BANK_CATALOG: readonly GatewayBankOption[] = [
  { code: "maybank", label: "Maybank" },
  { code: "cimb", label: "CIMB Bank" },
  { code: "public_bank", label: "Public Bank" },
  { code: "rhb", label: "RHB Bank" },
  { code: "hong_leong", label: "Hong Leong Bank" },
  { code: "bank_islam", label: "Bank Islam" },
  { code: "ambank", label: "AmBank" },
  { code: "affin", label: "Affin Bank" },
  { code: "bank_rakyat", label: "Bank Rakyat" },
  { code: "bsn", label: "Bank Simpanan Nasional" },
  { code: "ocbc", label: "OCBC Bank" },
  { code: "uob", label: "UOB" },
  { code: "standard_chartered", label: "Standard Chartered" },
  { code: "hsbc", label: "HSBC" },
] as const;

/** 单条通道最多支持多少家银行：够用且不会把弹窗撑成一屏卡片墙。 */
export const MAX_SUPPORTED_BANKS = 20;

/** 存库口径：小写字母 / 数字开头，允许 _ 与 -，最长 32。 */
const BANK_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const CATALOG_BY_CODE = new Map(
  GATEWAY_BANK_CATALOG.map((bank) => [bank.code, bank] as const),
);

/**
 * 把「银行名 / 银行编码」统一成存库口径：
 * `Public Bank` → `public_bank`，`Maybank2u` → `maybank2u`，`CIMB` → `cimb`。
 *
 * 商户后台允许直接填银行名（省得去查编码），所以这里必须能容错：
 * 大写、空格、点、括号全部折叠成 `_`，连续分隔符压成一个。
 */
export function normalizeBankCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .replace(/[_-]{2,}/g, "_")
    .slice(0, 32);
}

/**
 * 归一化银行列表：接受数组（后台勾选）或字符串（逗号 / 换行 / 空格分隔），
 * 去重、去空、丢弃非法编码，保持提交顺序。
 *
 * 注意：这里**不做数量截断**。超限由 validateSupportedBanks 明确报错，
 * 而不是悄悄丢掉第 21 家银行（商户会以为勾上了）。
 */
export function normalizeSupportedBanks(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，;；\n\r]+/)
      : [];

  const result: string[] = [];

  for (const item of raw) {
    // 数组里也可能塞着 "maybank,cimb" 这种整体，统一再拆一次
    const parts =
      typeof item === "string" ? item.split(/[,，;；\n\r]+/) : [item];

    for (const part of parts) {
      const code = normalizeBankCode(part);

      if (!code || !BANK_CODE_PATTERN.test(code) || result.includes(code)) {
        continue;
      }

      result.push(code);
    }
  }

  return result;
}

/** 校验归一化后的列表；返回中文错误（空串 = 通过）。 */
export function validateSupportedBanks(banks: readonly string[]) {
  if (banks.length > MAX_SUPPORTED_BANKS) {
    return `单条通道最多支持 ${MAX_SUPPORTED_BANKS} 家银行`;
  }

  for (const code of banks) {
    if (!BANK_CODE_PATTERN.test(code)) {
      return `银行编码不合法：${code}`;
    }
  }

  return "";
}

/** 银行编码 → 展示名；目录里没有的（商户手工补充）按 slug 还原成可读文本。 */
export function gatewayBankLabel(code: string) {
  const normalized = normalizeBankCode(code);
  const known = CATALOG_BY_CODE.get(normalized);

  if (known) {
    return known.label;
  }

  return normalized
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** 银行卡片左上角的字母徽标（"Maybank" → "M"，"UOB" → "U"）。 */
export function gatewayBankInitial(code: string) {
  return gatewayBankLabel(code).charAt(0).toUpperCase() || "?";
}

/** 玩家端渲染用的银行卡片列表（顺序与后台勾选顺序一致）。 */
export function buildGatewayBankOptions(
  banks: readonly string[],
): GatewayBankOption[] {
  return normalizeSupportedBanks(banks).map((code) => ({
    code,
    label: gatewayBankLabel(code),
  }));
}

export type DepositBankSelection =
  | { ok: true; bank: string }
  | { ok: false; error: string };

/**
 * 下单时的银行选择校验（服务端唯一口径，前端只做体验提示）。
 *
 * 规则：
 * - 非 REDIRECT_URL 通道 → 忽略 bank（空串），防止把脏参数拼进支付链接；
 * - REDIRECT_URL 且商户没配银行列表 → 也不接受 bank（支付商收银台自己选）；
 * - REDIRECT_URL 且配了银行列表 → 必须选，且必须在列表内，否则 400。
 *
 * 这里是「玩家提交的银行」唯一可信校验点，前端 selectedBank 只是 UI 状态。
 */
export function resolveDepositBankSelection(input: {
  gatewayType: string;
  supportedBanks: readonly string[];
  requestedBank: unknown;
}): DepositBankSelection {
  if (input.gatewayType !== "REDIRECT_URL") {
    return { ok: true, bank: "" };
  }

  const supported = normalizeSupportedBanks(input.supportedBanks);

  if (supported.length === 0) {
    return { ok: true, bank: "" };
  }

  const requested = normalizeBankCode(input.requestedBank);

  if (!requested) {
    return { ok: false, error: "请选择付款银行" };
  }

  if (!supported.includes(requested)) {
    return { ok: false, error: "所选银行不在该通道支持范围内，请重新选择" };
  }

  return { ok: true, bank: requested };
}
