"use client";

import { useId } from "react";

/**
 * 实时搜索框（三个表格页签共用）。
 *
 * 关键点：
 * - 受控组件，onChange 直接上抛，不做「回车后才搜索」；
 * - 不做本地 state 缓存，父组件的过滤结果因此永远和输入框同步；
 * - 带清空按钮，键盘 Esc 也能清空（不影响表单提交）。
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
  ariaLabel,
  large = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** 商户资料页签要求「大搜索框」，用 large 提高高度与字号。 */
  large?: boolean;
  className?: string;
}) {
  const inputId = useId();

  return (
    <div className={`relative block ${className}`}>
      <label htmlFor={inputId} className="sr-only">
        {ariaLabel}
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600 ${
          large ? "h-4 w-4" : "h-3.5 w-3.5"
        }`}
      >
        <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M13.2 13.2 17 17"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <input
        id={inputId}
        type="text"
        role="searchbox"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-white/10 bg-black/40 pl-9 pr-9 text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 ${
          large ? "h-12 text-sm" : "h-10 text-xs"
        }`}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={ariaLabel}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
