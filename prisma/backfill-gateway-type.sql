-- 一次性回填：为升级到 gatewayType / currency 之前的旧网关补上支付形态与币种。
-- 执行顺序：先在部署环境运行 `npx prisma db push`，再执行本文件。
-- 注意：只应在升级时执行一次，之后不要覆盖后台已手工修改的配置。

UPDATE "PaymentGateway"
SET "gatewayType" = 'DYNAMIC_QR'
WHERE "providerType" IN ('usdt_trc20', 'usdt_erc20');

UPDATE "PaymentGateway"
SET "gatewayType" = 'STATIC_QR'
WHERE "qrCodeImageUrl" IS NOT NULL;

UPDATE "PaymentGateway"
SET "gatewayType" = 'BANK_TRANSFER'
WHERE "providerType" IN ('sepa', 'payid', 'swift', 'bank_transfer')
  AND "qrCodeImageUrl" IS NULL;

UPDATE "PaymentGateway"
SET "gatewayType" = 'REDIRECT_URL'
WHERE "providerType" NOT IN ('usdt_trc20', 'usdt_erc20', 'sepa', 'payid', 'swift', 'bank_transfer')
  AND "qrCodeImageUrl" IS NULL
  AND "endpoint" <> '';

UPDATE "PaymentGateway"
SET "currency" = 'USDT'
WHERE "providerType" IN ('usdt_trc20', 'usdt_erc20');

UPDATE "PaymentGateway"
SET "currency" = 'MYR'
WHERE "providerType" IN ('tng', 'duitnow');

-- 旧版本对所有法币静态码统一按 MYR 展示，未知法币网关保持 MYR，避免升级后金额币种突变。
UPDATE "PaymentGateway"
SET "currency" = 'MYR'
WHERE "providerType" NOT IN ('usdt_trc20', 'usdt_erc20', 'sepa', 'payid', 'swift', 'bank_transfer')
  AND "qrCodeImageUrl" IS NOT NULL;

UPDATE "PaymentGateway"
SET "currency" = 'EUR'
WHERE "providerType" = 'sepa';

UPDATE "PaymentGateway"
SET "currency" = 'AUD'
WHERE "providerType" = 'payid';

UPDATE "PaymentGateway"
SET "currency" = 'USD'
WHERE "providerType" IN ('swift', 'bank_transfer');
