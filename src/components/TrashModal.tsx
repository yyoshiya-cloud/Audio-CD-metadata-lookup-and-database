import React from 'react';
import { Trash2, RotateCcw } from 'lucide-react';
import type { CDMetadata } from '../types/cd';
import { Modal } from './Modal';
import { CoverImage, coverUrlsOf } from './CoverImage';
import { TRASH_RETENTION_DAYS, daysUntilPurge } from '../lib/trash';

interface TrashModalProps {
  trashedCDs: CDMetadata[];
  onClose: () => void;
  onRestore: (ids: string[]) => void | Promise<void>;
  /** 完全に削除する（元に戻せない） */
  onPurge: (ids: string[]) => void | Promise<void>;
}

const formatDate = (iso?: string) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** ゴミ箱: 削除したCDの復元・完全削除。保持期間（既定30日）を過ぎると自動で完全に削除される */
export const TrashModal: React.FC<TrashModalProps> = ({ trashedCDs, onClose, onRestore, onPurge }) => {
  const now = Date.now();
  const allIds = trashedCDs.map((c) => c.id);

  return (
    <Modal
      title="ゴミ箱"
      subtitle={`削除したCD（${trashedCDs.length}件）。${TRASH_RETENTION_DAYS}日たつと自動で完全に削除されます`}
      icon={<Trash2 className="w-6 h-6 text-rose-300" />}
      iconBoxClassName="bg-rose-600/20 border-rose-500/40"
      onClose={onClose}
    >
      <div className="p-6 space-y-3 overflow-y-auto">
        {trashedCDs.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">ゴミ箱は空です。</p>
        ) : (
          <>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => onRestore(allIds)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                すべて元に戻す
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`ゴミ箱の${trashedCDs.length}件を完全に削除します。この操作は元に戻せません。よろしいですか？`)) {
                    onPurge(allIds);
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-900/60 hover:bg-rose-800/70 text-rose-100 border border-rose-700/50 cursor-pointer"
              >
                ゴミ箱を空にする
              </button>
            </div>

            <div className="border border-slate-800 rounded-xl divide-y divide-slate-800 max-h-[55vh] overflow-y-auto">
              {trashedCDs.map((cd) => (
                <div key={cd.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border border-slate-700">
                    <CoverImage urls={coverUrlsOf(cd)} alt={cd.title} iconClassName="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white break-words">{cd.title}</p>
                    <p className="text-xs text-slate-300 break-words">{cd.artist}</p>
                    <p className="text-[10px] text-slate-500">
                      {cd.catalogNumber ? `${cd.catalogNumber} ・ ` : ''}削除: {formatDate(cd.deletedAt)} ・ あと{daysUntilPurge(cd, now)}日で完全に削除
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => onRestore([cd.id])}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      元に戻す
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`「${cd.title}」を完全に削除します。この操作は元に戻せません。よろしいですか？`)) {
                          onPurge([cd.id]);
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-rose-300 hover:bg-rose-950/60 cursor-pointer"
                    >
                      完全に削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
