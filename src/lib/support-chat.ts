import type { TranslationKey } from "./i18n-types";

/**
 * 玩家侧 AI 客服的「话题 → 回复文案」映射（客户端弹窗与服务端接口共用）。
 *
 * 为什么要抽出来：
 * 弹窗原来只在浏览器里按关键词本地拼回复，商户后台看不到任何对话记录。
 * 现在同一条规则同时被 `/api/player/support/chat` 使用：服务端按相同关键词
 * 生成回复、写入 AiChatLog（带 tenantId / playerId），商户后台即可按租户查看。
 * 规则只维护一份，避免「前端说的话」和「后台记录的话」不一致。
 */

export type SupportTopic = {
  id: string;
  labelKey: TranslationKey;
  replyKey: TranslationKey;
  pattern: RegExp;
};

export const SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: "human",
    labelKey: "lobby.support.quick.human",
    replyKey: "lobby.support.reply.human",
    pattern: /人工|真人客服|专员|客服电话|human|agent|representative|live chat/i,
  },
  {
    id: "deposit",
    labelKey: "lobby.support.quick.deposit",
    replyKey: "lobby.support.reply.deposit",
    pattern: /充值|存款|入账|到账|deposit|top.?up|credit/i,
  },
  {
    id: "withdraw",
    labelKey: "lobby.support.quick.withdraw",
    replyKey: "lobby.support.reply.withdraw",
    pattern: /提现|出金|出款|取款|withdraw|payout|cash.?out/i,
  },
  {
    id: "bonus",
    labelKey: "lobby.support.quick.bonus",
    replyKey: "lobby.support.reply.bonus",
    pattern: /彩金|红利|优惠|奖励|返水|活动|bonus|promotion|rebate|reward|free spin/i,
  },
  {
    id: "account",
    labelKey: "lobby.support.quick.account",
    replyKey: "lobby.support.reply.account",
    pattern: /账号|账户|登录|密码|注册|验证|account|login|password|sign.?up|verify/i,
  },
  {
    id: "game",
    labelKey: "lobby.support.quick.game",
    replyKey: "lobby.support.reply.game",
    pattern: /游戏|卡住|掉线|加载|老虎机|game|stuck|lag|load|slot/i,
  },
];

export const SUPPORT_FALLBACK_REPLY_KEY: TranslationKey =
  "lobby.support.reply.fallback";

/** 单条消息长度上限（与弹窗输入框 maxLength 保持一致）。 */
export const SUPPORT_MESSAGE_MAX_LENGTH = 500;

export function resolveSupportTopic(message: string): SupportTopic | null {
  const text = message.trim();

  if (!text) {
    return null;
  }

  return SUPPORT_TOPICS.find((topic) => topic.pattern.test(text)) ?? null;
}

export function supportReplyKeyFor(message: string): TranslationKey {
  return resolveSupportTopic(message)?.replyKey ?? SUPPORT_FALLBACK_REPLY_KEY;
}
