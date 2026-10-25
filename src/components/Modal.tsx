import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** ヘッダー左のアイコン（lucide のアイコンなど） */
  icon?: React.ReactNode;
  /** アイコンを囲む枠の色クラス（例: 'bg-emerald-600/20 border-emerald-500/40'） */
  iconBoxClassName?: string;
  onClose: () => void;
  /** カードの最大幅（既定 max-w-2xl） */
  widthClassName?: string;
  /** 背景クリックで閉じる（既定 true） */
  closeOnBackdrop?: boolean;
  children: React.ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 共通モーダル。画面中央のカード + 暗い背景（ぼかし）+ ヘッダー（アイコン・タイトル・説明・×）。
 * - Esc / 背景クリック / ×ボタンで閉じる
 * - 開いたらカードにフォーカスし、Tab キーはモーダル内で循環する。閉じたら元の要素にフォーカスを戻す
 * - role="dialog" と aria-labelledby でスクリーンリーダーに対応
 */
export const Modal: React.FC<ModalProps> = ({
  title,
  subtitle,
  icon,
  iconBoxClassName = 'bg-indigo-600/20 border-indigo-500/40',
  onClose,
  widthClassName = 'max-w-2xl',
  closeOnBackdrop = true,
  children,
}) => {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;
      const items: HTMLElement[] = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === cardRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={closeOnBackdrop ? () => onClose() : undefined}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`bg-slate-900 border border-slate-700/80 rounded-2xl w-full ${widthClassName} flex flex-col shadow-2xl overflow-hidden max-h-[90vh] outline-none`}
      >
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/50 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${iconBoxClassName}`}>
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-bold text-white leading-tight">
                {title}
              </h2>
              {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer flex-shrink-0"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
