/**
 * 邮件通知服务。
 *
 * 当前阶段默认只「模拟发送」：把邮件完整内容打印到终端，方便本地联调，
 * 不会对真实用户发信。切换到真实通道只需配置环境变量：
 *
 *   MAIL_PROVIDER=console     默认。终端打印，不发任何网络请求。
 *   MAIL_PROVIDER=resend      RESEND_API_KEY + MAIL_FROM（纯 fetch 调用 Resend API，
 *                             不需要安装 SDK，因此不影响本地依赖）。
 *   MAIL_PROVIDER=nodemailer  预留位置：SMTP_HOST / SMTP_PORT / SMTP_USER /
 *                             SMTP_PASS / MAIL_FROM（见文件底部 TODO）。
 *
 * 统一约定：sendMail 永远不抛异常，失败时返回 { ok: false, error }。
 * 这样「发信失败」不会连带回滚已经创建好的租户 / 账号，
 * 超管仍然能在弹窗里看到一次性临时密码，手动发给商户。
 */

export type MailProvider = "console" | "resend" | "nodemailer";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type MailResult =
  | { ok: true; provider: MailProvider; messageId?: string }
  | { ok: false; provider: MailProvider; error: string };

/** 外部通道超时时间：邮件失败不应把接口拖死。 */
const MAIL_TIMEOUT_MS = 10_000;

/** 收件人格式（与 src/lib/tenant-admin-email.ts 保持同一口径）。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 站点根地址（邮件里的登录链接基址），默认本地开发地址。 */
export function appBaseUrl(): string {
  const raw =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  return raw.trim().replace(/\/+$/, "") || "http://localhost:3000";
}

/** 商户后台登录地址：与玩家前台（站点根）是两个独立入口。 */
export function tenantLoginUrl(): string {
  return `${appBaseUrl()}/tenant/login`;
}

function mailFrom(): string {
  return (
    process.env.MAIL_FROM?.trim() ||
    process.env.MAIL_FROM_EMAIL?.trim() ||
    "DBAIRS <no-reply@dbairs.local>"
  );
}

/** 读取当前生效的发信通道；配置不全时回退到 console 并打印警告。 */
export function currentMailProvider(): MailProvider {
  const raw = (process.env.MAIL_PROVIDER ?? "console").trim().toLowerCase();

  if (raw === "resend") {
    if (process.env.RESEND_API_KEY?.trim()) {
      return "resend";
    }

    console.warn(
      "[mailer] 已设置 MAIL_PROVIDER=resend，但缺少 RESEND_API_KEY，本次回退到终端打印。",
    );
    return "console";
  }

  if (raw === "nodemailer") {
    return "nodemailer";
  }

  if (raw !== "console" && raw !== "") {
    console.warn(
      `[mailer] 未知的 MAIL_PROVIDER="${raw}"，已回退到终端打印（console）。`,
    );
  }

  return "console";
}

/** 终端模拟发送：把收件人、主题、正文完整打印出来，方便直接复制凭据。 */
function printToConsole(message: MailMessage) {
  const line = "─".repeat(72);
  const body = message.text
    .split("\n")
    .map((row) => `│ ${row}`)
    .join("\n");

  console.log(
    [
      "",
      `┌${line}`,
      "│ 📧 模拟发送邮件（MAIL_PROVIDER=console，未真实投递）",
      `├${line}`,
      `│ 收件人: ${message.to}`,
      `│ 发件人: ${mailFrom()}`,
      `│ 主  题: ${message.subject}`,
      `├${line}`,
      body,
      `└${line}`,
      "",
    ].join("\n"),
  );
}

/** Resend 通道：官方 HTTP 接口，无需安装 SDK。 */
async function sendWithResend(
  message: MailMessage,
  apiKey: string,
): Promise<MailResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mailFrom(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        provider: "resend",
        error: `Resend 返回 ${response.status}${detail ? `：${detail.slice(0, 300)}` : ""}`,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      id?: unknown;
    };

    return {
      ok: true,
      provider: "resend",
      messageId: typeof payload.id === "string" ? payload.id : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "resend",
      error: error instanceof Error ? error.message : "Resend 请求失败",
    };
  }
}

/**
 * 预留的 Nodemailer 通道。
 *
 * 接入步骤（保持零依赖现状，需要时再装包）：
 *   1. npm i nodemailer，npm i -D @types/nodemailer
 *   2. 在这里用 nodemailer.createTransport({ host: SMTP_HOST, port, auth }) 发信；
 *   3. 环境变量：SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / MAIL_FROM。
 * 在那之前，本通道回退到终端打印并明确返回失败，避免误以为邮件已经发出。
 */
function sendWithNodemailer(message: MailMessage): MailResult {
  printToConsole(message);

  return {
    ok: false,
    provider: "nodemailer",
    error:
      "Nodemailer 通道尚未接入（见 src/lib/mailer.ts 的 TODO），已在终端打印邮件内容",
  };
}

/**
 * 发送一封邮件。永不抛异常。
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const to = message.to.trim();
  const provider = currentMailProvider();

  if (!EMAIL_PATTERN.test(to)) {
    return {
      ok: false,
      provider,
      error: `收件人邮箱不合法：${JSON.stringify(message.to)}`,
    };
  }

  try {
    if (provider === "resend") {
      return await sendWithResend(
        message,
        (process.env.RESEND_API_KEY ?? "").trim(),
      );
    }

    if (provider === "nodemailer") {
      return sendWithNodemailer(message);
    }

    printToConsole(message);
    return { ok: true, provider: "console" };
  } catch (error) {
    console.error("[mailer] 发送邮件失败:", error);
    return {
      ok: false,
      provider,
      error: error instanceof Error ? error.message : "发送邮件失败",
    };
  }
}

export type TenantAdminInviteInput = {
  /** 商户品牌名，用于邮件标题与正文。 */
  tenantName: string;
  /** 管理员邮箱（登录账号之一，也是收件人）。 */
  email: string;
  /** 系统生成的登录账号名（登录页也支持用它登录）。 */
  username?: string;
  /** 一次性初始密码明文（数据库只存 bcrypt 哈希）。 */
  password: string;
};

/**
 * 商户后台开通通知：登录地址 / 玩家前台 / 账号 / 初始密码 / 改密提醒。
 */
export function buildTenantAdminInviteEmail(
  input: TenantAdminInviteInput,
): MailMessage {
  const loginUrl = tenantLoginUrl();
  const playerUrl = appBaseUrl();
  const tenantName = input.tenantName.trim() || "您的品牌";

  const text = [
    "您好，",
    "",
    `「${tenantName}」的商户后台已开通，以下是您的登录信息：`,
    "",
    `您的商户后台登录地址：${loginUrl}`,
    `您的玩家前台网址：${playerUrl}`,
    "",
    `管理员账号（邮箱）：${input.email}`,
    ...(input.username ? [`登录账号（可选）：${input.username}`] : []),
    `初始密码：${input.password}`,
    "",
    "登录后请立即修改密码。",
    "",
    "—— DBAIRS 平台",
    "（本邮件由系统自动发送，请勿直接回复）",
  ].join("\n");

  return {
    to: input.email,
    subject: `【DBAIRS】「${tenantName}」商户后台已开通（含初始密码）`,
    text,
    html: buildInviteHtml({ loginUrl, playerUrl, tenantName, input }),
  };
}

/** 邮件 HTML 版（部分邮箱客户端会屏蔽纯文本里的链接，这里再给一份可点击的）。 */
function buildInviteHtml(params: {
  loginUrl: string;
  playerUrl: string;
  tenantName: string;
  input: TenantAdminInviteInput;
}): string {
  const { loginUrl, playerUrl, tenantName, input } = params;
  const gold = "#d4af37";

  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:24px;background:#050505;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#0a0a0a;border:1px solid rgba(212,175,55,0.25);border-radius:14px;">
      <tr>
        <td style="padding:24px 28px 8px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:${gold};">DBAIRS</p>
          <h1 style="margin:10px 0 0;font-size:20px;color:#f8f3e6;">「${escapeHtml(tenantName)}」商户后台已开通</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 0;font-size:13px;line-height:22px;color:#a3a3a3;">
          您的商户后台登录地址：<a href="${escapeHtml(loginUrl)}" style="color:${gold};">${escapeHtml(loginUrl)}</a><br />
          您的玩家前台网址：<a href="${escapeHtml(playerUrl)}" style="color:${gold};">${escapeHtml(playerUrl)}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid rgba(212,175,55,0.2);border-radius:10px;background:rgba(212,175,55,0.05);">
            <tr>
              <td style="padding:14px 16px;font-size:13px;line-height:24px;color:#e5e5e5;">
                管理员账号（邮箱）：<strong style="color:#fff;">${escapeHtml(input.email)}</strong><br />
                ${
                  input.username
                    ? `登录账号（可选）：<strong style="color:#fff;">${escapeHtml(input.username)}</strong><br />`
                    : ""
                }
                初始密码：<strong style="color:#fff;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(input.password)}</strong>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;line-height:22px;color:#f0d27c;">登录后请立即修改密码。</p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px 24px;">
          <p style="margin:0;font-size:11px;color:#525252;">—— DBAIRS 平台 · 本邮件由系统自动发送，请勿直接回复</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * 发送「商户后台已开通」通知。永不抛异常，便于在事务提交后安全调用。
 */
export async function sendTenantAdminInviteEmail(
  input: TenantAdminInviteInput,
): Promise<{ ok: boolean; error?: string }> {
  const result = await sendMail(buildTenantAdminInviteEmail(input));

  if (result.ok) {
    console.info(
      `[mailer] 商户开通邮件已处理: to=${input.email} provider=${result.provider}`,
    );
    return { ok: true };
  }

  console.error(
    `[mailer] 商户开通邮件发送失败: to=${input.email} error=${result.error}`,
  );

  return { ok: false, error: result.error };
}

export type TenantApiKeyEmailInput = {
  /** 商户品牌名，用于邮件标题与正文。 */
  tenantName: string;
  /** 收件人：商户对接邮箱（Tenant.contactEmail）。 */
  email: string;
  /** 商户专属 API Key 明文（本轮「发送至邮箱」需要把密钥交给商户本人）。 */
  apiKey: string;
  /** 平台充值回调地址。 */
  depositUrl: string;
  /** 平台出金回调地址。 */
  withdrawalUrl: string;
  /** 商户专属回调地址（可选，未配置时邮件里不出现该行）。 */
  callbackUrl?: string;
  /** 当前生效的全局 IP 白名单，方便商户在自己的防火墙里核对来源。 */
  ipWhitelist?: string[];
};

/**
 * API 接入资料邮件：商户专属密钥 + 回调地址 + IP 白名单。
 *
 * 与「开通邮件」不同，这封邮件可能被反复发送（超管改完邮箱再发一次），
 * 因此正文只带当前有效的密钥，不涉及任何一次性凭据。
 */
export function buildTenantApiKeyEmail(input: TenantApiKeyEmailInput): MailMessage {
  const tenantName = input.tenantName.trim() || "您的品牌";
  const ipList = (input.ipWhitelist ?? []).filter(Boolean);

  const text = [
    "您好，",
    "",
    `以下是「${tenantName}」的 API 对接资料，请妥善保管，不要转发到公开渠道：`,
    "",
    `商户专属 API Key：${input.apiKey}`,
    `充值回调地址：${input.depositUrl}`,
    `出金回调地址：${input.withdrawalUrl}`,
    ...(input.callbackUrl ? [`商户专属回调地址：${input.callbackUrl}`] : []),
    ...(ipList.length > 0
      ? [`IP 白名单：${ipList.join(", ")}`]
      : []),
    "",
    "如密钥泄漏，请立即在平台后台「API 与集成中心」重置，旧密钥会同时失效。",
    "",
    "—— DBAIRS 平台",
    "（本邮件由系统自动发送，请勿直接回复）",
  ].join("\n");

  return {
    to: input.email,
    subject: `【DBAIRS】「${tenantName}」API 对接资料（含专属密钥）`,
    text,
    html: buildApiKeyHtml({
      tenantName,
      apiKey: input.apiKey,
      depositUrl: input.depositUrl,
      withdrawalUrl: input.withdrawalUrl,
      callbackUrl: input.callbackUrl,
      ipList,
    }),
  };
}

function buildApiKeyHtml(params: {
  tenantName: string;
  apiKey: string;
  depositUrl: string;
  withdrawalUrl: string;
  callbackUrl?: string;
  ipList: string[];
}): string {
  const { tenantName, apiKey, depositUrl, withdrawalUrl, callbackUrl, ipList } =
    params;
  const gold = "#d4af37";
  const row = (label: string, value: string) =>
    `<div style="font-size:13px;line-height:24px;color:#a3a3a3;">${escapeHtml(
      label,
    )}：<strong style="color:#fff;font-family:ui-monospace,Menlo,monospace;word-break:break-all;">${escapeHtml(
      value,
    )}</strong></div>`;

  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:24px;background:#050505;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#0a0a0a;border:1px solid rgba(212,175,55,0.25);border-radius:14px;">
      <tr>
        <td style="padding:24px 28px 8px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:${gold};">DBAIRS</p>
          <h1 style="margin:10px 0 0;font-size:20px;color:#f8f3e6;">「${escapeHtml(tenantName)}」API 对接资料</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid rgba(212,175,55,0.2);border-radius:10px;background:rgba(212,175,55,0.05);">
            <tr>
              <td style="padding:14px 16px;">
                ${row("商户专属 API Key", apiKey)}
                ${row("充值回调地址", depositUrl)}
                ${row("出金回调地址", withdrawalUrl)}
                ${callbackUrl ? row("商户专属回调地址", callbackUrl) : ""}
                ${ipList.length > 0 ? row("IP 白名单", ipList.join(", ")) : ""}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;line-height:22px;color:#f0d27c;">如密钥泄漏，请立即在平台后台「API 与集成中心」重置，旧密钥会同时失效。</p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px 24px;">
          <p style="margin:0;font-size:11px;color:#525252;">—— DBAIRS 平台 · 本邮件由系统自动发送，请勿直接回复</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * 发送「API 对接资料」。永不抛异常，发信失败由调用方回 200 + emailSent=false。
 */
export async function sendTenantApiKeyEmail(
  input: TenantApiKeyEmailInput,
): Promise<{ ok: boolean; error?: string }> {
  const result = await sendMail(buildTenantApiKeyEmail(input));

  if (result.ok) {
    console.info(
      `[mailer] API 对接资料邮件已处理: to=${input.email} provider=${result.provider}`,
    );
    return { ok: true };
  }

  console.error(
    `[mailer] API 对接资料邮件发送失败: to=${input.email} error=${result.error}`,
  );

  return { ok: false, error: result.error };
}

function escapeHtml(value: string) {

  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


