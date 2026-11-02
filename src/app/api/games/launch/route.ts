import type { NextRequest } from "next/server";

import {
  buildGameLaunchTicket,
  readGameCode,
  readGameCurrency,
  readGameLanguage,
  resolveGameProviderConnection,
} from "@/lib/game-provider";
import { readCallbackUrl } from "@/lib/integrations";
import { resolvePaymentPlayerIdentity } from "@/lib/payment-player";
import { prisma } from "@/lib/prisma";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 玩家进入游戏（Seamless Wallet 启动接口）。
 *
 * POST /api/games/launch
 * Body: {
 *   gameCode: "pg-fortune-tiger"   // Game.externalId 或 Game.id
 *   playerId?: "<玩家 id>"          // 玩家登录态可省略；商户代调用时必须传
 *   providerId?: "<游戏商 id>"      // 同一游戏代码在多个游戏商下重名时用于消歧
 *   currency?: "USDT"
 *   language?: "zh"
 *   returnUrl?: "https://..."       // 玩家退出游戏后的回跳地址
 * }
 *
 * 身份：玩家 Cookie / Bearer 玩家 JWT 优先；本地开发（或显式开启
 * GAME_LAUNCH_ALLOW_PLAYER_ID=true）允许直接传 playerId 联调。
 *
 * 返回：当前阶段是模拟的游戏地址（mode=mock），参数与真实厂商 launch 接口一致；
 * 拿到《API 接口对接文档》后只需改 src/lib/game-provider.ts 的
 * buildGameLaunchTicket()，本路由与调用方都不用动。
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("请求体格式错误", 400);
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const identity = await resolvePaymentPlayerIdentity(
      request,
      input,
      "GAME_LAUNCH_ALLOW_PLAYER_ID",
    );

    if (!identity) {
      return jsonError("缺少有效的玩家身份", 401);
    }

    const rawCode = [input.gameCode, input.gameId, input.code].find(
      (value): value is string =>
        typeof value === "string" && value.trim() !== "",
    );
    const gameCode = readGameCode(rawCode);

    if (!gameCode) {
      return jsonError("缺少游戏代码 gameCode（也接受 gameId）", 400);
    }

    const providerIdFilter =
      typeof input.providerId === "string" ? input.providerId.trim() : "";

    const matches = await prisma.game.findMany({
      where: {
        OR: [{ id: gameCode }, { externalId: gameCode }],
        ...(providerIdFilter ? { providerId: providerIdFilter } : {}),
      },
      take: 4,
      select: {
        id: true,
        externalId: true,
        name: true,
        category: true,
        isActive: true,
        provider: {
          select: {
            id: true,
            name: true,
            status: true,
            isActive: true,
            apiEndpoint: true,
            merchantId: true,
            apiSecret: true,
          },
        },
      },
    });

    // 同一 externalId 可能被多个游戏商复用：去掉重复行后仍然多于一条就要求调用方指定 providerId。
    const uniqueGames = [...new Map(matches.map((item) => [item.id, item])).values()];

    if (uniqueGames.length === 0) {
      return jsonError("游戏不存在或尚未同步，请先在后台同步游戏列表", 404);
    }

    if (uniqueGames.length > 1) {
      return jsonError("该游戏代码对应多个游戏商，请同时提供 providerId", 409);
    }

    const game = uniqueGames[0];

    if (!game.isActive) {
      return jsonError("该游戏已下架，暂不能进入", 409);
    }

    if (!game.provider.isActive) {
      return jsonError("该游戏商已下架，暂不能进入", 409);
    }

    if (game.provider.status !== "active") {
      return jsonError("该游戏商已暂停结算，暂不能进入游戏", 409);
    }

    const player = await prisma.player.findUnique({
      where: { id: identity.playerId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        balance: true,
        tenant: { select: { status: true } },
      },
    });

    if (!player) {
      return jsonError("玩家不存在", 404);
    }

    // 玩家 JWT / 租户客服代调用都必须与数据库里的租户一致，防止跨租户伪造。
    if (identity.tenantId && identity.tenantId !== player.tenantId) {
      return jsonError("玩家身份与租户不匹配", 403);
    }

    if (player.status !== "active") {
      return jsonError("玩家账号已被停用，无法进入游戏", 403);
    }

    if (player.tenant.status === "suspended") {
      return jsonError("当前租户已暂停，无法进入游戏", 403);
    }

    const currency = readGameCurrency(input.currency);

    if (!currency) {
      return jsonError("币种格式不正确（2-10 位字母，如 USDT）", 400);
    }

    const language = readGameLanguage(input.language);

    if (!language) {
      return jsonError("语言格式不正确（如 zh / en-US）", 400);
    }

    const returnUrl = readCallbackUrl(input.returnUrl);

    if (returnUrl === null) {
      return jsonError("returnUrl 必须是 http(s) 开头的绝对地址", 400);
    }

    const connection = resolveGameProviderConnection(game.provider);
    const ticket = buildGameLaunchTicket(connection, {
      gameCode: game.externalId,
      playerId: player.id,
      tenantId: player.tenantId,
      currency,
      language,
      returnUrl,
    });

    return Response.json(
      {
        success: true,
        // 真实接口接入前一律为 mock：地址里的域名来自游戏商 API Endpoint 配置。
        mode: ticket.mode,
        gameUrl: ticket.url,
        token: ticket.token,
        expiresAt: ticket.expiresAt,
        game: {
          id: game.id,
          code: game.externalId,
          name: game.name,
          category: game.category,
        },
        player: {
          id: player.id,
          tenantId: player.tenantId,
          balance: player.balance.toFixed(6),
          currency,
        },
        provider: {
          id: connection.id,
          name: connection.name,
          configured: connection.configured,
        },
        warnings: ticket.warnings,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("启动游戏失败:", error);
    return jsonError("服务器内部错误，请稍后重试", 500);
  }
}
