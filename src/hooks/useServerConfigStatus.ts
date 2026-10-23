import { useEffect, useState } from 'react';
import type { ConfigStatus } from '../types/config';

/**
 * サーバーの環境変数で設定済みのAPIキーの有無を取得する（真偽値のみ。キーの値は取得しない）。
 * 取得できない場合（オフライン・古いサーバー等）は null。
 */
export function useServerConfigStatus(): ConfigStatus | null {
  const [status, setStatus] = useState<ConfigStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config-status')
      .then((res) => (res.ok ? (res.json() as Promise<ConfigStatus>) : null))
      .then((json) => {
        if (!cancelled && json) setStatus(json);
      })
      .catch(() => {
        // 取得できなくても画面は使える
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
