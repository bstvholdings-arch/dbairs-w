/**
 * API 集成中心（/admin/integrations）页签版客户端共享类型与纯函数。
 *
 * 本文件不 import 任何服务端模块，四个页签组件与页面外壳都可以安全引用。
 */

import type { TranslationKey } from "@/lib/i18n-types";

/** 四个页签：用 React state 切换，不触发路由跳转 / 页面刷新。 */
export const INTEGRATION_TABS = [
  "global",
  "providers",
  "gateways",
  "merchants",
] as const;

export type IntegrationTab = (typeof INTEGRATION_TABS)[number];

/**
 * 把 URL 上的 ?tab= 查询参数收敛成合法页签。
 * 非法值统一回落到 "global"：这样 /admin/integrations?tab=xxx 永远能正常渲染，
 * 也方便把每个页签做成可收藏 / 可分享的深链接。
 */
export function readIntegrationTab(value: string): IntegrationTab {
  return INTEGRATION_TABS.find((item) => item === value) ?? "global";
}

/**
 * 页签标题文案：不直接写死中文 / 英文，统一走词典，
 * 与常量层 GATEWAY_*_KEYS 的处理方式保持一致。
 */
export const INTEGRATION_TAB_LABEL_KEYS: Record<IntegrationTab, TranslationKey> =
  {
    global: "integrations.tab.global",
    providers: "integrations.tab.providers",
    gateways: "integrations.tab.gateways",
    merchants: "integrations.tab.merchants",
  };

/** 页面顶部的操作结果提示（保存成功 / 接口报错共用）。 */
export type IntegrationBanner = {
  type: "success" | "error";
  text: string;
};

/**
 * 搜索过滤：大小写不敏感、支持多关键词（空格分隔时按 AND 匹配）、
 * 忽略首尾空白。任意一个字段命中全部关键词即视为匹配。
 *
 * 例："pg"          → 命中 "PG Soft"
 *     "pg myr"      → 需要同时包含 pg 与 myr
 */
export function matchesSearch(
  query: string,
  fields: readonly (string | null | undefined)[],
) {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  const haystack = fields
    .filter((field): field is string => Boolean(field))
    .join(" ")
    .toLowerCase();

  return needle.split(/\s+/).every((token) => haystack.includes(token));
}

/**
 * 搜索框防抖时长：行数不多时直接同步过滤（体验最「跟手」），
 * 数据量大时才防抖，避免每次按键都重新渲染上千行表格。
 */
export function searchDebounceDelay(rowCount: number) {
  return rowCount > 80 ? 160 : 0;
}
