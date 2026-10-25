/**
 * 検索結果の詳細表示方式（モーダル表示 / スプリット表示）の切替ロジック。
 *
 * 重要: ここで決めるのは「表示方式」と「右の即時プレビューに出すアルバム」だけ。
 * CD メタデータ詳細モーダルは、結果のクリックや「詳細を開く」など明示的な操作でしか開かない。
 * （表示方式の切替では絶対に開かない）
 */
export type PreviewMode = 'inline' | 'modal';

export interface PreviewToggleContext {
  /** 現在の検索結果の候補ID（表示順） */
  candidateIds: string[];
  /** 開いている詳細モーダルのアルバムID */
  modalId?: string | null;
  /** 右の即時プレビューに出ているアルバムID */
  splitId?: string | null;
  /** 直近にフォーカスしたアルバムID */
  lastViewedId?: string | null;
}

export interface PreviewToggleResult {
  mode: PreviewMode;
  /** 右の即時プレビューに出すアルバムID（モーダル表示なら null） */
  splitPreviewId: string | null;
}

export function resolvePreviewToggle(target: PreviewMode, ctx: PreviewToggleContext): PreviewToggleResult {
  if (target === 'modal') {
    // モーダル表示（一覧のみ）に戻す。右のプレビューは閉じる。
    return { mode: 'modal', splitPreviewId: null };
  }

  // スプリット表示へ: 現在フォーカスしているアルバムを右に出す
  const has = (id?: string | null) => (id && ctx.candidateIds.includes(id) ? id : null);
  const focused = has(ctx.modalId) || has(ctx.splitId) || has(ctx.lastViewedId) || ctx.candidateIds[0] || null;
  return { mode: 'inline', splitPreviewId: focused };
}
