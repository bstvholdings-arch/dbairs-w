import { providerBrand } from "@/lib/lobby-providers";

const SIZE_SPECS = {
  sm: {
    box: "h-9 w-9 rounded-xl",
    text: "text-[11px]",
    glow: "shadow-[0_8px_20px_-10px_rgba(0,0,0,0.9)]",
  },
  md: {
    box: "h-12 w-12 rounded-2xl",
    text: "text-sm",
    glow: "shadow-[0_12px_28px_-12px_rgba(0,0,0,0.95)]",
  },
  lg: {
    box: "h-20 w-20 rounded-3xl",
    text: "text-2xl",
    glow: "shadow-[0_24px_60px_-22px_rgba(0,0,0,1)]",
  },
  /** 品牌墙专用：卡片很大，Logo 也跟着分档放大 */
  showcase: {
    box: "h-14 w-14 rounded-2xl sm:h-16 sm:w-16 sm:rounded-[18px] lg:h-[72px] lg:w-[72px] lg:rounded-[20px]",
    text: "text-[18px] sm:text-xl lg:text-2xl",
    glow: "shadow-[0_18px_40px_-18px_rgba(0,0,0,0.95)]",
  },
} as const;

/**
 * 游戏商「Logo」：数据库里只有 name，没有素材，
 * 这里用品牌色渐变 + 缩写字母画一个通行的博彩聚合商标识（如 PG / SC）。
 */
export function ProviderBrandMark({
  name,
  size = "md",
  className = "",
}: {
  name: string;
  size?: keyof typeof SIZE_SPECS;
  className?: string;
}) {
  const brand = providerBrand(name);
  const spec = SIZE_SPECS[size];

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden ring-1 ring-inset ring-white/35 ${spec.box} ${spec.glow} ${className}`}
      style={{
        backgroundImage: `linear-gradient(148deg, ${brand.primary} 0%, ${brand.secondary} 72%, ${brand.base} 100%)`,
      }}
      aria-hidden="true"
    >
      <span className="absolute inset-0 bg-[radial-gradient(75%_55%_at_28%_8%,rgba(255,255,255,0.85),transparent_62%)] opacity-70" />
      <span className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(0deg,rgba(0,0,0,0.28),transparent)]" />
      <span
        className={`relative font-black leading-none tracking-tight ${spec.text}`}
        style={{ color: brand.base }}
      >
        {brand.initials}
      </span>
    </span>
  );
}
