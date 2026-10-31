import {
  bucketKeyForReason,
  normalizeFailReason,
  type AiAgentTypeValue,
  type ReasonCount,
} from "./constants";
import {
  SAVE_LEAD_FAILURE_REASON_TOOL_NAME,
} from "./prompts";
import type {
  AiCompletion,
  AiProviderMessage,
  AiProviderToolCall,
} from "./provider";

/**
 * 本地规则兜底。
 *
 * 没有配置 AI_API_KEY（或模型临时不可用）时，保证整条链路仍然可演示：
 * 识别「拒绝意图 + 价格 / 信任 / 推广」关键词 → 模拟一次
 * save_lead_failure_reason 工具调用 → 给出可读的销售回复。
 *
 * 注意：这只是兜底，不是真正的语义理解；生产环境请配置云端模型。
 */

const FAILURE_INTENT_PATTERN =
  /(不做|不考虑|不用了|算了|没兴趣|不开了|开不了|放弃|暂时不|再看看吧|没打算|不合作|先不了)/;
const PRICE_PATTERN =
  /(太贵|价格贵|贵了|价格高|预算|没钱|费用高|付不起|成本太高|便宜点)/;
const BLACK_PATTERN = /(黑台|跑路|骗子|骗人|不安全|怕被)/;
const TRUST_PATTERN = /(不信任|不信|不靠谱|担心|怕)/;
const PROMO_PATTERN = /(不会推|不会推广|不会做|不会引流|不懂推广)/;
const TRAFFIC_PATTERN =
  /(没流量|无流量|没人|没玩家|没客户|没渠道|没资源|无资源|推广不了)/;

/** 仅在客户明确拒绝时才返回原因，避免把正常比价误判成战败。 */
export function detectFailureReason(text: string): string | null {
  if (!FAILURE_INTENT_PATTERN.test(text)) {
    return null;
  }

  if (PRICE_PATTERN.test(text)) {
    return normalizeFailReason("价格贵");
  }

  if (BLACK_PATTERN.test(text)) {
    return normalizeFailReason("怕黑台");
  }

  if (TRUST_PATTERN.test(text)) {
    return normalizeFailReason("不信任");
  }

  if (PROMO_PATTERN.test(text)) {
    return normalizeFailReason("不会推");
  }

  if (TRAFFIC_PATTERN.test(text)) {
    return normalizeFailReason("没流量");
  }

  return normalizeFailReason("未说明");
}

function lastUserMessage(messages: readonly AiProviderMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === "user") {
      return message.content;
    }
  }

  return "";
}

function fallbackReplyForReason(reason: string, hasLead: boolean) {
  let reply: string;

  switch (bucketKeyForReason(reason)) {
    case "price":
      reply =
        "理解，预算确实是硬门槛。这样，我先按您的体量给一版分阶段方案，开台费可以拆到首月，测试站先跑通支付和游戏商，数据起来之前不追加投入，您看完再决定要不要推进。";
      break;
    case "trust":
      reply =
        "担心安全很正常。我们可以先开测试站，让您亲自跑通充值、下注、出金全链路，再把近期真实出金记录发您核对；跑通一笔小额出金再谈长期合作，风险您自己可控。";
      break;
    case "promotion":
      reply =
        "没流量也能起量，靠的是方法。我们有现成的素材包、代理分层模型和首充活动模板，先按周给您排一版起量计划，您照着执行两周看数据，再决定要不要加投入。";
      break;
    default:
      reply =
        "收到，我先记下您的顾虑。方便说下最卡的是价格、信任还是推广？我针对性给您一版方案，不浪费您时间。";
  }

  if (!hasLead) {
    reply += " 另外方便留一下品牌名和 Telegram / 邮箱吗？我把对应资料直接发您。";
  }

  return reply;
}

function qualificationReply(
  agentType: AiAgentTypeValue,
  messages: readonly AiProviderMessage[],
) {
  if (agentType === "tech") {
    return "收到，我先按常见链路帮您排查：1）确认回调地址公网可达；2）核对签名密钥与时间戳；3）检查网关订单是否已到终态。您把报错信息和订单号发我（不要发密钥），我继续定位。";
  }

  if (agentType === "support") {
    return "您好，已收到您的咨询。请描述具体问题并附上账号或订单号（不要发送密码、验证码），我按流程帮您核实。";
  }

  if (agentType === "finance") {
    return "收到。我先按三个口径拆解：1）平台收入与代理分润分开核算；2）通道成本、汇率损益单独归集；3）玩家余额与提现流水逐笔对账。请补充对账周期、币种和异常金额区间，我给您一版可直接执行的核对清单。";
  }

  if (agentType === "audit") {
    return "收到。审计结论需要先区分事实、推断与待核实项：1）锁定异常发生的账号、时间与订单号；2）补齐登录、充提、改单和后台操作日志；3）核对是否存在内部权限滥用。请提供可核查的证据范围，我不会在证据不足时直接下结论。";
  }

  if (agentType === "strategist") {
    return "先拆目标与约束：1）当前核心指标是流水、留存还是代理数量；2）可用预算与团队人手；3）时间窗口。围绕这三点，我会给出 2–3 个可执行方案，并标出短期动作和需要长期建设的能力。您先告诉我最想解决的一个问题。";
  }

  const userTurns = messages.filter((message) => message.role === "user").length;

  if (userTurns <= 1) {
    return "您好，我是 DBAIRS 的招商顾问。您目前是想了解自建站，还是已有站点想换支付 / 游戏商？方便说下主做的市场和现有玩家量级，我按您的体量给一版方案。";
  }

  return "明白。为了给您更准的方案，我想确认两点：1）主做哪个市场；2）现在大概的日活 / 流水和支付通道。您方便说下吗？";
}

export function generateFallbackCompletion(input: {
  agentType: AiAgentTypeValue;
  messages: readonly AiProviderMessage[];
  hasLead: boolean;
}): AiCompletion {
  const lastUser = lastUserMessage(input.messages);
  const reason =
    input.agentType === "sales" ? detectFailureReason(lastUser) : null;

  const toolCalls: AiProviderToolCall[] =
    reason && input.hasLead
      ? [
          {
            id: `fallback_${Date.now()}`,
            type: "function",
            function: {
              name: SAVE_LEAD_FAILURE_REASON_TOOL_NAME,
              arguments: JSON.stringify({ reason }),
            },
          },
        ]
      : [];

  return {
    content: reason
      ? fallbackReplyForReason(reason, input.hasLead)
      : qualificationReply(input.agentType, input.messages),
    toolCalls,
    model: "local-rules",
    fallback: true,
    finishReason: "stop",
  };
}

/** 「生成对策」的本地兜底：没有 API Key 时也能一键产出可保存的话术。 */
export function generateFallbackTactic(
  reasonCounts: readonly ReasonCount[],
): string {
  const topReason = reasonCounts[0]?.reason ?? "价格贵";

  switch (bucketKeyForReason(topReason)) {
    case "price":
      return `我理解您最在意的是「${topReason}」，很多老板第一次聊也这么说，预算当然要算清楚。我们不劝您一步到位：先按您的体量拆成首月开台 + 月费两段，测试站先跑通支付和游戏商，数据没起来之前不追加投入。您把主做市场和现有玩家量发我，我今天就出一版对应报价，您对比完再决定。`;
    case "trust":
      return `您担心「${topReason}」很正常，合作前谁都要先确认安全。我们可以先开测试站，让您亲自跑一遍充值、下注、出金全链路；同时把近期真实出金记录和对应游戏商后台数据发您核对。跑通一笔小额出金再谈长期合作，风险您自己可控。`;
    case "promotion":
      return `您说「${topReason}」，其实起量靠的是方法而不是现成流量。我们有一套验证过的起量 SOP：素材包、代理分层、首充活动模板都是现成的，先按周给您排一版计划，您照着执行两周看数据，再决定要不要加投入。方便说下主做市场吗？我按市场给您配素材。`;
    default:
      return `理解您现在的顾虑是「${topReason}」。为了不浪费您时间，我先按您的体量出一版开站方案和费用明细，测试站可以先跑通再付款；您看完如果还有卡点，我们再逐条解决。方便留一下品牌名和联系方式吗？`;
  }
}
