import { useCallback, useEffect, useRef, useState } from 'react';
import type { CDMetadata } from '../types/cd';
import { resolvePreviewToggle, type PreviewMode } from '../utils/searchPreviewMode';

interface Params {
  /** 現在の検索結果のCD（表示順） */
  candidates: CDMetadata[];
  /** 詳細モーダルで開いているCD */
  selectedCDForModal: CDMetadata | null;
}

/**
 * 検索結果の詳細表示方式（モーダル表示 ⇄ スプリット表示）と、スプリットの右プレビューに出すCD。
 * 切替の判断は utils/searchPreviewMode.ts（純粋関数・テスト済み）。ここでは状態を持つだけで、
 * 詳細モーダルは開閉しない（モーダルは結果のクリックなど明示的な操作でのみ開く）。
 */
export function useSearchPreviewMode({ candidates, selectedCDForModal }: Params) {
  // 検索を始めるたびに 'modal' から始める（保存はしない）
  const [searchPreviewMode, setSearchPreviewMode] = useState<PreviewMode>('modal');
  const [splitPreviewCD, setSplitPreviewCD] = useState<CDMetadata | null>(null);
  // 直近にフォーカスした（モーダルまたはスプリットで表示した）アルバムのID
  const lastViewedCDIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedCDForModal) lastViewedCDIdRef.current = selectedCDForModal.id;
  }, [selectedCDForModal]);
  useEffect(() => {
    if (splitPreviewCD) lastViewedCDIdRef.current = splitPreviewCD.id;
  }, [splitPreviewCD]);

  /** モーダル表示 ⇄ スプリット表示の切替 */
  const togglePreviewMode = useCallback(
    (mode: PreviewMode) => {
      const result = resolvePreviewToggle(mode, {
        candidateIds: candidates.map((c) => c.id),
        modalId: selectedCDForModal?.id,
        splitId: splitPreviewCD?.id,
        lastViewedId: lastViewedCDIdRef.current,
      });
      setSearchPreviewMode(result.mode);
      setSplitPreviewCD(candidates.find((c) => c.id === result.splitPreviewId) || null);
    },
    [candidates, selectedCDForModal, splitPreviewCD]
  );

  /** 新しい検索の開始時: モーダル表示に戻し、右プレビューと「直近に見たCD」を忘れる */
  const resetForNewSearch = useCallback(() => {
    setSearchPreviewMode('modal');
    setSplitPreviewCD(null);
    lastViewedCDIdRef.current = null;
  }, []);

  return { searchPreviewMode, splitPreviewCD, setSplitPreviewCD, togglePreviewMode, resetForNewSearch };
}
