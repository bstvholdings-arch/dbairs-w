import type { NextRequest } from "next/server";

import { isIpOrCidr } from "./integrations";
import { prisma } from "./prisma";

/**
 * 回调来源 IP 白名单校验。
 *
 * 白名单条目来自 API 集成中心「IP 白名单」（IntegrationIpWhitelist），
 * 支持单个 IPv4 / IPv6 与 CIDR 网段（后台输入时已用 isIpOrCidr 校验过）。
 *
 * 判定规则（与支付回调、游戏商回调共用同一套开关语义）：
 * - 白名单里有条目：请求来源必须命中其中之一，否则 403；
 * - 白名单为空：本地 / 测试环境放行（方便 Postman 联调），
 *   生产环境默认拒绝（避免「忘了配置就等于全网开放」）；
 * - 可用 GAME_CALLBACK_REQUIRE_IP_WHITELIST=true|false 显式覆盖默认行为。
 */
export type IpWhitelistReason =
  | "matched"
  | "not-listed"
  | "not-configured"
  | "unknown-client"
  | "not-required";

export type IpWhitelistCheck = {
  allowed: boolean;
  reason: IpWhitelistReason;
  /** 规范化后的客户端 IP，取不到时为空串 */
  ip: string;
  /** 命中的白名单条目（CIDR 原样返回） */
  matchedRule: string | null;
  /** 白名单总条目数 */
  total: number;
  /** 当前部署是否要求必须命中白名单 */
  required: boolean;
};

type ParsedAddress = { bits: string };

/**
 * IPv4 → 32 位二进制串。
 * 用字符串比较前缀而不是 BigInt：项目 tsconfig 的 target 是 ES2017，
 * 不支持 BigInt 字面量，而 CIDR 判定本身只需要前缀比较。
 */
function ipv4ToBits(address: string): string | null {
  const parts = address.split(".");

  if (parts.length !== 4) {
    return null;
  }

  let bits = "";

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const octet = Number(part);

    if (octet > 255) {
      return null;
    }

    bits += octet.toString(2).padStart(8, "0");
  }

  return bits;
}

/** 把一段 IPv6 拆成 16 位分组；最后一段允许内嵌 IPv4（::ffff:1.2.3.4）。 */
function splitIpv6Groups(part: string): string[] | null {
  if (!part) {
    return [];
  }

  const groups = part.split(":");
  const result: string[] = [];

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];

    if (!group) {
      return null;
    }

    if (group.includes(".")) {
      if (index !== groups.length - 1) {
        return null;
      }

      const octets = group.split(".");

      if (octets.length !== 4) {
        return null;
      }

      const parsed = octets.map((octet) =>
        /^\d{1,3}$/.test(octet) ? Number(octet) : Number.NaN,
      );

      if (parsed.some((octet) => Number.isNaN(octet) || octet > 255)) {
        return null;
      }

      result.push(
        ((parsed[0] << 8) | parsed[1]).toString(16),
        ((parsed[2] << 8) | parsed[3]).toString(16),
      );
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }

    result.push(group);
  }

  return result;
}

function ipv6ToBits(address: string): string | null {
  const halves = address.split("::");

  if (halves.length > 2) {
    return null;
  }

  const head = splitIpv6Groups(halves[0]);
  const tail = halves.length === 2 ? splitIpv6Groups(halves[1]) : [];

  if (!head || !tail) {
    return null;
  }

  const missing = 8 - head.length - tail.length;

  if (halves.length === 2) {
    // 「::」至少要省略一个分组，否则 ::1::2 这种写法要拒绝
    if (missing < 1) {
      return null;
    }
  } else if (missing !== 0) {
    return null;
  }

  const groups = [...head, ...new Array<string>(missing).fill("0"), ...tail];
  let bits = "";

  for (const group of groups) {
    bits += Number.parseInt(group, 16).toString(2).padStart(16, "0");
  }

  return bits;
}

function parseAddress(address: string): ParsedAddress | null {
  if (!address) {
    return null;
  }

  const bits = address.includes(":")
    ? ipv6ToBits(address)
    : ipv4ToBits(address);

  return bits === null ? null : { bits };
}

/**
 * 规范化客户端 IP：
 * - 去掉引号 / 端口 / 方括号 / %zone 后缀；
 * - 统一小写；
 * - IPv4-mapped IPv6（::ffff:1.2.3.4）还原成 IPv4，避免白名单里写 v4 反而匹配不上。
 */
export function normalizeClientIp(value: string | null | undefined) {
  let text = (value ?? "").trim().replace(/^"+|"+$/g, "");

  if (!text) {
    return "";
  }

  if (text.startsWith("[")) {
    const end = text.indexOf("]");

    if (end > 0) {
      text = text.slice(1, end);
    }
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(text)) {
    text = text.split(":")[0];
  }

  text = text.split("%")[0].trim().toLowerCase();

  if (text.startsWith("::ffff:")) {
    const mapped = text.slice("::ffff:".length);

    if (mapped.includes(".")) {
      return mapped;
    }
  }

  return text;
}

/** 从反向代理头部读取客户端 IP（Vercel / Nginx / Cloudflare 都覆盖）。 */
export function readClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    const first = forwarded.split(",")[0];
    const ip = normalizeClientIp(first);

    if (ip) {
      return ip;
    }
  }

  return normalizeClientIp(
    request.headers.get("x-real-ip") ??
      request.headers.get("cf-connecting-ip") ??
      "",
  );
}

/** 单个 IP 是否命中一条白名单（单 IP 或 CIDR 网段）。 */
export function ipMatchesRule(ip: string, rule: string) {
  const address = normalizeClientIp(ip);
  const rawRule = rule.trim().toLowerCase();

  if (!address || !rawRule || !isIpOrCidr(rawRule)) {
    return false;
  }

  const [ruleAddress, prefixText] = rawRule.split("/");

  if (prefixText === undefined) {
    return address === normalizeClientIp(ruleAddress);
  }

  const parsedIp = parseAddress(address);
  const parsedRule = parseAddress(normalizeClientIp(ruleAddress));

  if (
    !parsedIp ||
    !parsedRule ||
    parsedIp.bits.length !== parsedRule.bits.length
  ) {
    return false;
  }

  const prefix = Number(prefixText);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsedIp.bits.length) {
    return false;
  }

  // 前缀为 0 时 slice(0, 0) 都是空串，等价于整段放行。
  return parsedIp.bits.slice(0, prefix) === parsedRule.bits.slice(0, prefix);
}

/** 当前部署是否要求回调必须命中白名单。 */
export function ipWhitelistRequired() {
  const configured =
    process.env.GAME_CALLBACK_REQUIRE_IP_WHITELIST?.trim().toLowerCase();

  if (configured === "true") {
    return true;
  }

  if (configured === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

/** 查询白名单并判定该 IP 是否放行。 */
export async function checkIpWhitelist(ip: string): Promise<IpWhitelistCheck> {
  const required = ipWhitelistRequired();
  const entries = await prisma.integrationIpWhitelist.findMany({
    select: { ip: true },
    orderBy: { createdAt: "desc" },
  });

  if (entries.length === 0) {
    return {
      allowed: !required,
      reason: required ? "not-configured" : "not-required",
      ip,
      matchedRule: null,
      total: 0,
      required,
    };
  }

  if (!ip) {
    return {
      allowed: false,
      reason: "unknown-client",
      ip,
      matchedRule: null,
      total: entries.length,
      required,
    };
  }

  for (const entry of entries) {
    if (ipMatchesRule(ip, entry.ip)) {
      return {
        allowed: true,
        reason: "matched",
        ip,
        matchedRule: entry.ip,
        total: entries.length,
        required,
      };
    }
  }

  return {
    allowed: false,
    reason: "not-listed",
    ip,
    matchedRule: null,
    total: entries.length,
    required,
  };
}
