/**
 * 开户国家（`Tenant.country`）与结算币种（`Tenant.currency`）的**唯一绑定表**。
 *
 * 产品口径（老板已确认，不可回退）：本平台只做**本国法币**生意 ——
 * 开站时超管选一个国家，结算币种就被锁定为该国的法币，
 * 玩家端所有金额（余额 / 充值 / 提现 / 记录）都按这个币种的符号渲染
 * （马币 RM、泰铢 ฿、印尼盾 Rp、越南盾 ₫…），见 `src/lib/currency.ts`。
 *
 * 为什么绑定而不是让超管单独选币种：
 * 1. 一个站的记账币种决定了它能不能用本国的收款通道（DuitNow / PromptPay / QRIS），
 *    选错就是「玩家拿 MYR 的钱去扫泰国码」，对不上账；
 * 2. 历史上出现过「币种填 USDT、通道填 MYR」的脏配置，玩家端符号就乱了；
 * 3. 绑定后币种只有一个来源，界面上不可单独编辑（只读展示 + 符号预览）。
 *
 * 本文件是纯常量 / 纯函数（不依赖 prisma、不依赖 node:*），
 * 服务端校验与客户端下拉共用同一份，禁止在页面里另写一套国家表。
 */
import type { TranslationKey } from "./i18n-types";
import { DEFAULT_CURRENCY } from "./currency";

/**
 * 可选国家：只收录**币种符号已在 src/lib/currency.ts 里定义好**的国家，
 * 这样「选完国家 → 前台符号」这条链不会出现退化（未知币种只会显示代码本字）。
 *
 * 新增一个国家 = 这里加一行 + zh.json / en.json 各加一条 `tenants.country.<CODE>`，
 * 不碰任何页面或接口。
 */
export const TENANT_COUNTRIES = [
  { code: "MY", currency: "MYR", labelKey: "tenants.country.MY" },
  { code: "TH", currency: "THB", labelKey: "tenants.country.TH" },
  { code: "ID", currency: "IDR", labelKey: "tenants.country.ID" },
  { code: "VN", currency: "VND", labelKey: "tenants.country.VN" },
  { code: "SG", currency: "SGD", labelKey: "tenants.country.SG" },
  { code: "IN", currency: "INR", labelKey: "tenants.country.IN" },
  { code: "AU", currency: "AUD", labelKey: "tenants.country.AU" },
  { code: "HK", currency: "HKD", labelKey: "tenants.country.HK" },
  { code: "US", currency: "USD", labelKey: "tenants.country.US" },
] as const satisfies ReadonlyArray<{
  code: string;
  currency: string;
  labelKey: TranslationKey;
}>;

export type TenantCountryOption = (typeof TENANT_COUNTRIES)[number];
export type TenantCountryCode = TenantCountryOption["code"];

/** 缺省国家（= 币种缺省 MYR）：与 `Tenant.country` 的 @default 保持一致 */
export const DEFAULT_TENANT_COUNTRY: TenantCountryCode = "MY";

/** 全部合法国家代码（接口校验 / SQL 回填共用） */
export const TENANT_COUNTRY_CODES: readonly TenantCountryCode[] =
  TENANT_COUNTRIES.map((country) => country.code);

export function isTenantCountry(value: unknown): value is TenantCountryCode {
  return (
    typeof value === "string" &&
    (TENANT_COUNTRY_CODES as readonly string[]).includes(
      value.trim().toUpperCase(),
    )
  );
}

/**
 * 归一化国家代码：大小写不敏感，认不出来的一律回落到 MY。
 * （老租户升级后 `country` 列是缺省值 MY、币种仍是历史值，见下面 resolve 的说明。）
 */
export function normalizeTenantCountry(value: unknown): TenantCountryCode {
  if (typeof value !== "string") {
    return DEFAULT_TENANT_COUNTRY;
  }

  const code = value.trim().toUpperCase();
  const matched = TENANT_COUNTRIES.find((country) => country.code === code);

  return matched ? matched.code : DEFAULT_TENANT_COUNTRY;
}

/** 国家 → 结算币种（唯一映射入口，禁止在接口里另写 switch） */
export function currencyForTenantCountry(value: unknown): string {
  const country = normalizeTenantCountry(value);
  const matched = TENANT_COUNTRIES.find((item) => item.code === country);

  return matched?.currency ?? DEFAULT_CURRENCY;
}

/** 国家下拉的文案 key（en.json 缺失时运行时会回落中文，所以两边都要补） */
export function tenantCountryLabelKey(value: unknown): TranslationKey {
  const country = normalizeTenantCountry(value);
  const matched = TENANT_COUNTRIES.find((item) => item.code === country);

  return matched?.labelKey ?? "tenants.country.MY";
}

/**
 * 币种反推国家（**只用于老数据回填**，不是写入口）：
 * 升级前的租户只有 currency，没有 country，回填脚本 / SQL 用它把
 * MYR→MY、THB→TH 对上，避免出现「国家对 MY、币种却是 THB」的错配。
 */
export function countryForTenantCurrency(currency: unknown): TenantCountryCode {
  const code =
    typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const matched = TENANT_COUNTRIES.find((country) => country.currency === code);

  return matched ? matched.code : DEFAULT_TENANT_COUNTRY;
}
