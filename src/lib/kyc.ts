import type { KycStatus } from "@prisma/client";

/**
 * KYC（实名认证）的共享校验与格式化工具。
 *
 * 玩家端提交、商户端审核、提现前置校验都从这里取规则，
 * 避免「前端说 8-32 位、后端收 6-64 位」这种口径不一致。
 */

export const KYC_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export const KYC_REAL_NAME_MIN = 2;
export const KYC_REAL_NAME_MAX = 64;
export const KYC_ID_NUMBER_MIN = 6;
export const KYC_ID_NUMBER_MAX = 32;
export const KYC_REJECT_REASON_MAX = 200;

/** 姓名：允许各国文字（含 CJK）、空格、点、连字符、撇号、间隔号。 */
const REAL_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’·-]*$/u;
/** 证件号：字母 + 数字 + 连字符，统一转大写后入库（身份证 / 护照 / 驾照都适用）。 */
const ID_NUMBER_PATTERN = /^[A-Z0-9-]+$/;

export function isKycStatus(value: unknown): value is KycStatus {
  return (
    typeof value === "string" &&
    (KYC_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeRealName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim().replace(/\s+/g, " ");

  if (name.length < KYC_REAL_NAME_MIN || name.length > KYC_REAL_NAME_MAX) {
    return null;
  }

  return REAL_NAME_PATTERN.test(name) ? name : null;
}

export function normalizeIdNumber(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const idNumber = value.trim().replace(/\s+/g, "").toUpperCase();

  if (
    idNumber.length < KYC_ID_NUMBER_MIN ||
    idNumber.length > KYC_ID_NUMBER_MAX ||
    !ID_NUMBER_PATTERN.test(idNumber)
  ) {
    return null;
  }

  return idNumber;
}

/**
 * 证件号脱敏：列表页 / 概览只展示掩码，完整号码只在审核详情里给出。
 * 例：AB1234567 → AB1****567（长度不足 8 位时只保留首 2 位）。
 */
export function maskIdNumber(value: string): string {
  const idNumber = value.trim();

  if (idNumber.length <= 8) {
    return `${idNumber.slice(0, 2)}${"*".repeat(Math.max(2, idNumber.length - 2))}`;
  }

  const tail = idNumber.slice(-4);
  const head = idNumber.slice(0, 4);
  const hidden = "*".repeat(Math.min(6, idNumber.length - 8));

  return `${head}${hidden}${tail}`;
}

export type KycSubmission = {
  realName: string;
  idNumber: string;
  idCardFrontUrl: string;
  idCardBackUrl: string;
};

export type KycSubmissionParse =
  | { ok: true; value: KycSubmission }
  | { ok: false; code: string; message: string };

/**
 * 解析玩家提交的表单。
 *
 * isImageUrl 由调用方注入（校验图片路径确实是本系统的受控路径），
 * 这样本文件不依赖文件系统，纯函数便于单测与复用。
 */
export function readKycSubmission(
  body: unknown,
  isImageUrl: (value: string) => boolean,
): KycSubmissionParse {
  const input =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const realName = normalizeRealName(input.realName);

  if (!realName) {
    return {
      ok: false,
      code: "real_name_invalid",
      message: `真实姓名需为 ${KYC_REAL_NAME_MIN}-${KYC_REAL_NAME_MAX} 个字符，且不能包含特殊符号`,
    };
  }

  const idNumber = normalizeIdNumber(input.idNumber);

  if (!idNumber) {
    return {
      ok: false,
      code: "id_number_invalid",
      message: `证件号码需为 ${KYC_ID_NUMBER_MIN}-${KYC_ID_NUMBER_MAX} 位字母或数字`,
    };
  }

  const front =
    typeof input.idCardFrontUrl === "string" ? input.idCardFrontUrl.trim() : "";
  const back =
    typeof input.idCardBackUrl === "string"
      ? input.idCardBackUrl.trim()
      : "";

  if (!front || !back) {
    return {
      ok: false,
      code: "id_card_missing",
      message: "请上传证件正面与反面两张图片",
    };
  }

  if (!isImageUrl(front) || !isImageUrl(back)) {
    return {
      ok: false,
      code: "id_card_invalid",
      message: "证件图片地址无效，请重新上传",
    };
  }

  if (front === back) {
    return {
      ok: false,
      code: "id_card_duplicated",
      message: "证件正面与反面不能是同一张图片",
    };
  }

  return {
    ok: true,
    value: {
      realName,
      idNumber,
      idCardFrontUrl: front,
      idCardBackUrl: back,
    },
  };
}

/** 驳回原因：必填、去空白、限长。 */
export function normalizeRejectReason(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const reason = value.trim();

  if (!reason || reason.length > KYC_REJECT_REASON_MAX) {
    return null;
  }

  return reason;
}

/** 提现前置校验的统一文案（玩家端按 code 本地化）。 */
export const KYC_REQUIRED_CODE = "kyc_required";
export const KYC_REQUIRED_MESSAGE = "请先完成实名认证";
