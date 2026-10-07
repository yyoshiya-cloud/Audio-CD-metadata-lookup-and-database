import React, { useState, useMemo } from 'react';
import { CDMetadata } from '../types/cd';
import {
  Sparkles,
  CheckCircle2,
  Disc,
  ArrowRight,
  RefreshCw,
  Copy,
} from 'lucide-react';

interface DuplicateCheckViewProps {
  cds: CDMetadata[];
  onMergeGroup: (primaryCD: CDMetadata, duplicateIdsToDelete: string[]) => Promise<void>;
  onMergeAllGroups: (mergeActions: { primaryCD: CDMetadata; duplicateIdsToDelete: string[] }[]) => Promise<void>;
  onNavigateToLibrary: () => void;
}

export interface DuplicateGroup {
  key: string;
  matchType: 'title_artist' | 'catalogNumber';
  normTitle: string;
  normArtist: string;
  items: CDMetadata[];
  proposedMerged: CDMetadata;
}

export const DuplicateCheckView: React.FC<DuplicateCheckViewProps> = ({
  cds,
  onMergeGroup,
  onMergeAllGroups,
  onNavigateToLibrary,
}) => {
  const [mergingKeys, setMergingKeys] = useState<Set<string>>(new Set());
  const [isMergingAll, setIsMergingAll] = useState(false);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);

  // Group CDs by title+artist or catalogNumber to detect duplicates
  const duplicateGroups = useMemo(() => {
    const map = new Map<string, CDMetadata[]>();

    cds.forEach((cd) => {
      // Key 1: Title + Artist normalized
      const cleanTitle = normalizeStr(cd.title);
      const cleanArtist = normalizeStr(cd.artist);
      const titleArtistKey = (cleanTitle && cleanArtist) ? `ta:${cleanTitle}__${cleanArtist}` : '';

      // Key 2: Catalog number normalized if available
      const cleanCat = normalizeCatNo(cd.catalogNumber);
      const catKey = cleanCat ? `cat:${cleanCat}` : '';

      const keyToUse = catKey || titleArtistKey;
      if (!keyToUse) return;

      if (!map.has(keyToUse)) {
        map.set(keyToUse, []);
      }
      map.get(keyToUse)!.push(cd);
    });

    const groups: DuplicateGroup[] = [];

    map.forEach((items, key) => {
      if (items.length >= 2) {
        const isCat = key.startsWith('cat:');
        const first = items[0];

        // Build proposed consolidated CD
        const coverUrl = items.find((i) => i.coverUrl)?.coverUrl || '';
        const catalogNumber = items.find((i) => i.catalogNumber)?.catalogNumber || first.catalogNumber || '';
        const title = items.find((i) => isJapanese(i.title))?.title || items.find((i) => i.title)?.title || first.title;
        const artist = items.find((i) => isJapanese(i.artist))?.artist || items.find((i) => i.artist)?.artist || first.artist;
        const label = items.find((i) => i.label)?.label || first.label || '';
        const releaseDate = items.find((i) => i.releaseDate)?.releaseDate || first.releaseDate || '';
        const barcode = items.find((i) => i.barcode)?.barcode || first.barcode || '';
        const tracks = items.find((i) => i.tracks && i.tracks.length > 0)?.tracks || first.tracks || [];

        // Combine unique tags
        const tagSet = new Set<string>();
        items.forEach((i) => (i.tags || []).forEach((t) => tagSet.add(t)));

        const proposedMerged: CDMetadata = {
          ...first,
          title,
          artist,
          catalogNumber,
          label,
          releaseDate,
          coverUrl,
          barcode,
          tracks,
          tags: Array.from(tagSet),
          syncedToSheets: items.some((i) => i.syncedToSheets),
          verifiedByAI: items.some((i) => i.verifiedByAI),
          aiVerificationSummary: `重複データ${items.length}件を1つに統合・名寄せ完了`,
          updatedAt: new Date().toISOString(),
        };

        groups.push({
          key,
          matchType: isCat ? 'catalogNumber' : 'title_artist',
          normTitle: normalizeStr(title),
          normArtist: normalizeStr(artist),
          items,
          proposedMerged,
        });
      }
    });

    return groups;
  }, [cds]);

  const handleMergeSingleGroup = async (group: DuplicateGroup) => {
    setMergingKeys((prev) => new Set(prev).add(group.key));
    try {
      const duplicateIdsToDelete = group.items.slice(1).map((i) => i.id);
      await onMergeGroup(group.proposedMerged, duplicateIdsToDelete);
      setCompletedMessage(`「${group.proposedMerged.title}」の重複${group.items.length}件を統合しました。`);
      setTimeout(() => setCompletedMessage(null), 3500);
    } catch (err) {
      console.error('Merge error:', err);
    } finally {
      setMergingKeys((prev) => {
        const next = new Set(prev);
        next.delete(group.key);
        return next;
      });
    }
  };

  const handleMergeAll = async () => {
    if (duplicateGroups.length === 0) return;
    setIsMergingAll(true);
    try {
      const actions = duplicateGroups.map((g) => ({
        primaryCD: g.proposedMerged,
        duplicateIdsToDelete: g.items.slice(1).map((i) => i.id),
      }));
      await onMergeAllGroups(actions);
      setCompletedMessage(`全 ${duplicateGroups.length} グループの重複CDを一括統合しました！`);
      setTimeout(() => setCompletedMessage(null), 4000);
    } catch (err) {
      console.error('Merge all error:', err);
    } finally {
      setIsMergingAll(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-amber-950/40 to-slate-900 p-5 sm:p-6 rounded-2xl border border-amber-500/30 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300">
              <Copy className="w-5 h-5 text-amber-400" />
            </span>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              重複CDデータの検出・自動統合提案（重複チェック）
            </h2>
            <span className="text-[10px] font-mono font-bold text-amber-200 bg-amber-950 px-2.5 py-0.5 rounded-full border border-amber-500/40">
              {duplicateGroups.length} グループ検出
            </span>
          </div>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            ライブラリ内の保存済みCDから、アーティスト名とタイトル（または規格品番）が完全一致する重複データを特定。最良の画像・曲順・メタデータを保持した統合案を表示します。
          </p>
        </div>

        {duplicateGroups.length > 0 && (
          <button
            type="button"
            disabled={isMergingAll}
            onClick={handleMergeAll}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/40 border border-amber-400/40 transition-all cursor-pointer flex-shrink-0 disabled:opacity-50"
          >
            {isMergingAll ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-amber-200" />
                <span>一括統合処理中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-amber-200" />
                <span>全 {duplicateGroups.length} グループを一括統合する</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Completion Toast Notification */}
      {completedMessage && (
        <div className="p-4 bg-emerald-950/80 border border-emerald-500/50 rounded-2xl text-emerald-200 text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span>{completedMessage}</span>
        </div>
      )}

      {/* No Duplicates Found State */}
      {duplicateGroups.length === 0 && (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-12 text-center text-slate-400 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">重複するCDデータは見つかりませんでした</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              データベース内のすべてのCDはユニーク（一意）に保たれています。
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateToLibrary}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-all"
          >
            <span>ライブラリ画面へ移動</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* List of Duplicate Groups */}
      <div className="space-y-6">
        {duplicateGroups.map((group, groupIdx) => {
          const isMerging = mergingKeys.has(group.key);

          return (
            <div
              key={group.key}
              className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl space-y-4 hover:border-amber-500/40 transition-colors relative overflow-hidden"
            >
              {/* Card Group Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-300 font-bold font-mono text-xs">
                    #{groupIdx + 1}
                  </span>
                  
                  <span className="text-xs font-bold text-amber-300 bg-amber-950/90 border border-amber-500/40 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    🎯 {group.matchType === 'catalogNumber' ? '型番完全一致（重複）' : 'タイトル＆アーティスト完全一致（重複）'}
                  </span>

                  <span className="text-xs font-mono font-bold text-slate-300 bg-slate-900 px-2.5 py-0.5 rounded-md border border-slate-700">
                    {group.items.length} 件の重腹レコード
                  </span>
                </div>

                <button
                  type="button"
                  disabled={isMerging}
                  onClick={() => handleMergeSingleGroup(group)}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white shadow-md shadow-amber-900/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isMerging ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>統合中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                      <span>この重複グループを統合する</span>
                    </>
                  )}
                </button>
              </div>

              {/* Proposed Merge Target Banner */}
              <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-3 text-xs text-indigo-200 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                  <span>
                    <strong className="text-white">AI推奨統合案:</strong> 最高解像度のジャケット画像・最新規格品番・完全なトラックリスト({group.proposedMerged.tracks.length}曲)を保持して1つに名寄せします。
                  </span>
                </div>
                {group.proposedMerged.catalogNumber && (
                  <span className="font-mono text-indigo-300 bg-indigo-900/80 px-2 py-0.5 rounded border border-indigo-500/40 text-[11px] font-bold">
                    統合後型番: {group.proposedMerged.catalogNumber}
                  </span>
                )}
              </div>

              {/* Side-by-Side Comparison Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.items.map((item, itemIdx) => {
                  const isPrimary = itemIdx === 0;

                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-xl border flex flex-col justify-between space-y-3 transition-all ${
                        isPrimary
                          ? 'bg-indigo-950/30 border-indigo-500/50 shadow-md'
                          : 'bg-slate-900/70 border-slate-700/80'
                      }`}
                    >
                      {/* Cover & Basic Info */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            isPrimary
                              ? 'bg-indigo-600 text-white border-indigo-400'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                            {isPrimary ? '統合保持レコード（メイン）' : `重複レコード #${itemIdx + 1}`}
                          </span>

                          <span className="text-[10px] text-slate-400 font-mono">
                            ID: {item.id.slice(0, 8)}...
                          </span>
                        </div>

                        <div className="flex gap-2.5 items-start">
                          {/* Sequential Index Number to the left of Jacket */}
                          <div className="font-mono text-xs font-bold text-amber-300 bg-slate-950 border border-slate-700/80 px-2 py-1 rounded-md text-center min-w-[28px] flex-shrink-0 mt-1 shadow-xs">
                            #{itemIdx + 1}
                          </div>

                          <div className="w-16 h-16 rounded-lg bg-slate-950 overflow-hidden border border-slate-700 flex-shrink-0 relative">
                            {item.coverUrl ? (
                              <img
                                src={item.coverUrl}
                                alt={item.title}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-600">
                                <Disc className="w-6 h-6" />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-mono font-bold text-amber-300 bg-amber-950/80 border border-amber-500/30 px-1.5 py-0.2 rounded block truncate mb-1">
                              {item.catalogNumber || '型番未判定'}
                            </span>

                            <h4 className="text-xs font-bold text-white truncate" title={item.title}>
                              {item.title}
                            </h4>

                            <p className="text-[11px] text-slate-300 truncate" title={item.artist}>
                              {item.artist}
                            </p>
                          </div>
                        </div>

                        {/* Metadata Details */}
                        <div className="space-y-1 text-[11px] text-slate-400 border-t border-slate-800 pt-2">
                          <div className="flex justify-between">
                            <span>レーベル:</span>
                            <span className="text-slate-200 truncate max-w-[120px] font-medium">{item.label || '-'}</span>
                          </div>

                          <div className="flex justify-between">
                            <span>発売年月日:</span>
                            <span className="text-slate-200 font-mono">{item.releaseDate || '-'}</span>
                          </div>

                          <div className="flex justify-between">
                            <span>収録曲数:</span>
                            <span className="text-indigo-300 font-semibold">{item.tracks ? item.tracks.length : 0} 曲</span>
                          </div>

                          <div className="flex justify-between">
                            <span>取得ソース:</span>
                            <span className="uppercase text-[10px] font-mono font-bold text-slate-300 bg-slate-800 px-1.5 py-0.2 rounded">
                              {item.source}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Action status */}
                      <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
                        <span>{isPrimary ? '✨ 統合後に残るレコード' : '🗑️ 統合後に削除されるレコード'}</span>
                        {item.syncedToSheets && (
                          <span className="text-emerald-400 font-bold">Sheets連携済</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function normalizeStr(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[‐－―ー\-\s_]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .trim();
}

function normalizeCatNo(cat?: string): string {
  if (!cat) return '';
  return cat
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function isJapanese(str?: string): boolean {
  if (!str) return false;
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str);
}
