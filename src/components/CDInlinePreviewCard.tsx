import React from 'react';
import { CDMetadata } from '../types/cd';
import { Disc, Music, Calendar, Tag, Plus, Check, Edit3, X, Sparkles, ExternalLink, ShieldCheck } from 'lucide-react';

interface CDInlinePreviewCardProps {
  cd: CDMetadata;
  isSaved: boolean;
  onSaveToDB: (cd: CDMetadata) => void;
  onOpenFullDetail: (cd: CDMetadata) => void;
  onClose: () => void;
}

export const CDInlinePreviewCard: React.FC<CDInlinePreviewCardProps> = ({
  cd,
  isSaved,
  onSaveToDB,
  onOpenFullDetail,
  onClose,
}) => {
  return (
    <div className="bg-slate-900 border border-indigo-500/50 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4 animate-in fade-in slide-in-from-right-3 duration-200 sticky top-[76px] max-h-[calc(100vh-100px)] overflow-y-auto">
      
      {/* Header with Title and Close Button */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 flex-shrink-0">
            <Disc className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">
              即時プレビュー
            </span>
            <h3 className="text-sm font-bold text-white break-words line-clamp-2 leading-snug" title={cd.title}>
              {cd.title}
            </h3>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          title="プレビューを閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Info Strip: Cover Jacket & Meta */}
      <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
        {/* Cover Art */}
        <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-xl bg-slate-950 overflow-hidden border border-slate-700/80 shadow-lg flex-shrink-0 flex items-center justify-center relative group">
          {cd.coverUrl ? (
            <img
              src={cd.coverUrl}
              alt={cd.title}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.dataset.triedProxy && cd.coverUrl && !cd.coverUrl.startsWith('data:')) {
                  target.dataset.triedProxy = 'true';
                  target.src = `/api/image-proxy?url=${encodeURIComponent(cd.coverUrl)}`;
                } else {
                  target.style.display = 'none';
                }
              }}
            />
          ) : (
            <Disc className="w-10 h-10 text-slate-700" />
          )}
          {cd.source && (
            <span className="absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/80 text-indigo-300 border border-indigo-500/40">
              {cd.source}
            </span>
          )}
        </div>

        {/* Text Metadata */}
        <div className="flex-1 space-y-2 text-xs w-full min-w-0">
          <div>
            <span className="text-[10px] text-slate-400 block">アーティスト</span>
            <p className="font-extrabold text-white text-sm sm:text-base leading-tight break-words">
              {cd.artist || '不明なアーティスト'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-800/60 p-2 rounded-lg border border-slate-700/60">
              <span className="text-[10px] text-slate-400 block font-mono">型番 (Cat No.)</span>
              <span className="font-mono font-bold text-indigo-300 text-xs break-all">
                {cd.catalogNumber || '-'}
              </span>
            </div>

            <div className="bg-slate-800/60 p-2 rounded-lg border border-slate-700/60">
              <span className="text-[10px] text-slate-400 block font-mono">発売日</span>
              <span className="font-mono text-slate-200 text-xs">
                {cd.releaseDate || '-'}
              </span>
            </div>
          </div>

          {cd.label && (
            <div className="text-[11px] text-slate-300 break-words">
              <span className="text-slate-400">レーベル: </span>
              <span>{cd.label}</span>
            </div>
          )}

          {cd.barcode && (
            <div className="text-[11px] text-slate-400 font-mono break-all">
              <span>JAN/バーコード: </span>
              <span className="text-slate-300">{cd.barcode}</span>
            </div>
          )}

          {cd.genre && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                {cd.genre}
              </span>
              {cd.tags && cd.tags.slice(0, 3).map((t, idx) => (
                <span key={idx} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons: Save directly or Full Modal */}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
        <button
          type="button"
          onClick={() => onSaveToDB(cd)}
          disabled={isSaved}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl font-bold text-xs transition-all shadow-md cursor-pointer ${
            isSaved
              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 cursor-default'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30 border border-emerald-500/40'
          }`}
        >
          {isSaved ? (
            <>
              <Check className="w-4 h-4 text-emerald-400" />
              <span>ライブラリ保存済み</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              <span>ライブラリに追加保存</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => onOpenFullDetail(cd)}
          className="flex items-center gap-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md border border-indigo-400/40 cursor-pointer"
          title="すべての項目を詳細編集モーダルで開く"
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>詳細編集</span>
        </button>
      </div>

      {/* Tracklist Section */}
      <div className="space-y-2 border-t border-slate-800 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-300 flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-indigo-400" />
            <span>収録曲リスト ({cd.tracks ? cd.tracks.length : 0}曲)</span>
          </span>
          {cd.tracks && cd.tracks.length > 0 && (
            <span className="text-[10px] text-slate-500 font-mono">
              全{cd.tracks.length}曲
            </span>
          )}
        </div>

        {cd.tracks && cd.tracks.length > 0 ? (
          <div className="bg-slate-950/70 rounded-xl border border-slate-800 divide-y divide-slate-800/60 max-h-56 overflow-y-auto text-xs font-mono">
            {cd.tracks.map((t) => (
              <div key={t.trackNumber} className="flex items-center justify-between p-2 px-3 hover:bg-slate-900/60 transition-colors">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="text-slate-500 w-5 text-right font-bold text-[11px]">
                    {t.trackNumber}.
                  </span>
                  <span className="text-slate-200 truncate font-sans text-xs">
                    {t.title}
                  </span>
                </div>
                {t.duration && (
                  <span className="text-slate-400 text-[10px] whitespace-nowrap">
                    {t.duration}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800 text-center text-xs text-slate-500">
            トラック情報はまだ取得されていません
          </div>
        )}
      </div>

      {/* Notes / Remarks if any */}
      {cd.notes && (
        <div className="bg-slate-800/40 p-2.5 rounded-xl border border-slate-700/50 text-[11px] text-slate-300">
          <span className="text-slate-400 font-bold block text-[10px] mb-0.5">備考・解説</span>
          <p className="line-clamp-3">{cd.notes}</p>
        </div>
      )}
    </div>
  );
};
