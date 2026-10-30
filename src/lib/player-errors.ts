import type { TranslationKey } from "./i18n-types";

/**
 * 玩家端 API 错误码 -> 词典 key。
 * API 同时返回中文 error（日志 / 兜底展示）与稳定的 code，前端优先按 code 本地化。
 */
export const PLAYER_ERROR_KEYS = {
  invalid_credentials: "player.error.invalidCredentials",
  player_disabled: "player.error.playerDisabled",
  tenant_unavailable: "player.error.tenantUnavailable",
  username_invalid: "player.error.usernameInvalid",
  email_invalid: "player.error.emailInvalid",
  password_invalid: "player.error.passwordInvalid",
  password_mismatch: "player.error.passwordMismatch",
  username_taken: "player.error.usernameTaken",
  email_taken: "player.error.emailTaken",
  referral_invalid: "player.error.referralInvalid",
  current_password_invalid: "player.error.currentPasswordInvalid",
  password_same: "player.error.passwordSame",
  wallet_invalid: "player.error.walletInvalid",
  unauthorized: "player.error.unauthorized",
  registration_failed: "player.error.generic",
  login_failed: "player.error.generic",
  wallet_update_failed: "player.error.generic",
  password_update_failed: "player.error.generic",
  bonus_failed: "player.error.generic",
  bonus_claimed: "player.error.bonusClaimed",
  invalid_request: "player.error.invalidRequest",
  not_found: "player.error.notFound",
} as const satisfies Record<string, TranslationKey>;

export type PlayerApiErrorCode = keyof typeof PLAYER_ERROR_KEYS;

export function playerErrorKey(code: unknown): TranslationKey | null {
  if (typeof code !== "string") {
    return null;
  }

  return PLAYER_ERROR_KEYS[code as PlayerApiErrorCode] ?? null;
}
