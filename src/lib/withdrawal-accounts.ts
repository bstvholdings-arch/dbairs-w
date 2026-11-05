/**
 * 玩家提现账号的纯逻辑：币种目录 + 字段校验 + 展示掩码。
 * 不依赖 Prisma / next，前端动态表单与 Route Handler 共用同一份规则，
 * 保证「前端提示」与「后端拒绝」始终一致。
 */
import type { TranslationKey } from "@/lib/i18n-types";

export const PLAYER_WITHDRAWAL_ACCOUNT_TYPES = ["crypto", "bank"] as const;

export type PlayerWithdrawalAccountType =
  (typeof PLAYER_WITHDRAWAL_ACCOUNT_TYPES)[number];

/** 玩家端看到的提现账号（服务端序列化后传给客户端，时间统一用字符串） */
export type PlayerWithdrawalAccountView = {
  id: string;
  currency: string;
  network: string;
  accountType: PlayerWithdrawalAccountType;
  walletAddress: string | null;
  bankName: string | null;
  /** 已掩码，只保留后 4 位（见 maskBankAccountNumber） */
  accountNumber: string | null;
  accountName: string | null;
  isDefault: boolean;
  createdAt: string;
};

export const WITHDRAWAL_BANK_NAME_MAX_LENGTH = 80;
export const WITHDRAWAL_BANK_ACCOUNT_MIN_LENGTH = 5;
export const WITHDRAWAL_BANK_ACCOUNT_MAX_LENGTH = 34;
export const WITHDRAWAL_ACCOUNT_NAME_MAX_LENGTH = 80;

/** TRC20 地址：T 开头 + 33 位 Base58；ERC20 地址：0x + 40 位十六进制。 */
const TRC20_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const ERC20_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
/** 银行名称允许中英文、数字与常见标点（如 "Maybank Berhad" / "中国工商银行"）。 */
const BANK_NAME_PATTERN = /^[\p{L}\p{M}\p{N} .,'&()\-/]{2,80}$/u;
/** 银行账号去掉空格 / 连字符后再校验：5–34 位数字或字母（兼容 IBAN）。 */
const BANK_ACCOUNT_PATTERN = /^[A-Za-z0-9]{5,34}$/;
/** 持卡人姓名：字母 + 空格 + . ' -（不含数字，避免误填账号）。 */
const ACCOUNT_NAME_PATTERN = /^[\p{L}\p{M} .'\-]{2,80}$/u;

export type WithdrawalCurrencyOption = {
  /** 下拉框 value：币种 + 网络，唯一 */
  id: string;
  currency: string;
  /** 加密货币网络；法币为空字符串 */
  network: string;
  accountType: PlayerWithdrawalAccountType;
  labelKey: TranslationKey;
};

/**
 * 【提现币种 / 方式】下拉框的唯一数据源：
 * 前端选项、前端预校验、后端落库都由这里决定币种与账号类型。
 */
export const WITHDRAWAL_CURRENCY_OPTIONS = [
  {
    id: "USDT_TRC20",
    currency: "USDT",
    network: "TRC20",
    accountType: "crypto",
    labelKey: "player.security.currency.usdtTrc20",
  },
  {
    id: "USDT_ERC20",
    currency: "USDT",
    network: "ERC20",
    accountType: "crypto",
    labelKey: "player.security.currency.usdtErc20",
  },
  {
    id: "MYR_BANK",
    currency: "MYR",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.myr",
  },
  {
    id: "THB_BANK",
    currency: "THB",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.thb",
  },
  {
    id: "IDR_BANK",
    currency: "IDR",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.idr",
  },
  {
    id: "VND_BANK",
    currency: "VND",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.vnd",
  },
  {
    id: "AUD_BANK",
    currency: "AUD",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.aud",
  },
  {
    id: "SGD_BANK",
    currency: "SGD",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.sgd",
  },
  {
    id: "EUR_BANK",
    currency: "EUR",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.eur",
  },
  {
    id: "USD_BANK",
    currency: "USD",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.usd",
  },
  {
    id: "HKD_BANK",
    currency: "HKD",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.hkd",
  },
  {
    id: "NPR_BANK",
    currency: "NPR",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.npr",
  },
  {
    id: "INR_BANK",
    currency: "INR",
    network: "",
    accountType: "bank",
    labelKey: "player.security.currency.inr",
  },
] as const satisfies readonly WithdrawalCurrencyOption[];

export function findWithdrawalCurrencyOption(
  currency: string,
  network: string,
): WithdrawalCurrencyOption | null {
  const normalizedCurrency = currency.trim().toUpperCase();
  const normalizedNetwork = network.trim().toUpperCase();

  return (
    WITHDRAWAL_CURRENCY_OPTIONS.find(
      (item) =>
        item.currency === normalizedCurrency &&
        item.network === normalizedNetwork,
    ) ?? null
  );
}

export function findWithdrawalCurrencyOptionById(
  id: string,
): WithdrawalCurrencyOption | null {
  return WITHDRAWAL_CURRENCY_OPTIONS.find((item) => item.id === id) ?? null;
}

/** 币种 + 网络还原成下拉框 id，用于回填「重新绑定」的表单。 */
export function withdrawalCurrencyOptionId(
  currency: string,
  network: string,
): string {
  return findWithdrawalCurrencyOption(currency, network)?.id ?? "";
}

/** 银行账号只展示后 4 位，避免完整账号出现在列表 / 日志里。 */
export function maskBankAccountNumber(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return `****${trimmed.slice(-4)}`;
}

/** 看起来像「纯数字账号」的片段：以数字开头、至少 6 位、只含数字 / 短横线 / 空格 */
const ACCOUNT_NUMBER_LIKE = /^[0-9][0-9\-\s]{5,}$/;

/**
 * 后台列表里的「收款信息」展示口径（`Withdrawal.walletAddress` 是拼好的完整字符串）。
 *
 * 银行户在提单时被拼成「银行 · 账号 · 持有人」（见 `/api/withdrawal/create`），
 * 完整账号一旦出现在后台列表 / 截图 / 日志里就是隐私泄露，所以这里把「看起来像账号」
 * 的那一段掩成后 4 位；链上地址（TRC20 / ERC20）本身是公开的，保持原样。
 *
 * 只用于展示，任何地方都不许把它回写成新的 walletAddress。
 */
export function maskWithdrawalDestination(
  value: string | null | undefined,
): string {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(" · ")
    .map((part) =>
      ACCOUNT_NUMBER_LIKE.test(part) ? maskBankAccountNumber(part) : part,
    )
    .join(" · ");
}


function readCryptoAddress(value: unknown, network: string): string {
  if (typeof value !== "string") {
    return "";
  }

  const address = value.trim();

  if (network === "TRC20") {
    return TRC20_ADDRESS_PATTERN.test(address) ? address : "";
  }

  if (network === "ERC20") {
    return ERC20_ADDRESS_PATTERN.test(address) ? address : "";
  }

  // 兜底：未知网络只做通用字符集校验（8–128 位字母数字或 : _ -）。
  return /^[A-Za-z0-9:_-]{8,128}$/.test(address) ? address : "";
}

function readBankName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const name = value.trim();

  if (
    name.length > WITHDRAWAL_BANK_NAME_MAX_LENGTH ||
    !BANK_NAME_PATTERN.test(name)
  ) {
    return "";
  }

  return name;
}

/** 银行账号去掉空格 / 连字符后返回；非法返回空字符串。 */
function readBankAccountNumber(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const digits = value.trim().replace(/[\s-]/g, "");

  if (
    digits.length < WITHDRAWAL_BANK_ACCOUNT_MIN_LENGTH ||
    digits.length > WITHDRAWAL_BANK_ACCOUNT_MAX_LENGTH ||
    !BANK_ACCOUNT_PATTERN.test(digits)
  ) {
    return "";
  }

  return digits;
}

function readAccountHolderName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const name = value.trim();

  if (
    name.length > WITHDRAWAL_ACCOUNT_NAME_MAX_LENGTH ||
    !ACCOUNT_NAME_PATTERN.test(name)
  ) {
    return "";
  }

  return name;
}

export type WithdrawalAccountDraft = {
  currency: string;
  network: string;
  accountType: PlayerWithdrawalAccountType;
  walletAddress: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
};

export type WithdrawalAccountDraftErrorCode =
  | "currency_invalid"
  | "wallet_invalid"
  | "bank_name_invalid"
  | "bank_account_invalid"
  | "account_holder_invalid";

export type WithdrawalAccountDraftResult =
  | { ok: true; value: WithdrawalAccountDraft }
  | { ok: false; code: WithdrawalAccountDraftErrorCode; message: string };

/**
 * 校验并整形「保存提现账号」的请求体：
 * - 币种 / 方式必须命中 WITHDRAWAL_CURRENCY_OPTIONS，账号类型由目录决定（忽略前端传的 accountType）；
 * - 加密货币只保留 walletAddress，法币只保留 bankName / accountNumber / accountName；
 * - 不相关字段一律落库为 null，避免一条记录同时存两套账号信息。
 */
export function readWithdrawalAccountDraft(
  input: Record<string, unknown>,
): WithdrawalAccountDraftResult {
  const currency =
    typeof input.currency === "string"
      ? input.currency.trim().toUpperCase()
      : "";
  const network =
    typeof input.network === "string" ? input.network.trim().toUpperCase() : "";

  const option = findWithdrawalCurrencyOption(currency, network);

  if (!option) {
    return {
      ok: false,
      code: "currency_invalid",
      message: "请选择支持的提现币种 / 方式",
    };
  }

  if (option.accountType === "crypto") {
    const walletAddress = readCryptoAddress(input.walletAddress, option.network);

    if (!walletAddress) {
      return {
        ok: false,
        code: "wallet_invalid",
        message:
          option.network === "TRC20"
            ? "USDT (TRC20) 地址格式不正确，应为 T 开头的 34 位地址"
            : "USDT (ERC20) 地址格式不正确，应为 0x 开头的 42 位地址",
      };
    }

    return {
      ok: true,
      value: {
        currency: option.currency,
        network: option.network,
        accountType: option.accountType,
        walletAddress,
        bankName: null,
        accountNumber: null,
        accountName: null,
      },
    };
  }

  const bankName = readBankName(input.bankName);

  if (!bankName) {
    return {
      ok: false,
      code: "bank_name_invalid",
      message: "请填写有效的银行名称（2-80 个字符）",
    };
  }

  const accountNumber = readBankAccountNumber(input.accountNumber);

  if (!accountNumber) {
    return {
      ok: false,
      code: "bank_account_invalid",
      message: "请填写有效的银行账号（5-34 位数字或字母）",
    };
  }

  const accountName = readAccountHolderName(input.accountName);

  if (!accountName) {
    return {
      ok: false,
      code: "account_holder_invalid",
      message: "请填写有效的账户持有人姓名",
    };
  }

  return {
    ok: true,
    value: {
      currency: option.currency,
      network: option.network,
      accountType: option.accountType,
      walletAddress: null,
      bankName,
      accountNumber,
      accountName,
    },
  };
}


