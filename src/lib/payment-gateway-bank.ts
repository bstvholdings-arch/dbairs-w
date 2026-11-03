/**
 * BANK_TRANSFER 网关的银行信息。
 *
 * 使用 JSON 而不是为每个国家增加数据库列，便于同时支持：
 * - 欧洲 SEPA：IBAN + SWIFT/BIC；
 * - 澳洲 PayID：PayID / BSB / Account Number；
 * - 全球电汇：SWIFT + Account Number + Bank Name。
 */
export type GatewayBankDetails = {
  accountName: string;
  accountNumber: string;
  bankName: string;
  swiftCode: string;
  iban: string;
  payId: string;
  routingNumber: string;
  reference: string;
  instructions: string;
};

export type GatewayBankDetailField = {
  key: keyof GatewayBankDetails;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
};

export const EMPTY_GATEWAY_BANK_DETAILS: GatewayBankDetails = {
  accountName: "",
  accountNumber: "",
  bankName: "",
  swiftCode: "",
  iban: "",
  payId: "",
  routingNumber: "",
  reference: "",
  instructions: "",
};

export const GATEWAY_BANK_DETAIL_FIELDS: readonly GatewayBankDetailField[] = [
  {
    key: "accountName",
    label: "账户户名 / Account Name",
    placeholder: "例如 Winvora Ltd",
    maxLength: 120,
  },
  {
    key: "accountNumber",
    label: "银行账号 / Account Number",
    placeholder: "例如 1234567890",
    maxLength: 80,
  },
  {
    key: "bankName",
    label: "银行名称 / Bank Name",
    placeholder: "例如 Maybank / DBS / HSBC",
    maxLength: 120,
  },
  {
    key: "swiftCode",
    label: "SWIFT / BIC",
    placeholder: "例如 MBBEMYKL / DBSSSGSG",
    maxLength: 32,
  },
  {
    key: "iban",
    label: "IBAN（欧洲 SEPA）",
    placeholder: "例如 DE89370400440532013000",
    maxLength: 64,
  },
  {
    key: "payId",
    label: "PayID（澳洲）",
    placeholder: "例如 pay@example.com / 04xxxxxxx",
    maxLength: 120,
  },
  {
    key: "routingNumber",
    label: "Routing / Sort Code / BSB",
    placeholder: "例如 123456 / 12-34-56",
    maxLength: 40,
  },
  {
    key: "reference",
    label: "转账备注 / Reference",
    placeholder: "例如 请填写订单号或玩家账号",
    maxLength: 160,
  },
  {
    key: "instructions",
    label: "补充说明 / Instructions",
    placeholder: "例如：转账后请将回执发送给客服，以便人工核对到账。",
    maxLength: 1000,
    multiline: true,
  },
];

/**
 * 玩家端收银台的展示顺序：**收款银行 → 账户名 → 账号**，然后是
 * IBAN / SWIFT / PayID / 路由号 / 备注 / 补充说明。
 *
 * 玩家真正要抄的就是前三个，所以固定排最上面；没填的字段自动隐藏
 * （不同国家用不上同一套字段）。大厅充值弹窗与玩家中心充值弹窗共用这一份顺序，
 * 不要在组件里各自写一遍映射 —— 后台表单顺序（GATEWAY_BANK_DETAIL_FIELDS）
 * 是按「录入习惯」排的，和玩家端要看的顺序不是一回事。
 */
export const GATEWAY_BANK_DISPLAY_ORDER: readonly (keyof GatewayBankDetails)[] = [
  "bankName",
  "accountName",
  "accountNumber",
  "iban",
  "swiftCode",
  "payId",
  "routingNumber",
  "reference",
  "instructions",
];

export function normalizeGatewayBankDetails(
  value: unknown,
): GatewayBankDetails {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const details = { ...EMPTY_GATEWAY_BANK_DETAILS };

  for (const field of GATEWAY_BANK_DETAIL_FIELDS) {
    const raw = input[field.key];
    details[field.key] = typeof raw === "string" ? raw.trim() : "";
  }

  return details;
}

export function hasAnyGatewayBankDetail(value: GatewayBankDetails) {
  return GATEWAY_BANK_DETAIL_FIELDS.some(
    (field) => Boolean(value[field.key]?.trim()),
  );
}

/**
 * 银行转账必须至少提供户名，以及账号 / IBAN / PayID 中的一项。
 * 这样既兼容 SEPA、PayID，也兼容传统 SWIFT 电汇，而不会写死某个国家。
 */
export function validateGatewayBankDetails(value: GatewayBankDetails) {
  for (const field of GATEWAY_BANK_DETAIL_FIELDS) {
    if (value[field.key].length > field.maxLength) {
      return `${field.label}不能超过 ${field.maxLength} 个字符`;
    }
  }

  if (!value.accountName) {
    return "银行转账网关必须填写账户户名";
  }

  if (!value.accountNumber && !value.iban && !value.payId) {
    return "请至少填写银行账号、IBAN 或 PayID 中的一项";
  }

  return "";
}

/**
 * 后台接口返回给编辑表单；只要有任何一项就返回，便于管理员修正不完整配置。
 * 玩家收银台是否会展示该网关，还要通过 validateGatewayBankDetails 判断。
 */
export function serializeGatewayBankDetails(
  value: unknown,
): GatewayBankDetails | null {
  const details = normalizeGatewayBankDetails(value);

  return hasAnyGatewayBankDetail(details) ? details : null;
}
