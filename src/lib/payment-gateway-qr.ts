/**
 * 法币静态收款二维码的共享校验。
 *
 * 这里不依赖 node:crypto / Prisma，后台表单与 API 都可以直接复用。
 * 支持两种来源：
 * 1. 远程 http/https 图片 URL；
 * 2. 后台上传图片后转成的 data:image/...;base64（当前为“模拟上传”，直接存库）。
 *
 * 出于安全与体积考虑，只允许 PNG / JPG / WebP / GIF，不接受 SVG。
 */
export const MAX_GATEWAY_QR_IMAGE_FILE_BYTES = 1_200_000;
export const MAX_GATEWAY_QR_IMAGE_DATA_URL_LENGTH = 1_800_000;
export const MAX_GATEWAY_QR_IMAGE_REMOTE_URL_LENGTH = 2048;

const DATA_IMAGE_PATTERN =
  /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function normalizeGatewayQrCodeImageUrl(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isInlineGatewayQrCodeImage(value: string) {
  return value.startsWith("data:image/");
}

export function validateGatewayQrCodeImageUrl(value: string) {
  if (!value) {
    return "";
  }

  if (value.startsWith("data:")) {
    if (value.length > MAX_GATEWAY_QR_IMAGE_DATA_URL_LENGTH) {
      return "二维码图片过大，请上传小于 1.2MB 的图片";
    }

    if (!DATA_IMAGE_PATTERN.test(value)) {
      return "图片 Data URL 格式不正确，仅支持 PNG / JPG / WebP / GIF";
    }

    return "";
  }

  if (value.length > MAX_GATEWAY_QR_IMAGE_REMOTE_URL_LENGTH) {
    return "二维码图片链接不能超过 2048 个字符";
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "二维码图片链接只支持 http / https";
    }
  } catch {
    return "二维码图片必须是有效的 http/https 链接，或直接上传图片";
  }

  return "";
}
