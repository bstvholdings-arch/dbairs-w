/**
 * 玩家提现「银行 / 支付方式」目录（纯数据，不依赖 Prisma / next）。
 *
 * 为什么要单独维护一份目录：
 * 原生 `<select>` 的 `<option>` 里塞不进图片，而玩家绑定收款账号时必须一眼认出
 * Maybank / CIMB / Touch 'n Go 这些品牌，所以玩家端改用自定义下拉
 * （`src/components/player/payout-method-select.tsx`）。选项数据统一收在这里，
 * 图片自托管在 `public/banks/*.svg`（不挂外站图床：图床被墙 / 挂掉就整排裂图）。
 *
 * 三条硬规则：
 * 1. `name` 会原样落库到 `PlayerWithdrawalAccount.bankName`，必须过
 *    `readBankName()`（2-80 字符、允许中英文与常见标点），所以只能写品牌名本身；
 * 2. 落库值仍然是「银行名称」纯文本，不改表结构、不改后台口径；
 * 3. 玩家的银行不在目录里就走「其他银行 / 手动输入」，**不要**为了凑目录去改品牌名。
 */

/** 银行 / 支付方式的分类：网银转账通道、实体银行、电子钱包。 */
export type PayoutMethodKind = "fpx" | "bank" | "ewallet";

export type PayoutMethod = {
  /** 稳定 id（只在前端用，不落库） */
  id: string;
  /** 展示名 = 落库值（品牌名，不做翻译，避免同一家银行出现两种写法） */
  name: string;
  /** 站内 logo 路径；对应 public/banks/<id>.svg */
  logo: string;
  /** fpx = 网银转账通道，bank = 实体银行，ewallet = 电子钱包 */
  kind: PayoutMethodKind;
  /** 历史数据 / 玩家手输的别名（MBB、Maybank2u、TnG…），只用于回填与匹配 */
  aliases?: string[];
};

/**
 * 马来西亚常用收款方式。
 * 顺序即下拉顺序：先通道（FPX），再按使用频率排主流银行，最后电子钱包。
 */
export const PAYOUT_METHODS: PayoutMethod[] = [
  {
    id: "fpx",
    name: "FPX Online Banking",
    logo: "/banks/fpx.svg",
    kind: "fpx",
    aliases: ["FPX", "Online Banking", "Perbankan Internet"],
  },
  {
    id: "maybank",
    name: "Maybank",
    logo: "/banks/maybank.svg",
    kind: "bank",
    aliases: ["Maybank2u", "MBB", "Malayan Banking", "马来亚银行"],
  },
  {
    id: "cimb",
    name: "CIMB Bank",
    logo: "/banks/cimb.svg",
    kind: "bank",
    aliases: ["CIMB", "CIMB Clicks", "联昌国际"],
  },
  {
    id: "public-bank",
    name: "Public Bank",
    logo: "/banks/public-bank.svg",
    kind: "bank",
    aliases: ["Public Bank Berhad", "PBB", "大众银行"],
  },
  {
    id: "rhb",
    name: "RHB Bank",
    logo: "/banks/rhb.svg",
    kind: "bank",
    aliases: ["RHB", "RHB Now", "兴业银行"],
  },
  {
    id: "hong-leong",
    name: "Hong Leong Bank",
    logo: "/banks/hong-leong.svg",
    kind: "bank",
    aliases: ["Hong Leong", "HLB", "丰隆银行"],
  },
  {
    id: "tng",
    name: "Touch 'n Go eWallet",
    logo: "/banks/tng.svg",
    kind: "ewallet",
    aliases: ["Touch n Go", "Touchngo", "TnG", "TNG", "一触即通"],
  },
  {
    id: "grabpay",
    name: "GrabPay",
    logo: "/banks/grabpay.svg",
    kind: "ewallet",
    aliases: ["Grab", "Grab Pay"],
  },
  {
    id: "boost",
    name: "Boost",
    logo: "/banks/boost.svg",
    kind: "ewallet",
    aliases: ["Boost eWallet"],
  },
];

/** 目录里最短的可信关键字长度：低于这个长度（如手输 "b"）不做模糊命中，避免误判。 */
const MIN_FUZZY_KEY_LENGTH = 4;

/** 归一化：小写 + 去掉空格 / 连字符 / 撇号 / 括号，让 "Touch 'n Go" 与 "touchngo" 等价。 */
function normalizeMethodKey(value: string) {
  return value.toLowerCase().replace(/[\s\-_.'’`()/]/g, "");
}

/**
 * 用「玩家已填 / 已落库的银行名称」反查目录项，用于：
 * - 打开下拉时把当前值回填成「logo + 品牌名」；
 * - 已绑定账号列表里显示对应 logo。
 *
 * 两轮匹配：
 * 1. 归一化后**完全相等**（含别名）直接命中 —— 官方缩写 MBB / PBB / RHB / HLB / TnG / FPX
 *    只有 3 个字符，不能受下面的长度门槛限制；
 * 2. 否则做前缀模糊（"Maybank Berhad" → Maybank / "cimb clicks" → CIMB Bank），
 *    命中段要求 ≥ 4 个字符，避免 "b" 这类单字符输入把 Boost 抢走。
 */
export function findPayoutMethodByName(
  value: string | null | undefined,
): PayoutMethod | null {
  const key = normalizeMethodKey((value ?? "").trim());

  if (!key) {
    return null;
  }

  for (const method of PAYOUT_METHODS) {
    for (const candidate of [method.name, method.id, ...(method.aliases ?? [])]) {
      if (normalizeMethodKey(candidate) === key) {
        return method;
      }
    }
  }

  let best: PayoutMethod | null = null;
  let bestLength = 0;

  for (const method of PAYOUT_METHODS) {
    for (const candidate of [method.name, method.id, ...(method.aliases ?? [])]) {
      const candidateKey = normalizeMethodKey(candidate);

      if (!candidateKey) {
        continue;
      }

      const hit =
        key.startsWith(candidateKey) || candidateKey.startsWith(key);

      if (!hit) {
        continue;
      }

      const matched = Math.min(key.length, candidateKey.length);

      if (matched > bestLength) {
        best = method;
        bestLength = matched;
      }
    }
  }

  return bestLength >= MIN_FUZZY_KEY_LENGTH ? best : null;
}
