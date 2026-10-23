import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  durationMs?: number;
  /** 例: 「元に戻す」ボタン */
  action?: ToastAction;
}

export interface ToastState {
  message: string;
  action?: ToastAction;
}

/**
 * 画面下部などに出す一時メッセージ（トースト）。操作ボタン（「元に戻す」など）を付けられる。
 * 連続して呼ばれたときは前のタイマーを取り消し、最後のメッセージが指定時間だけ表示される
 * （以前は前のタイマーが残り、新しいメッセージが途中で消えることがあった）。
 * showToast の第2引数は、表示時間（ミリ秒）または { durationMs, action }。
 */
export function useToast(defaultDurationMs = 3500) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const dismissToast = useCallback(() => {
    clearTimer();
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, options?: number | ToastOptions) => {
      const opts: ToastOptions = typeof options === 'number' ? { durationMs: options } : options || {};
      clearTimer();
      setToast({ message, action: opts.action });
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, opts.durationMs ?? defaultDurationMs);
    },
    [defaultDurationMs]
  );

  useEffect(() => clearTimer, []);

  return { toast, toastMessage: toast?.message ?? null, showToast, dismissToast };
}
