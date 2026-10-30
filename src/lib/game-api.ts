import { Prisma } from "@prisma/client";

/**
 * 游戏接口统一查询字段与序列化逻辑。
 * provider 只带出 id / name，前台卡片左下角的游戏商 Logo 直接用这个名称。
 */
export const gameSelect = {
  id: true,
  providerId: true,
  externalId: true,
  name: true,
  category: true,
  iconUrl: true,
  sortOrder: true,
  isActive: true,
  syncedAt: true,
  updatedAt: true,
  provider: { select: { id: true, name: true } },
} satisfies Prisma.GameSelect;

export type GameRecord = Prisma.GameGetPayload<{
  select: typeof gameSelect;
}>;

export type SerializedGame = {
  id: string;
  providerId: string;
  providerName: string;
  externalId: string;
  name: string;
  category: string;
  iconUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  syncedAt: string;
  updatedAt: string;
};

export function serializeGame(game: GameRecord): SerializedGame {
  return {
    id: game.id,
    providerId: game.providerId,
    providerName: game.provider.name,
    externalId: game.externalId,
    name: game.name,
    category: game.category,
    iconUrl: game.iconUrl,
    sortOrder: game.sortOrder,
    isActive: game.isActive,
    syncedAt: game.syncedAt.toISOString(),
    updatedAt: game.updatedAt.toISOString(),
  };
}

/** 排序权重只接受 0 ~ 999999 的整数。 */
export function readSortOrderInput(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isInteger(number) || number < 0 || number > 999999) {
    return null;
  }

  return number;
}

/** 上架 / 下架开关只接受布尔值（也兼容 "true" / "false" 字符串）。 */
export function readBooleanInput(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "false") {
    return value === "true";
  }

  return null;
}
