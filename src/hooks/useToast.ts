import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 画面下部などに出す一時メッセージ（トースト）。
 * 連続して呼ばれたときは前のタイマーを取り消し、最後のメッセージが指定時間だけ表示される
 * （以前は前のタイマーが残り、新しいメッセージが途中で消えることがあった）。
 */
export function useToast(defaultDurationMs = 3500) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string, durationMs: number = defaultDurationMs) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToastMessage(message);
      timerRef.current = setTimeout(() => {
        setToastMessage(null);
        timerRef.current = null;
      }, durationMs);
    },
    [defaultDurationMs]
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { toastMessage, showToast };
}
