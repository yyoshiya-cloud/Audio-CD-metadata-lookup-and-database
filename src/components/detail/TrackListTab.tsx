import React from 'react';
import { Music, Sparkles, Trash2 } from 'lucide-react';
import type { TrackInfo } from '../../types/cd';
import { formatToHankakuDuration, validateTrackDuration } from '../../utils/formatUtils';

interface TrackListTabProps {
  tracks: TrackInfo[];
  bulkTrackText: string;
  setBulkTrackText: (value: string) => void;
  showBulkPasteInput: boolean;
  setShowBulkPasteInput: (value: boolean) => void;
  trackDurationErrors: Record<number, string>;
  setTrackDurationErrors: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  setIsDirty: (value: boolean) => void;
  parseBulkTrackLines: (text: string) => TrackInfo[];
  onAddTrack: () => void;
  onUpdateTitle: (index: number, newTitle: string) => void;
  onUpdateDuration: (index: number, newDuration: string) => void;
  onRemoveTrack: (index: number) => void;
  onClearAll: () => void;
  onParseBulk: (mode: 'replace' | 'append') => void;
  onExportText: () => void;
  onConvertTracksToHalfWidth: () => void;
  onConvertBulkTextToHalfWidth: () => void;
  onNormalizeDurations: () => void;
}

/** 「トラックリスト」タブ: 収録曲の個別編集と、テキストでの一括登録 */
export const TrackListTab: React.FC<TrackListTabProps> = ({
  tracks,
  bulkTrackText,
  setBulkTrackText,
  showBulkPasteInput,
  setShowBulkPasteInput,
  trackDurationErrors,
  setTrackDurationErrors,
  setIsDirty,
  parseBulkTrackLines,
  onAddTrack: handleAddSingleTrack,
  onUpdateTitle: handleUpdateTrackTitle,
  onUpdateDuration: handleUpdateTrackDuration,
  onRemoveTrack: handleRemoveTrack,
  onClearAll: handleClearAllTracks,
  onParseBulk: handleParseBulkTracks,
  onExportText: handleExportTracksToText,
  onConvertTracksToHalfWidth: handleConvertTracksToHalfWidth,
  onConvertBulkTextToHalfWidth: handleConvertBulkTextToHalfWidth,
  onNormalizeDurations: handleNormalizeTrackDurations,
}) => {
  return (
      <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-hidden">
        
        {/* Track Action Header (Fixed above table) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 flex-shrink-0">
          <span className="text-xs font-bold text-slate-300">
            収録曲一覧 ({tracks.length}曲) — 1曲ずつ個別編集 または 改行テキストで一括登録
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {tracks.length > 0 && (
              <button
                type="button"
                onClick={handleNormalizeTrackDurations}
                className="px-2.5 py-1 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white border border-emerald-400/40 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                title="全トラックの演奏時間を MM:SS 形式に一括正規化"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                <span>時間を正規化</span>
              </button>
            )}

            {tracks.length > 0 && (
              <button
                type="button"
                onClick={handleConvertTracksToHalfWidth}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors cursor-pointer"
                title="曲名に含まれる全角英数・記号（Ａ-Ｚ, ０-９, ！）を半角ASCII文字(A-Z, 0-9, !)に一括変換"
              >
                <span>全角英数→半角ASCII一括変換</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (!showBulkPasteInput && tracks.length > 0 && !bulkTrackText) {
                  handleExportTracksToText();
                } else {
                  setShowBulkPasteInput(!showBulkPasteInput);
                }
              }}
              className="px-3 py-1 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Music className="w-3.5 h-3.5" />
              <span>曲名を一括登録・テキスト入力</span>
            </button>

            <button
              type="button"
              onClick={handleAddSingleTrack}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium cursor-pointer"
            >
              ＋ 1曲追加
            </button>

            {tracks.length > 0 && (
              <button
                type="button"
                onClick={handleClearAllTracks}
                className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-800 text-rose-200 border border-rose-700/60 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                title="トラックリストの曲名と時間をすべて削除します"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>全曲削除</span>
              </button>
            )}
          </div>
        </div>

        {/* Enhanced Bulk Paste & Mass Edit UI */}
        {showBulkPasteInput && (
          <div className="bg-slate-800/90 p-4 rounded-xl border border-indigo-500/50 space-y-3 shadow-xl flex-shrink-0 max-h-56 overflow-y-auto">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="block text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                <Music className="w-4 h-4 text-indigo-400" />
                <span>曲名一括登録（改行区切りで曲名を貼り付け・入力）</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleConvertBulkTextToHalfWidth}
                  disabled={!bulkTrackText.trim()}
                  className="text-[11px] px-2 py-0.5 rounded bg-slate-700 hover:bg-indigo-600 text-slate-200 hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
                  title="入力欄の全角英数・全角記号を半角ASCII文字に一括変換"
                >
                  全角英数→半角ASCII変換
                </button>

                <button
                  type="button"
                  onClick={() => setShowBulkPasteInput(false)}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  キャンセル
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              各行に曲名を入力してください。「1. 曲名」や「01 曲名 (04:15)」のようなトラック番号・時間表記も自動認識します。
            </p>

            <textarea
              value={bulkTrackText}
              onChange={(e) => setBulkTrackText(e.target.value)}
              rows={4}
              placeholder="1. 曲名1 (03:45)&#10;2. 曲名2 (04:12)&#10;3. 曲名3"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none"
            />

            <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
              <span className="text-[11px] text-slate-400 font-mono">
                検出曲数: {parseBulkTrackLines(bulkTrackText).length} 曲
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!bulkTrackText.trim()}
                  onClick={() => handleParseBulkTracks('append')}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold disabled:opacity-40 border border-slate-600 cursor-pointer"
                >
                  現在の曲の後に追加
                </button>

                <button
                  type="button"
                  disabled={!bulkTrackText.trim()}
                  onClick={() => handleParseBulkTracks('replace')}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow disabled:opacity-40 cursor-pointer"
                >
                  全曲置き換え一括登録
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dedicated Scrollable Track Table (Only this box scrolls) */}
        {tracks.length > 0 ? (
          <div className="flex-1 min-h-0 bg-slate-800/50 rounded-xl border border-slate-800 overflow-y-auto overflow-x-hidden shadow-inner">
            <table className="w-full text-left text-xs text-slate-300 relative border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-800 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-700 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3 w-12 text-center bg-slate-800 font-bold">#</th>
                  <th className="py-2.5 px-3 bg-slate-800 font-bold">曲名 (クリックして直接編集)</th>
                  <th className="py-2.5 px-3 w-28 text-center bg-slate-800 font-bold">MM:SS</th>
                  <th className="py-2.5 px-3 w-12 text-center bg-slate-800 font-bold">削除</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {tracks.map((tr, i) => (
                  <tr key={i} className="hover:bg-slate-800/80 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-400">
                      {tr.trackNumber}
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={tr.title}
                        onChange={(e) => handleUpdateTrackTitle(i, e.target.value)}
                        className="w-full bg-slate-900/80 border border-slate-700/80 focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none"
                      />
                    </td>
                    <td className="py-2 px-3 w-28">
                      <input
                        type="text"
                        inputMode="numeric"
                        data-duration-index={i}
                        value={tr.duration || ''}
                        placeholder="03:45"
                        style={{ imeMode: 'disabled' }}
                        onChange={(e) => {
                          setIsDirty(true);
                          const val = formatToHankakuDuration(e.target.value);
                          if (!val.trim()) {
                            handleUpdateTrackDuration(i, '');
                            setTrackDurationErrors((prev) => {
                              const next = { ...prev };
                              delete next[i];
                              return next;
                            });
                            return;
                          }
                          if (/^\d{4}$/.test(val)) {
                            const check = validateTrackDuration(val);
                            if (check.valid) {
                              handleUpdateTrackDuration(i, check.normalized);
                              setTrackDurationErrors((prev) => {
                                const next = { ...prev };
                                delete next[i];
                                return next;
                              });
                            } else {
                              handleUpdateTrackDuration(i, val);
                              setTrackDurationErrors((prev) => ({
                                ...prev,
                                [i]: check.error || 'ありえない時間です',
                              }));
                            }
                          } else {
                            handleUpdateTrackDuration(i, val);
                          }
                        }}
                        onBlur={(e) => {
                          const rawVal = e.target.value.trim();
                          if (!rawVal) {
                            setTrackDurationErrors((prev) => {
                              const next = { ...prev };
                              delete next[i];
                              return next;
                            });
                            return;
                          }
                          const check = validateTrackDuration(rawVal);
                          if (check.valid) {
                            handleUpdateTrackDuration(i, check.normalized);
                            setTrackDurationErrors((prev) => {
                              const next = { ...prev };
                              delete next[i];
                              return next;
                            });
                          } else {
                            setTrackDurationErrors((prev) => ({
                              ...prev,
                              [i]: check.error || 'ありえない時間です',
                            }));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const rawVal = ((e.target as HTMLInputElement).value || tr.duration || '').trim();
                            if (rawVal) {
                              const check = validateTrackDuration(rawVal);
                              if (check.valid) {
                                handleUpdateTrackDuration(i, check.normalized);
                                setTrackDurationErrors((prev) => {
                                  const next = { ...prev };
                                  delete next[i];
                                  return next;
                                });
                              } else {
                                setTrackDurationErrors((prev) => ({
                                  ...prev,
                                  [i]: check.error || 'ありえない時間です',
                                }));
                                return;
                              }
                            }
                            const nextInput = document.querySelector<HTMLInputElement>(
                              `input[data-duration-index="${i + 1}"]`
                            );
                            if (nextInput) {
                              nextInput.focus();
                              nextInput.select();
                            } else {
                              (e.target as HTMLInputElement).blur();
                            }
                          }
                        }}
                        className={`w-full border rounded px-2 py-1.5 text-xs font-mono text-center placeholder-slate-600 focus:outline-none ${
                          trackDurationErrors[i]
                            ? 'bg-rose-950/40 border-rose-500 text-rose-200 focus:border-rose-400'
                            : 'bg-slate-900/80 border-slate-700/80 text-slate-200 focus:border-indigo-500'
                        }`}
                        title={trackDurationErrors[i] || '演奏時間（60分以内・00〜59秒 / 例: 0100 → 01:00, 03:45）'}
                      />
                      {trackDurationErrors[i] && (
                        <p className="mt-0.5 text-[10px] font-bold text-rose-400 leading-tight">
                          {trackDurationErrors[i]}
                        </p>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveTrack(i)}
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors rounded hover:bg-slate-800 cursor-pointer"
                        title="曲を削除"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-800/30 rounded-xl p-8 text-center text-slate-400 text-xs border border-slate-800 space-y-3">
            <p>収録曲情報がありません。</p>
            <button
              type="button"
              onClick={() => setShowBulkPasteInput(true)}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs cursor-pointer"
            >
              曲名をテキストで一括入力する
            </button>
          </div>
        )}
      </div>
  );
};
