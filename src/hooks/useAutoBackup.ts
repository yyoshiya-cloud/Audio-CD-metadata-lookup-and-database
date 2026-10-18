import { useEffect, useRef } from 'react';
import type { CDMetadata } from '../types/cd';
import { maybeRunAutoBackup } from '../lib/autoBackup';

const DEBOUNCE_MS = 20 * 1000; // データ変更後、操作が落ち着いてから確認
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 開いたままの場合の定期確認

export type AutoBackupNotice = { kind: 'success' | 'error' | 'needs-permission'; message: string };

/**
 * JSON自動バックアップを、条件を満たしたタイミングで実行する。
 *  - データが変わって20秒落ち着いたとき
 *  - 10分ごとの定期確認
 *  - タブが非表示になるとき（閉じる前に間に合わせる）
 * 実際に実行するかどうか（有効か・間隔・変更の有無）は maybeRunAutoBackup が判断する。
 */
export function useAutoBackup(
  cds: CDMetadata[],
  ready: boolean,
  onNotice: (notice: AutoBackupNotice) => void
) {
  const cdsRef = useRef(cds);
  const noticeRef = useRef(onNotice);
  const permissionNoticeShown = useRef(false);
  cdsRef.current = cds;
  noticeRef.current = onNotice;

  const run = useRef(async () => {
    try {
      const outcome = await maybeRunAutoBackup(cdsRef.current);
      if (outcome.status === 'ran') {
        const r = outcome.result;
        noticeRef.current({
          kind: r.ok ? 'success' : 'error',
          message: r.ok ? `自動バックアップを保存しました（${r.count}件）` : `自動バックアップに失敗しました: ${r.message}`,
        });
      } else if (outcome.status === 'needs-permission' && !permissionNoticeShown.current) {
        // 許可が必要な状態は、通知が繰り返されないよう1セッションに1回だけ知らせる
        permissionNoticeShown.current = true;
        noticeRef.current({ kind: 'needs-permission', message: `自動バックアップ: ${outcome.message}（「書き出し・読み込み」の隣の「自動バックアップ」から許可してください）` });
      }
    } catch (err) {
      console.error('Auto backup check failed:', err);
    }
  });

  // データが変わったとき
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => run.current(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [cds, ready]);

  // 定期確認 / タブが非表示になるとき
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => run.current(), CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') run.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready]);
}
