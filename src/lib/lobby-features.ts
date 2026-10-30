import type { TranslationKey } from "./i18n-types";

/**
 * 占位功能：Mission / Referral / Withdraw / Login / Register。
 * 点开只弹「即将上线」提示，没有后端请求；文案统一走词典。
 */
export type LobbyFeature =
  | "mission"
  | "referral"
  | "withdraw"
  | "login"
  | "register";

export const LOBBY_FEATURE_CONTENT: Record<
  LobbyFeature,
  { titleKey: TranslationKey; bodyKey: TranslationKey }
> = {
  mission: { titleKey: "lobby.mission.title", bodyKey: "lobby.mission.desc" },
  referral: {
    titleKey: "lobby.referral.title",
    bodyKey: "lobby.referral.desc",
  },
  withdraw: { titleKey: "lobby.withdraw.title", bodyKey: "lobby.withdraw.desc" },
  login: { titleKey: "lobby.login.title", bodyKey: "lobby.login.desc" },
  register: { titleKey: "lobby.register.title", bodyKey: "lobby.register.desc" },
};
