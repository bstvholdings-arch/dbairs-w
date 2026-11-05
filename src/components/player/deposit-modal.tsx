"use client";

import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { PaymentQrImage } from "@/components/payment-qr-image";
import { resolveBrandName } from "@/lib/brand";
import {
  DEFAULT_CURRENCY,
  formatCurrency,
  formatDisplayAmount,
  normalizeCurrency,
} from "@/lib/currency";
import {
  GATEWAY_BANK_FIELD_LABEL_KEYS,
  GATEWAY_PAYMENT_TYPE_LABEL_KEYS,
  GATEWAY_PROVIDER_LABEL_KEYS,
} from "@/lib/i18n-keys";
import type { TFunction } from "@/lib/i18n-types";
import {
  GATEWAY_BANK_DETAIL_FIELDS,
  GATEWAY_BANK_DISPLAY_ORDER,
  type GatewayBankDetails,
} from "@/lib/payment-gateway-bank";
import {
  buildGatewayBankOptions,
  gatewayBankInitial,
} from "@/lib/payment-gateway-banks";
import {
  gatewayRequiresManualReview,
  isFiatGatewayChannel,
  type GatewayTypeValue,
} from "@/lib/payment-gateway-constants";
import { notifyPlayerWalletChanged } from "@/lib/player-wallet-events";

export type PlayerDepositGateway = {
  id: string;
  name: string;
  providerType: string;
  gatewayType: GatewayTypeValue;
  currency: string;
  walletAddress: string;
  hasQrCodeImage: boolean;
  hasBankDetails: boolean;
  /**
   * STATIC_QR 的收款码图片地址（只有 http(s) / 站内路径会下发）。
   * 有这个值 = 玩家在「输入金额之前」就能看到大图扫码付；
   * 空串 = 商家用的是 base64 上传图，下单后由 create 响应带回。
   */
  staticQrImageUrl?: string;
  /**
   * REDIRECT_URL 玩家可选的银行（编码，如 maybank）。
   * 空数组 = 不做银行选择，直接跳支付商收银台。
   */
  supportedBanks?: string[];
};

type AmountLimits = { min: string; max: string };

type GatewayListResponse = {
  gateways?: PlayerDepositGateway[];
  amountLimits?: AmountLimits;
  /** false = 该商户一条收款通道都没配；true = 配了但当前不可用。 */
  merchantConfigured?: boolean;
  error?: string;
};

/** /api/deposit/create 返回的统一收款指令（CRYPTO / FIAT 二选一）。 */
type PaymentInstructions = {
  kind: "CRYPTO" | "FIAT";
  amount: string;
  currency: string;
  walletAddress: string | null;
  network: string | null;
  qrCodeData: string | null;
  qrCodeDataWithAmount: string | null;
  bankDetails: GatewayBankDetails | null;
  qrCodeImageUrl: string | null;
  paymentUrl: string | null;
};

type CreatedDeposit = {
  orderId: string;
  orderNo: string;
  amount: string;
  currency: string;
  gatewayName: string;
  /**
   * 下单时选中的通道形态（接口也会回传，取不到就回落到下拉框里选中的那条）。
   * 决定「展示银行信息」还是「展示二维码」，不能靠 amount / kind 猜。
   */
  gatewayType: GatewayTypeValue;
  /** REDIRECT_URL：玩家选的银行编码 / 展示名（其他形态为空串） */
  selectedBank: string;
  selectedBankLabel: string;
  /**
   * 静态码 / 银行转账：钱进商户自己的银行账户，**永不自动上分**。
   * true 时文案必须说「等商户人工确认」，不能承诺「1-3 分钟自动到账」。
   */
  requiresManualReview: boolean;
  instructions: PaymentInstructions;
  canSimulateCallback: boolean;
};

type CreateDepositResponse = {
  success?: boolean;
  orderNo?: string;
  gatewayType?: GatewayTypeValue;
  selectedBank?: string | null;
  selectedBankLabel?: string | null;
  order?: {
    id: string;
    orderNo?: string;
    amount: string;
    currency: string;
    gatewayName: string;
    gatewayType?: GatewayTypeValue;
  };
  paymentInstructions?: PaymentInstructions;
  canSimulateCallback?: boolean;
  /** 静态码 / 银行转账为 true：下单后等商户人工确认，不会自动上分 */
  requiresManualReview?: boolean;
  amountLimits?: AmountLimits;
  error?: string;
};

type TestCallbackResponse = {
  success?: boolean;
  replayed?: boolean;
  /** 静态码 / 银行转账：回调只入队，不加钱 → 这里是 true，balance 为空 */
  manualReview?: boolean;
  balance?: string | null;
  error?: string;
};

const DEFAULT_AMOUNT_LIMITS: AmountLimits = { min: "10", max: "50000" };
const QUICK_AMOUNTS = ["10", "50", "100", "500"];
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30";

function providerLabel(providerType: string, t: TFunction) {
  const key =
    GATEWAY_PROVIDER_LABEL_KEYS[
      providerType as keyof typeof GATEWAY_PROVIDER_LABEL_KEYS
    ];

  return key ? t(key) : providerType;
}

function formatMoney(value: string, currency: string) {
  // 「应付多少钱」必须原样显示，不能四舍五入（USDT 12.345678 少给一位就充不上），
  // 所以这里刻意保留最多 6 位小数；余额 / 到账提示一律走 formatDisplayAmount。
  // 符号由充值通道币种决定（MYR → RM、USDT → USDT、USD → $），见 src/lib/currency.ts
  return formatCurrency(value, currency, { maximumFractionDigits: 6 });
}

/**
 * 银行转账信息的展示行：按 GATEWAY_BANK_DISPLAY_ORDER（收款银行 → 账户名 → 账号
 * → IBAN / SWIFT / PayID…）排列，没填的字段自动隐藏，不会出现一堆「—」。
 */
function bankRows(details: GatewayBankDetails, t: TFunction) {
  return GATEWAY_BANK_DISPLAY_ORDER.map((key) => ({
    key,
    label: t(GATEWAY_BANK_FIELD_LABEL_KEYS[key]),
    value: details[key].trim(),
    multiline: Boolean(
      GATEWAY_BANK_DETAIL_FIELDS.find((field) => field.key === key)?.multiline,
    ),
  })).filter((row) => Boolean(row.value));
}

/**
 * 前台大厅充值弹窗（黑金风格）。
 *
 * 流程：输入金额 + 选择系统已启用的支付网关 → POST /api/deposit/create
 * → 展示收款信息（USDT 钱包地址 + 一键复制 / 法币银行账号 + 收款码）
 * → 等待支付商回调自动上分（1-3 分钟）。
 *
 * 安全说明：
 * - 身份完全由 httpOnly 玩家 Cookie 决定，前端不传 playerId，避免越权代充；
 * - 金额前后端都会校验（默认 10 ~ 50,000），服务端 parseDepositAmount 为最终口径；
 * - 订单状态只会由带签名的支付商回调改变，「我已完成支付（测试）」按钮
 *   只在非生产环境出现，且复用正式回调的状态机。
 */
export function PlayerDepositModal({
  open,
  playerName,
  brandName,
  walletCurrency,
  onClose,
  onDeposited,
}: {
  open: boolean;
  playerName?: string;
  /** 商户品牌名（Tenant.name）：只用于弹窗页脚署名，缺省回退平台名 */
  brandName?: string;
  /**
   * 租户记账币种（Tenant.currency）。
   * 到账提示里的「当前余额」必须按它渲染符号与两位小数，
   * 不能用充值通道币种（通道可能是 USDT、钱包却是 MYR）。
   */
  walletCurrency?: string;
  onClose: () => void;
  onDeposited?: (balance?: string | null) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [gateways, setGateways] = useState<PlayerDepositGateway[]>([]);
  const [limits, setLimits] = useState<AmountLimits>(DEFAULT_AMOUNT_LIMITS);
  const [gatewayId, setGatewayId] = useState("");
  // REDIRECT_URL：玩家选中的银行编码（其他形态为空串）
  const [bank, setBank] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [simulating, setSimulating] = useState(false);
  /** 「我已付款」提交中（静态码 / 银行转账：只入队转人工审核） */
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedDeposit | null>(null);
  const [creditedBalance, setCreditedBalance] = useState<string | null>(null);
  /** 静态码 / 银行转账「我已完成支付」后：订单已提交人工审核（没加钱） */
  const [manualReviewSubmitted, setManualReviewSubmitted] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    // 注意：这里不在 effect 体里同步 setState（会触发级联渲染），
    // loading 初值即 true，异步请求结束后再一次性落地结果。
    void (async () => {
      try {
        const response = await fetch("/api/deposit/gateways", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const data: GatewayListResponse = await response
          .json()
          .catch(() => ({}) as GatewayListResponse);

        if (!active) {
          return;
        }

        if (!response.ok) {
          setLoadError(
            data.error ||
              (response.status === 401
                ? t("player.deposit.loginRequired")
                : t("player.deposit.loadFailed")),
          );
          return;
        }

        /**
         * 法币专精（双保险）：接口已经过滤掉加密货币通道，前端再兜底拦一次。
         * 这样即使服务端某天漏了 / 缓存了旧响应，玩家也不可能看到 USDT 选项。
         */
        const available = (data.gateways ?? []).filter(isFiatGatewayChannel);

        if (available.length === 0) {
          // 去中心化支付：充值通道完全由商户自己配置。
          // merchantConfigured=false 说明该商户从未接入支付商，需要引导玩家联系客服。
          setLoadError(
            t(
              data.merchantConfigured === false
                ? "player.deposit.merchantNoChannels"
                : "player.deposit.noGateways",
            ),
          );
          return;
        }

        setLoadError("");
        setGateways(available);
        setGatewayId((current) => current || available[0].id);

        if (data.amountLimits) {
          setLimits(data.amountLimits);
        }
      } catch {
        if (!active || controller.signal.aborted) {
          return;
        }

        setLoadError(t("common.networkError"));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, t]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const selectedGateway =
    gateways.find((gateway) => gateway.id === gatewayId) ?? null;
  /**
   * 金额单位：优先用通道币种（= 玩家实际要付的法币），
   * 没有通道时**回落到本站记账币种**（Tenant.currency）。
   *
   * 历史写法是 `?? "USDT"`，法币专精后这句就是错的：
   * 一个 THB 站弹窗里冒出「USDT 10.00」既违法币口径也会吓跑玩家。
   */
  const currency = selectedGateway
    ? normalizeCurrency(selectedGateway.currency)
    : normalizeCurrency(walletCurrency ?? DEFAULT_CURRENCY);

  /**
   * 表单形态只看「当前选中通道的 gatewayType」：
   * - REDIRECT_URL  → 先选银行，再输入金额，提交后整页跳转到支付商；
   * - STATIC_QR     → 直接怼大图收款码（能拿到远程图就先展示）；
   * - BANK_TRANSFER → 提交后展示收款银行 / 账号 / 户名 + 一键复制；
   * - DYNAMIC_QR    → 提交后展示钱包地址 + 动态二维码。
   * 不允许用币种或 kind 去反推形态。
   */
  const selectedGatewayType: GatewayTypeValue =
    selectedGateway?.gatewayType ?? "STATIC_QR";
  const isRedirectGateway = selectedGatewayType === "REDIRECT_URL";
  const isStaticQrGateway = selectedGatewayType === "STATIC_QR";
  const isBankTransferGateway = selectedGatewayType === "BANK_TRANSFER";
  const bankOptions = buildGatewayBankOptions(
    selectedGateway?.supportedBanks ?? [],
  );
  // 只有「商户配了银行列表」才需要玩家选银行；空列表 = 支付商页面自己选。
  const needsBankChoice = isRedirectGateway && bankOptions.length > 0;
  const staticQrPreview = selectedGateway?.staticQrImageUrl?.trim() ?? "";

  // 订单形态只看「下单时选中的通道」（接口回传优先）：银行转账绝不渲染二维码，
  // 静态收款图才渲染图片，跳转支付只给按钮。不要用 kind / 币种去反推。
  const orderGatewayType = created?.gatewayType ?? null;
  const isBankTransferOrder = orderGatewayType === "BANK_TRANSFER";
  const isStaticQrOrder = orderGatewayType === "STATIC_QR";
  const isRedirectOrder = orderGatewayType === "REDIRECT_URL";
  const bankDetailRows = created?.instructions.bankDetails
    ? bankRows(created.instructions.bankDetails, t)
    : [];

  async function copyToClipboard(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? "" : current));
      }, 1600);
    } catch {
      setError(t("player.deposit.copyFailed"));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmed = amount.trim();
    const value = Number(trimmed);

    if (!AMOUNT_PATTERN.test(trimmed) || !Number.isFinite(value)) {
      setError(t("player.deposit.amountInvalid"));
      return;
    }

    if (value < Number(limits.min)) {
      setError(t("player.deposit.amountTooSmall", { min: limits.min }));
      return;
    }

    if (value > Number(limits.max)) {
      setError(t("player.deposit.amountTooLarge", { max: limits.max }));
      return;
    }

    if (!gatewayId) {
      setError(t("player.deposit.noGateways"));
      return;
    }

    // 跳转网银且商户配了银行列表：必须先选银行，否则会在支付商页面乱选。
    if (needsBankChoice && !bank) {
      setError(t("player.deposit.bankRequired"));
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/deposit/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          gatewayId,
          amount: trimmed,
          // bank 只对 REDIRECT_URL 有意义，服务端会再校验一遍白名单。
          ...(bank ? { bank } : {}),
        }),
      });
      const data: CreateDepositResponse = await response
        .json()
        .catch(() => ({}) as CreateDepositResponse);

      if (!response.ok || !data.success || !data.order) {
        setError(data.error || t("player.deposit.createFailed"));
        return;
      }

      if (data.amountLimits) {
        setLimits(data.amountLimits);
      }

      const instructions = data.paymentInstructions;
      const orderNo = data.order.orderNo ?? data.orderNo ?? data.order.id;
      const orderGatewayType: GatewayTypeValue =
        data.gatewayType ??
        data.order.gatewayType ??
        selectedGateway?.gatewayType ??
        "STATIC_QR";

      const createdOrder: CreatedDeposit = {
        orderId: data.order.id,
        orderNo,
        amount: data.order.amount,
        currency: data.order.currency,
        gatewayName: data.order.gatewayName,
        // 接口回传优先；老接口没这个字段时用当前选中的通道（下单用的就是它）
        gatewayType: orderGatewayType,
        selectedBank: data.selectedBank ?? "",
        selectedBankLabel: data.selectedBankLabel ?? "",
        // 静态码 / 银行转账永不自动上分：服务端判定优先，缺失时按形态自己兜一层，
        // 宁可多提示「等人工确认」，也不能骗玩家「1-3 分钟到账」。
        requiresManualReview:
          data.requiresManualReview ??
          gatewayRequiresManualReview(orderGatewayType),
        canSimulateCallback: Boolean(data.canSimulateCallback),
        instructions: instructions ?? {
          kind: "FIAT",
          amount: data.order.amount,
          currency: data.order.currency,
          walletAddress: null,
          network: null,
          qrCodeData: null,
          qrCodeDataWithAmount: null,
          bankDetails: null,
          qrCodeImageUrl: null,
          paymentUrl: null,
        },
      };

      setCreated(createdOrder);
      setCreditedBalance(null);
      setManualReviewSubmitted(false);

      /**
       * 跳转网银（REDIRECT_URL）：订单已落库，拿到支付商收银台地址就整页跳过去。
       *
       * - 必须同标签页跳转：手机浏览器会拦截 window.open 弹窗，玩家会以为「点了没反应」；
       * - 跳转前已经 setCreated，万一被浏览器拦下 / 地址打不开，页面会显示
       *   「正在跳转…」+ 手动前往按钮，不会卡死在空白界面上。
       */
      if (
        createdOrder.gatewayType === "REDIRECT_URL" &&
        createdOrder.instructions.paymentUrl
      ) {
        // 用 assign() 而不是给 location.href 赋值：这是「发起导航」的语义，
        // 也能过 react-hooks/immutability（不允许改写组件外变量的属性）。
        window.location.assign(createdOrder.instructions.paymentUrl);
      }
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSimulate() {
    if (!created || simulating) {
      return;
    }

    setSimulating(true);
    setError("");

    try {
      const response = await fetch("/api/deposit/test-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orderId: created.orderId }),
      });
      const data: TestCallbackResponse = await response
        .json()
        .catch(() => ({}) as TestCallbackResponse);

      if (!response.ok || !data.success) {
        setError(data.error || t("player.deposit.createFailed"));
        return;
      }

      /**
       * 静态码 / 银行转账：回调只把订单挂进商户后台的「充值审核」队列，
       * **一分钱都不会加**。这里必须换文案，绝不能显示「已到账 + 新余额」，
       * 更不能广播余额变更事件（会把玩家顶栏的余额刷成过期值）。
       */
      if (data.manualReview) {
        setManualReviewSubmitted(true);
        setCreditedBalance(null);
        return;
      }

      const balance = data.balance ?? null;

      setCreditedBalance(balance);
      onDeposited?.(balance);

      // 上分是「服务端事务已提交」的既成事实，这里必须把余额同步做全：
      // 1) 广播 dbairs:player-wallet-changed **并带上服务端刚算好的余额** —— 大厅顶栏
      //    等自己持有余额 state 的组件收到后立刻重绘（不等网络往返），再自行校准；
      // 2) router.refresh() —— 让玩家中心 / 大厅首屏这些 Server Component 重新取数。
      // 少了任何一步都会出现「弹窗说已到账、顶部 Header 还是旧余额」。
      notifyPlayerWalletChanged({ balance });
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSimulating(false);
    }
  }

  async function handleClaimPaid() {
    if (!created || claiming) {
      return;
    }

    setClaiming(true);
    setError("");

    try {
      const response = await fetch("/api/deposit/claim-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orderId: created.orderId }),
      });
      const data: TestCallbackResponse = await response
        .json()
        .catch(() => ({}) as TestCallbackResponse);

      if (!response.ok || !data.success) {
        setError(data.error || t("player.deposit.claimPaidFailed"));
        return;
      }

      // 只入队、不加钱：不广播余额变更，等商户确认到账后玩家刷新即可看到。
      setManualReviewSubmitted(true);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setClaiming(false);
    }
  }

  const errorBanner = error ? (
    <div
      aria-live="polite"
      className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3.5 py-2.5 text-[11px] leading-5 text-red-300"
    >
      {error}
    </div>
  ) : null;

  /**
   * 收款提示文案。
   *
   * 静态码 / 银行转账的钱进商户自己的银行账户，系统拿不到机器凭证，
   * 因此**永不自动上分**：必须提示「付款后由商户人工确认到账」，
   * 不能承诺「1-3 分钟自动到账」（否则玩家会反复来问「钱呢」）。
   */
  const manualReviewGateway = created
    ? created.requiresManualReview
    : gatewayRequiresManualReview(selectedGatewayType);
  const payNoticeText = manualReviewGateway
    ? t("player.deposit.manualReviewNotice")
    : t("player.deposit.payNotice");

  function copyButton(key: string, value: string) {
    return (
      <button
        type="button"
        onClick={() => void copyToClipboard(key, value)}
        className="shrink-0 rounded-lg border border-[#d4af37]/30 px-2.5 py-1 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
      >
        {copiedKey === key ? t("player.deposit.copied") : t("player.deposit.copy")}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("player.deposit.title")}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#d4af37]/25 bg-[#080808] shadow-[0_30px_120px_-25px_rgba(212,175,55,0.45)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#d4af37]/10 bg-[radial-gradient(circle_at_top_left,rgba(212,175,55,0.16),transparent_60%)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-[#f0d27c]">
              {t("player.deposit.title")}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-neutral-500">
              {created ? payNoticeText : t("player.deposit.subtitle")}
            </p>
            {playerName ? (
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                {t("player.deposit.forPlayer", { name: playerName })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 text-neutral-500 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-10 text-center">
              <span
                aria-hidden="true"
                className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[#d4af37]/25 border-t-[#f0d27c]"
              />
              <p className="mt-4 text-xs text-neutral-400">
                {t("player.deposit.loading")}
              </p>
            </div>
          ) : loadError ? (
            <div className="py-6 text-center">
              <span
                aria-hidden="true"
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-red-400/30 bg-red-400/10 text-lg text-red-300"
              >
                !
              </span>
              <p className="mt-3 text-xs leading-5 text-neutral-300">
                {loadError}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border border-white/10 px-4 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
              >
                {t("common.close")}
              </button>
            </div>
          ) : created ? (
            <>
              <div className="rounded-xl border border-[#d4af37]/25 bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,0.12),transparent_65%)] px-4 py-3 text-center">
                <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                  {t("player.deposit.payAmount")}
                </p>
                <p className="mt-1 font-mono text-2xl text-[#f0d27c]">
                  {formatMoney(created.amount, created.currency)}
                </p>
                <p className="mt-1 text-[10px] text-neutral-600">
                  {created.gatewayName}
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  {t("player.deposit.orderNo")}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-[11px] text-neutral-300">
                    {created.orderNo}
                  </span>
                  {copyButton("orderNo", created.orderNo)}
                </span>
              </div>

              {isBankTransferOrder ? (
                /* 银行转账：只给收款信息，**任何情况下都不渲染二维码** */
                <div className="mt-3 rounded-xl border border-[#d4af37]/20 bg-black/40 px-4 py-3">
                  {bankDetailRows.length > 0 ? (
                    <>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                        {t("player.deposit.bankTitle")}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-[#e8cf8a]">
                        {t("player.deposit.bankInstruction")}
                      </p>
                      <dl className="mt-2 space-y-2">
                        {bankDetailRows.map((row) => (
                          <div
                            key={row.key}
                            className="flex items-start justify-between gap-2"
                          >
                            <dt className="w-24 shrink-0 text-[10px] leading-5 text-neutral-600">
                              {row.label}
                            </dt>
                            <dd
                              className={`min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-neutral-200 ${
                                row.multiline ? "whitespace-pre-wrap" : ""
                              }`}
                            >
                              {row.value}
                            </dd>
                            {/* 每一行都有【一键复制】：账号 / 户名都是长串，手抄必错 */}
                            {copyButton(`bank-${row.key}`, row.value)}
                          </div>
                        ))}
                      </dl>
                      <p className="mt-2 text-[10px] leading-4 text-neutral-600">
                        {t("player.deposit.bankHint", {
                          orderNo: created.orderNo,
                        })}
                      </p>
                      {/* 一键复制全部：手机玩家最怕逐行抄账号，客服也最烦对账对错 */}
                      <button
                        type="button"
                        onClick={() =>
                          void copyToClipboard(
                            "bank-all",
                            [
                              ...bankDetailRows.map(
                                (row) => `${row.label}: ${row.value}`,
                              ),
                              `${t("player.deposit.payAmount")}: ${formatMoney(
                                created.amount,
                                created.currency,
                              )}`,
                              `${t("player.deposit.orderNo")}: ${created.orderNo}`,
                            ].join("\n"),
                          )
                        }
                        className="mt-3 h-9 w-full rounded-lg border border-[#d4af37]/30 text-[10px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
                      >
                        {copiedKey === "bank-all"
                          ? t("player.deposit.bankCopiedAll")
                          : t("player.deposit.bankCopyAll")}
                      </button>
                    </>
                  ) : (
                    /* 后台配成「银行转账」却没填账号：绝不渲染空白卡片，直接引导找客服 */
                    <p className="text-center text-[11px] leading-5 text-[#e8cf8a]">
                      {t("player.deposit.bankMissing")}
                    </p>
                  )}
                </div>
              ) : isRedirectOrder ? (
                /*
                  跳转网银（REDIRECT_URL）：**绝不渲染二维码**。

                  提交时已经执行 window.location.href，正常情况下玩家看不到这一屏；
                  它兜住的是「浏览器拦了跳转 / 支付链接打不开」的情况 ——
                  订单号已经生成，不能让玩家对着空白页发呆。
                */
                <div className="mt-3 rounded-xl border border-[#d4af37]/25 bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.12),transparent_65%)] px-4 py-5 text-center">
                  {created.instructions.paymentUrl ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="mx-auto block h-7 w-7 animate-spin rounded-full border-2 border-[#d4af37]/25 border-t-[#f0d27c]"
                      />
                      <p className="mt-3 text-[11px] leading-5 text-[#f0d27c]">
                        {created.selectedBankLabel
                          ? t("player.deposit.redirectingToBank", {
                              bank: created.selectedBankLabel,
                            })
                          : t("player.deposit.redirectingToGateway")}
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                        {t("player.deposit.redirectFallback")}
                      </p>
                      <a
                        href={created.instructions.paymentUrl}
                        className="mt-3 flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] shadow-[0_14px_36px_-14px_rgba(212,175,55,0.9)]"
                      >
                        {t("player.deposit.paymentUrl")} ↗
                      </a>
                    </>
                  ) : (
                    <p className="text-[11px] leading-5 text-[#e8cf8a]">
                      {t("player.deposit.redirectNoUrl")}
                    </p>
                  )}
                </div>
              ) : isStaticQrOrder ? (
                /* 静态收款码：大图直出（手机银行扫一扫），不掺其他通道信息 */
                <div className="mt-3 rounded-xl border border-[#d4af37]/20 bg-black/40 px-4 py-4 text-center">
                  <p className="text-[11px] font-semibold text-[#f0d27c]">
                    {t("player.deposit.staticQrHint")}
                  </p>
                  <div className="mt-3">
                    <PaymentQrImage
                      src={created.instructions.qrCodeImageUrl}
                      alt={t("player.deposit.staticQrHint")}
                      missingText={t("player.deposit.qrMissing")}
                      frameClassName="mx-auto flex w-fit justify-center rounded-xl bg-white p-2.5"
                      imageClassName="h-56 w-56 rounded-lg object-contain"
                    />
                  </div>
                  <p className="mt-3 text-[10px] leading-4 text-neutral-500">
                    {t("player.deposit.staticQrNote", {
                      amount: formatMoney(created.amount, created.currency),
                    })}
                  </p>
                </div>
              ) : created.instructions.kind === "CRYPTO" ? (
                <div className="mt-3 rounded-xl border border-[#d4af37]/20 bg-black/40 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("player.deposit.walletAddress")}
                    </span>
                    {created.instructions.network ? (
                      <span className="rounded-full border border-[#d4af37]/30 px-2 py-0.5 text-[9px] tracking-[0.14em] text-[#f0d27c]">
                        {created.instructions.network}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-neutral-200">
                      {created.instructions.walletAddress}
                    </code>
                    {copyButton(
                      "wallet",
                      created.instructions.walletAddress ?? "",
                    )}
                  </div>
                  {(created.instructions.qrCodeDataWithAmount ??
                  created.instructions.qrCodeData) ? (
                    <div className="mt-3 flex justify-center rounded-lg bg-white p-2.5">
                      <QRCodeSVG
                        value={
                          (created.instructions.qrCodeDataWithAmount ??
                            created.instructions.qrCodeData) as string
                        }
                        size={148}
                      />
                    </div>
                  ) : null}
                  <p className="mt-2 text-[10px] leading-4 text-neutral-600">
                    {t("player.deposit.scanHint")}
                  </p>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {/*
                    动态二维码（非 USDT 支付商，例如 DuitNow 动态码）：
                    优先用接口下发的二维码内容现场生成；只有拿不到内容时才退回收款图。
                    兜底图走 PaymentQrImage —— 图 404 / 被墙时显示占位框，绝不裂图。
                  */}
                  <div className="rounded-xl border border-[#d4af37]/20 bg-black/40 px-4 py-3 text-center">
                    {created.instructions.qrCodeData ? (
                      <>
                        <div className="flex justify-center rounded-lg bg-white p-2.5">
                          <QRCodeSVG
                            value={created.instructions.qrCodeData}
                            size={148}
                          />
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-neutral-600">
                          {t("player.deposit.scanHint")}
                        </p>
                      </>
                    ) : (
                      <PaymentQrImage
                        src={created.instructions.qrCodeImageUrl}
                        alt={t("player.deposit.qrMissing")}
                        missingText={t("player.deposit.qrMissing")}
                        frameClassName="mx-auto flex w-fit justify-center rounded-lg bg-white p-2"
                        imageClassName="max-h-56 w-auto rounded-lg object-contain"
                      />
                    )}
                  </div>

                  {created.instructions.paymentUrl ? (
                    <a
                      href={created.instructions.paymentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-10 items-center justify-center rounded-xl border border-[#d4af37]/35 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10"
                    >
                      {t("player.deposit.paymentUrl")} ↗
                    </a>
                  ) : null}
                </div>
              )}

              <div className="mt-4 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.06] px-3.5 py-2.5 text-[11px] leading-5 text-[#e8cf8a]">
                {payNoticeText}
              </div>

              {creditedBalance ? (
                <p className="mt-3 text-center text-[11px] text-emerald-300">
                  {t("player.deposit.testPaidDone", {
                    // 接口回传的是 Decimal 原样字符串（530.500000），
                    // 展示必须走统一口径：两位小数 + 租户币种符号（RM 530.50）。
                    balance: formatDisplayAmount(
                      creditedBalance,
                      walletCurrency ?? created.currency,
                    ),
                  })}
                </p>
              ) : null}

              {manualReviewSubmitted ? (
                <p className="mt-3 text-center text-[11px] leading-5 text-[#e8cf8a]">
                  {t("player.deposit.manualReviewSubmitted")}
                </p>
              ) : null}

              {errorBanner}

              <div className="mt-4 flex gap-2">
                {created.requiresManualReview &&
                !creditedBalance &&
                !manualReviewSubmitted ? (
                  <button
                    type="button"
                    onClick={() => void handleClaimPaid()}
                    disabled={claiming}
                    className="h-10 flex-1 rounded-xl border border-[#d4af37]/35 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {claiming
                      ? t("player.deposit.imPaidPending")
                      : t("player.deposit.imPaid")}
                  </button>
                ) : null}
                {created.canSimulateCallback &&
                !created.requiresManualReview &&
                !creditedBalance &&
                !manualReviewSubmitted ? (
                  <button
                    type="button"
                    onClick={() => void handleSimulate()}
                    disabled={simulating}
                    className="h-10 flex-1 rounded-xl border border-[#d4af37]/35 text-[11px] text-[#f0d27c] transition-colors hover:bg-[#d4af37]/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {simulating
                      ? t("player.deposit.testPaidPending")
                      : t("player.deposit.testPaid")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setCreated(null);
                    setCreditedBalance(null);
                    setManualReviewSubmitted(false);
                    setError("");
                  }}
                  className="h-10 flex-1 rounded-xl border border-white/10 text-[11px] text-neutral-400 transition-colors hover:border-[#d4af37]/30 hover:text-neutral-100"
                >
                  {t("player.deposit.editOrder")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreated(null);
                    setCreditedBalance(null);
                    setManualReviewSubmitted(false);
                    setAmount("");
                    setError("");
                  }}
                  className="h-10 flex-1 rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] shadow-[0_14px_36px_-14px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-90"
                >
                  {t("player.deposit.newOrder")}
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              {/*
                通道选择：
                - 只有 1 条通道 → **不渲染下拉框**，直接一张通道卡片（玩家没有可选项，
                  下拉框只会白占一行还把二维码挤下去）；
                - 多条通道 → 保留下拉框，切换时清空已选银行（银行列表是通道级的）。
              */}
              {gateways.length > 1 ? (
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("player.deposit.gatewayLabel")}
                  </span>
                  <select
                    value={gatewayId}
                    onChange={(event) => {
                      setGatewayId(event.target.value);
                      setBank("");
                    }}
                    className={inputClass}
                  >
                    {gateways.map((gateway) => (
                      <option
                        key={gateway.id}
                        value={gateway.id}
                        className="bg-[#0a0a0a]"
                      >
                        {gateway.name} ·{" "}
                        {providerLabel(gateway.providerType, t)} ·{" "}
                        {gateway.currency}
                      </option>
                    ))}
                  </select>
                </label>
              ) : selectedGateway ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#d4af37]/20 bg-[#d4af37]/[0.05] px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-[#f0d27c]">
                      {selectedGateway.name}
                    </p>
                    <p className="mt-0.5 text-[10px] text-neutral-500">
                      {providerLabel(selectedGateway.providerType, t)} ·{" "}
                      {selectedGateway.currency}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#d4af37]/30 px-2 py-0.5 text-[9px] tracking-[0.12em] text-[#f0d27c]">
                    {t(GATEWAY_PAYMENT_TYPE_LABEL_KEYS[selectedGatewayType])}
                  </span>
                </div>
              ) : null}

              {/*
                跳转网银（REDIRECT_URL）：先选银行，再输入金额。
                银行列表来自商户配置（gateway.supportedBanks），前端只渲染，
                提交后服务端会再校验一次白名单 —— 前端可绕过，服务端不可绕过。
              */}
              {isRedirectGateway ? (
                needsBankChoice ? (
                  <fieldset className="mt-4">
                    <legend className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                      {t("player.deposit.bankSelectTitle")}
                    </legend>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {bankOptions.map((option) => {
                        const active = bank === option.code;

                        return (
                          <label
                            key={option.code}
                            className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors ${
                              active
                                ? "border-[#d4af37]/60 bg-[#d4af37]/[0.12] text-[#f0d27c]"
                                : "border-white/[0.08] bg-white/[0.02] text-neutral-300 hover:border-[#d4af37]/25"
                            }`}
                          >
                            {/* 真实 radio：键盘 Tab + 方向键可用，视觉上用卡片代替小圆点 */}
                            <input
                              type="radio"
                              name="deposit-bank"
                              value={option.code}
                              checked={active}
                              onChange={() => setBank(option.code)}
                              className="sr-only"
                            />
                            <span
                              aria-hidden="true"
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold ${
                                active
                                  ? "border-[#d4af37]/50 bg-[#d4af37]/15 text-[#f0d27c]"
                                  : "border-white/10 bg-black/40 text-neutral-400"
                              }`}
                            >
                              {gatewayBankInitial(option.code)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[11px]">
                              {option.label}
                            </span>
                            {active ? (
                              <span
                                aria-hidden="true"
                                className="shrink-0 text-[10px] text-[#f0d27c]"
                              >
                                ✓
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-neutral-600">
                      {t("player.deposit.bankSelectHint")}
                    </p>
                  </fieldset>
                ) : (
                  /* 商户没配银行列表：交给支付商收银台自己选，别让玩家空等 */
                  <p className="mt-4 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.05] px-3.5 py-2.5 text-[10px] leading-4 text-[#e8cf8a]">
                    {t("player.deposit.bankAutoHint")}
                  </p>
                )
              ) : null}

              <label className="mt-4 block">
                <span className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                  <span>{t("player.deposit.amountLabel", { currency })}</span>
                  <span className="font-mono normal-case tracking-normal text-neutral-700">
                    {t("player.deposit.amountRange", {
                      min: limits.min,
                      max: limits.max,
                    })}
                  </span>
                </span>
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("player.deposit.amountPlaceholder")}
                  className={`${inputClass} font-mono text-lg`}
                />
              </label>

              <div className="mt-2 grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.filter(
                  (value) =>
                    Number(value) >= Number(limits.min) &&
                    Number(value) <= Number(limits.max),
                ).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAmount(value)}
                    className={`h-8 rounded-lg border font-mono text-[11px] transition-colors ${
                      amount === value
                        ? "border-[#d4af37]/50 bg-[#d4af37]/15 text-[#f0d27c]"
                        : "border-white/[0.08] bg-white/[0.02] text-neutral-500 hover:border-[#d4af37]/25 hover:text-neutral-300"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>

              {/*
                STATIC_QR：商户配了远程收款图时，不用等下单就把大图怼上来，
                玩家扫码即付；图走 PaymentQrImage（404 / 被墙显示占位框）。
              */}
              {isStaticQrGateway && staticQrPreview ? (
                <div className="mt-4 rounded-xl border border-[#d4af37]/20 bg-black/40 px-4 py-3.5 text-center">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    {t("player.deposit.staticQrPreview")}
                  </p>
                  <div className="mt-2">
                    <PaymentQrImage
                      src={staticQrPreview}
                      alt={t("player.deposit.staticQrHint")}
                      missingText={t("player.deposit.qrMissing")}
                      frameClassName="mx-auto flex w-fit justify-center rounded-xl bg-white p-2.5"
                      imageClassName="h-52 w-52 rounded-lg object-contain"
                    />
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-[#f0d27c]">
                    {t("player.deposit.staticQrHint")}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-neutral-600">
                    {t("player.deposit.staticQrPreviewNote")}
                  </p>
                </div>
              ) : null}

              {/* BANK_TRANSFER：提交后才给收款账户，先告诉玩家会拿到什么 */}
              {isBankTransferGateway ? (
                <p className="mt-4 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.05] px-3.5 py-2.5 text-[10px] leading-4 text-[#e8cf8a]">
                  {t("player.deposit.bankTransferIntro")}
                </p>
              ) : null}

              {errorBanner}

              <button
                type="submit"
                disabled={submitting}
                className="mt-5 h-11 w-full rounded-xl bg-gradient-to-r from-[#b8912f] via-[#f0d27c] to-[#b8912f] text-xs font-bold text-[#171105] shadow-[0_14px_36px_-14px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? t("player.deposit.submitting")
                  : isRedirectGateway
                    ? t("player.deposit.redirectSubmit")
                    : t("player.deposit.submit")}
              </button>

              <p className="mt-3 text-center text-[10px] leading-5 text-neutral-600">
                {payNoticeText}
              </p>
            </form>
          )}
        </div>

        <div className="border-t border-[#d4af37]/10 bg-[#060606] px-5 py-3">
          <p className="text-center text-[9px] uppercase tracking-[0.18em] text-neutral-700">
            {t("player.deposit.brandFooter", {
              brand: resolveBrandName(brandName),
            })}
          </p>
        </div>
      </section>
    </div>
  );
}
