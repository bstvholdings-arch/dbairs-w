"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { PayoutMethodLogo } from "@/components/player/payout-method-logo";
import {
  PAYOUT_METHODS,
  findPayoutMethodByName,
  type PayoutMethod,
} from "@/lib/payout-methods";

/**
 * 「银行名称 / 支付方式」自定义下拉（替代原生 `<select>`）。
 *
 * 为什么不用原生 select：`<option>` 里不能放图片，而玩家必须靠 logo 才认得出
 * Maybank / CIMB / Touch 'n Go。这里用「按钮触发框 + 绝对定位面板」重写：
 * - 触发框：选中后显示对应 logo + 名称（未选中显示 placeholder，历史手输值显示黑金首字母）；
 * - 展开面板：每行左 logo、右名称，当前项打勾；面板自身可滚动（最多 16rem，手机上不顶满屏）；
 * - 关闭：点击面板外任意位置（全屏透明遮罩）/ Esc / 选中任意一项；
 * - 键盘：↑ ↓ 移动、Home / End 跳到首尾、Enter / Space 选中、Tab 关闭；
 * - 值仍然是「银行名称」纯文本，直接契合 `PlayerWithdrawalAccount.bankName` 与 `readBankName()`，
 *   **不新增字段、不改接口**；
 * - 玩家银行不在目录里时选最后一行「其他银行 / 手动输入」，由父组件换成文本输入框。
 */

type PayoutRow = { kind: "method"; method: PayoutMethod } | { kind: "custom" };

const TRIGGER_CLASS =
  "mt-1.5 flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-left text-sm text-neutral-100 outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:bg-white/[0.05] focus-visible:border-brand/60 focus-visible:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-brand/25";

export function PayoutMethodSelect({
  value,
  onChange,
  allowCustom = false,
  onSelectCustom,
  ariaLabel,
}: {
  /** 当前银行名称（自由文本；命中目录时下拉里会回填 logo + 名称并打勾） */
  value: string;
  onChange: (name: string) => void;
  /** 是否提供「其他银行 / 手动输入」出口（不提供 = 只能从目录里选） */
  allowCustom?: boolean;
  onSelectCustom?: () => void;
  ariaLabel: string;
}) {
  const { t } = useLanguage();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const selected = useMemo(() => findPayoutMethodByName(value), [value]);
  /** 命中目录以外的自有值（历史数据 / 手动输入）：触发框用首字母兜底，不留空。 */
  const pendingCustom = !selected && value.trim().length > 0;

  const rows = useMemo<PayoutRow[]>(() => {
    const list: PayoutRow[] = PAYOUT_METHODS.map((method) => ({
      kind: "method",
      method,
    }));

    if (allowCustom) {
      list.push({ kind: "custom" });
    }

    return list;
  }, [allowCustom]);

  const rowCount = rows.length;

  const openList = useCallback(() => {
    const index = PAYOUT_METHODS.findIndex((item) => item.id === selected?.id);
    setActiveIndex(index >= 0 ? index : 0);
    setOpen(true);
  }, [selected]);

  const closeList = useCallback((restoreFocus = false) => {
    setOpen(false);

    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const choose = useCallback(
    (row: PayoutRow) => {
      if (row.kind === "custom") {
        onSelectCustom?.();
      } else {
        onChange(row.method.name);
      }

      closeList(true);
    },
    [closeList, onChange, onSelectCustom],
  );

  // 展开后把焦点交给面板，键盘上下键才有落点（触发框仍然可用 Esc 收起）。
  useEffect(() => {
    if (open) {
      listRef.current?.focus();
    }
  }, [open]);

  // 当前高亮行始终留在可视区（目录项 + 自定义行，手机上靠它才看得到最后一行）。
  useEffect(() => {
    if (!open) {
      return;
    }

    listRef.current
      ?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function handleListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeList(true);
      return;
    }

    if (event.key === "Tab") {
      closeList();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + delta + rowCount) % rowCount);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(rowCount - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const row = rows[activeIndex];

      if (row) {
        choose(row);
      }
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openList();
          }
        }}
        className={TRIGGER_CLASS}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selected ? (
            <>
              <PayoutMethodLogo method={selected} />
              <span className="truncate">{selected.name}</span>
            </>
          ) : pendingCustom ? (
            <>
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-gradient-to-br from-brand-deep via-brand to-brand-soft text-[11px] font-black text-brand-ink ring-1 ring-white/[0.08]"
              >
                {value.trim().slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{value.trim()}</span>
            </>
          ) : (
            <span className="truncate text-neutral-600">
              {t("player.security.payoutMethodPlaceholder")}
            </span>
          )}
        </span>

        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={`h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <>
          {/* 点击空白处关闭：全屏透明遮罩，比 document 监听更稳（不会误吞同一次点击） */}
          <div
            aria-hidden="true"
            className="fixed inset-0 z-30"
            onClick={() => closeList()}
          />
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-activedescendant={`${listboxId}-row-${activeIndex}`}
            onKeyDown={handleListKeyDown}
            className="payout-select-panel absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-y-auto rounded-xl border border-white/[0.10] bg-[#0b0b0b]/[0.98] p-1 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] backdrop-blur-md"
          >
            {rows.map((row, index) => {
              const isActive = index === activeIndex;

              if (row.kind === "custom") {
                return (
                  <button
                    key="custom"
                    id={`${listboxId}-row-${index}`}
                    data-row-index={index}
                    type="button"
                    role="option"
                    aria-selected={false}
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(row)}
                    className={`mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-white/[0.06] px-2.5 py-2 text-left text-sm text-neutral-300 transition-colors ${
                      isActive ? "bg-white/[0.07]" : ""
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-white/[0.20] text-[13px] font-black text-neutral-400"
                    >
                      +
                    </span>
                    <span className="truncate">
                      {t("player.security.payoutMethodOther")}
                    </span>
                  </button>
                );
              }

              const isSelected = selected?.id === row.method.id;

              return (
                <button
                  key={row.method.id}
                  id={`${listboxId}-row-${index}`}
                  data-row-index={index}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(row)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    isSelected ? "text-brand-pale" : "text-neutral-200"
                  } ${isActive ? "bg-white/[0.07]" : ""}`}
                >
                  <PayoutMethodLogo method={row.method} />
                  <span className="min-w-0 flex-1 truncate">
                    {row.method.name}
                  </span>
                  {isSelected ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      className="h-3.5 w-3.5 shrink-0 text-brand"
                    >
                      <path
                        d="M4 12.5l5 5L20 6.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

