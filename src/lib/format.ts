const integerFormatter = new Intl.NumberFormat("en-US");
const amountFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function formatInteger(value: number) {
  return integerFormatter.format(value);
}

export function formatAmount(value: unknown) {
  return amountFormatter.format(toNumber(value));
}

export function formatPercent(value: unknown) {
  return `${(toNumber(value) * 100).toFixed(2)}%`;
}

export function formatPoint(value: unknown) {
  return toNumber(value).toFixed(4);
}

export function formatDate(
  value: Date | string,
  locale: "en-US" | "zh-CN" = "en-US",
) {
  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
