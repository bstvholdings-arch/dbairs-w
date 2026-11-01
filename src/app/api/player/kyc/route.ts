import type { NextRequest } from "next/server";

import type { KycStatus } from "@prisma/client";

import { readKycSubmission } from "@/lib/kyc";
import {
  kycImageExists,
  kycKeyFromUrl,
  playerKycFileUrl,
} from "@/lib/kyc-storage";
import { getPlayerSessionFromRequest } from "@/lib/player-session";
import { prisma } from "@/lib/prisma";

/**
 * 玩家实名认证（KYC）。
 *
 * GET  /api/player/kyc —— 读取自己的认证状态
 * POST /api/player/kyc —— 提交 / 重新提交认证资料
 *
 * 身份只认玩家 JWT（player-session），tenantId 一律取自会话，
 * 请求体里出现的 tenantId / playerId 会被完全忽略。
 */

type KycRecord = {
  status: KycStatus;
  realName: string;
  idNumber: string;
  idCardFrontUrl: string;
  idCardBackUrl: string;
  rejectReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
};

const KYC_SELECT = {
  status: true,
  realName: true,
  idNumber: true,
  idCardFrontUrl: true,
  idCardBackUrl: true,
  rejectReason: true,
  createdAt: true,
  reviewedAt: true,
} as const;

function noStoreJson(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function jsonError(message: string, status: number, code: string) {
  return noStoreJson({ error: message, code }, status);
}

function serializeKyc(record: KycRecord) {
  return {
    status: record.status,
    realName: record.realName,
    idNumber: record.idNumber,
    // 图片走受控接口，玩家只能读到自己的那份
    idCardFrontUrl: playerKycFileUrl(record.idCardFrontUrl),
    idCardBackUrl: playerKycFileUrl(record.idCardBackUrl),
    rejectReason: record.rejectReason,
    submittedAt: record.createdAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
  };
}

export async function GET(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("未登录或登录已过期", 401, "unauthorized");
  }

  try {
    const record = await prisma.playerKyc.findFirst({
      where: { playerId: session.id, tenantId: session.tenantId },
      select: KYC_SELECT,
    });

    return noStoreJson({ kyc: record ? serializeKyc(record) : null });
  } catch (error) {
    console.error("读取玩家实名认证失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500, "kyc_read_failed");
  }
}

export async function POST(request: NextRequest) {
  const session = await getPlayerSessionFromRequest(request);

  if (!session) {
    return jsonError("未登录或登录已过期", 401, "unauthorized");
  }

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400, "invalid_request");
    }

    // 只接受本系统上传接口返回的受控路径，别处的 URL 一律拒绝
    const parsed = readKycSubmission(body, (value) =>
      Boolean(kycKeyFromUrl(value)),
    );

    if (!parsed.ok) {
      return jsonError(parsed.message, 400, parsed.code);
    }

    const frontKey = kycKeyFromUrl(parsed.value.idCardFrontUrl);
    const backKey = kycKeyFromUrl(parsed.value.idCardBackUrl);

    if (
      !frontKey ||
      !backKey ||
      !(await kycImageExists(frontKey)) ||
      !(await kycImageExists(backKey))
    ) {
      return jsonError(
        "证件图片已失效，请重新上传",
        400,
        "id_card_missing",
      );
    }

    const existing = await prisma.playerKyc.findUnique({
      where: { playerId: session.id },
      select: { status: true, tenantId: true },
    });

    if (existing && existing.tenantId !== session.tenantId) {
      // 理论上不会出现（playerId 与 tenantId 一一对应），保守起见拒绝跨租户覆盖
      return jsonError("实名认证记录异常，请联系客服", 409, "kyc_conflict");
    }

    if (existing?.status === "APPROVED") {
      return jsonError(
        "实名认证已通过，如需修改资料请联系客服",
        409,
        "kyc_already_approved",
      );
    }

    if (existing?.status === "PENDING") {
      return jsonError(
        "认证资料审核中，请耐心等待审核结果",
        409,
        "kyc_pending",
      );
    }

    const record = await prisma.playerKyc.upsert({
      where: { playerId: session.id },
      create: {
        tenantId: session.tenantId,
        playerId: session.id,
        ...parsed.value,
      },
      update: {
        tenantId: session.tenantId,
        ...parsed.value,
        // 驳回后重新提交：清空上次的审核结论，重新进入待审核队列
        status: "PENDING",
        rejectReason: null,
        reviewedById: null,
        reviewedAt: null,
      },
      select: KYC_SELECT,
    });

    return noStoreJson({ success: true, kyc: serializeKyc(record) }, 201);
  } catch (error) {
    console.error("提交实名认证失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500, "kyc_submit_failed");
  }
}
