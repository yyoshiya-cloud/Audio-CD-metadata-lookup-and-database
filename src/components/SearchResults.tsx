import React, { useState } from 'react';
import { CDMetadata, SearchResponse, APISource } from '../types/cd';
import { Music, Calendar, Disc, Check, Plus, ExternalLink, ShieldCheck, Layers, Layers2, Sparkles, Trash2, XCircle, ChevronDown, ChevronUp, ListMusic } from 'lucide-react';

interface SearchResultsProps {
  searchResponse: SearchResponse | null;
  isLoading: boolean;
  onSelectCD: (cd: CDMetadata, candidatesList?: CDMetadata[]) => void;
  onSaveToDB: (cd: CDMetadata) => void;
  savedCDIds: string[];
  onClearResults?: () => void;
  onManualAdd?: () => void;
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  searchResponse,
  isLoading,
  onSelectCD,
  onSaveToDB,
  savedCDIds,
  onClearResults,
  onManualAdd,
}) => {
  const [viewMode, setViewMode] = useState<'aggregated' | 'rawBySource'>('aggregated');
  const [expandedPreviewKeys, setExpandedPreviewKeys] = useState<Record<string, boolean>>({});

  const togglePreview = (key: string) => {
    setExpandedPreviewKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };
  
  const searchedSourcesList = React.useMemo(() => {
    if (searchResponse?.searchedSources && searchResponse.searchedSources.length > 0) {
      return searchResponse.searchedSources;
    }
    return ['musicbrainz', 'discogs', 'itunes', 'ndl', 'spotify', 'rakuten'] as APISource[];
  }, [searchResponse]);

  const [selectedRawSource, setSelectedRawSource] = useState<APISource>(searchedSourcesList[0] || 'musicbrainz');

  // Update active source tab when new search completes
  React.useEffect(() => {
    if (searchResponse?.sourceResults) {
      // Find first searched source that has items
      const withItems = searchedSourcesList.find(
        (src) => (searchResponse.sourceResults[src]?.items?.length || 0) > 0
      );
      if (withItems) {
        setSelectedRawSource(withItems);
      } else if (!searchedSourcesList.includes(selectedRawSource)) {
        setSelectedRawSource(searchedSourcesList[0] || 'musicbrainz');
      }
    }
  }, [searchResponse, searchedSourcesList]);

  if (isLoading) {
    return (
      <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 p-12 text-center">
        <div className="relative w-16 h-16 mx-auto mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20 animate-ping" />
          <div className="w-16 h-16 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin flex items-center justify-center">
            <Disc className="w-8 h-8 text-indigo-400" />
          </div>
        </div>
        <h3 className="text-lg font-semibold text-white">チェックされたAPIからメタデータを並列取得中...</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          選択されたAPI（MusicBrainz, Discogs, iTunes, 国会図書館NDL, 楽天ブックス, Spotify等）のみを横断検索し照合しています
        </p>
      </div>
    );
  }

  if (!searchResponse) {
    return (
      <div className="bg-slate-800/40 rounded-2xl border border-slate-700/60 p-8 sm:p-10 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-indigo-950/80 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400 shadow-inner">
          <Disc className="w-7 h-7 opacity-80" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-200">
            検索結果がここに表示されます
          </h3>
          <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
            左ペインで<strong>型番（規格品番）</strong>、<strong>タイトル</strong>、<strong>アーティスト名</strong>、<strong>曲名</strong>、<strong>JAN/EANコード</strong>を入力して検索を実行してください。<br />
            「背表紙・帯の写真からAI解析」による画像自動入力にも対応しています。
          </p>
        </div>

        {onManualAdd && (
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onManualAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>手動で新規CD登録</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  const { candidates, sourceResults, searchTimeMs } = searchResponse;

  if (candidates.length === 0) {
    return (
      <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 p-8 text-center space-y-4">
        <Disc className="w-12 h-12 text-slate-500 mx-auto" />
        <div>
          <h3 className="text-base font-semibold text-slate-200">
            選択した{searchedSourcesList.length}件のAPIで検索結果が見つかりませんでした
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            型番やキーワードを変更して再試行するか、同時検索対象APIにチェックを追加して再検索できます。
          </p>
        </div>

        {onManualAdd && (
          <div className="pt-2">
            <button
              type="button"
              onClick={onManualAdd}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>新規CD登録</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      
      {/* Search Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/60">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-sm font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            検索結果 ({candidates.length} 件の候補)
          </span>
          {candidates.some((c) => c.isExactMatch) && (
            <span className="text-[10px] font-bold text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded-full border border-amber-500/40 flex items-center gap-1">
              🎯 完全一致優先
            </span>
          )}
          {candidates.some((c) => c.verifiedByAI) && (
            <span className="text-[10px] font-bold text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded-full border border-purple-500/40 flex items-center gap-1">
              ✨ Gemini統合・検証済
            </span>
          )}
          <span className="text-[11px] text-slate-400 bg-slate-900/60 px-2 py-0.5 rounded-full border border-slate-700/80 font-mono">
            {searchTimeMs} ms
          </span>
        </div>

        {/* View mode toggle & Clear button */}
        <div className="flex items-center gap-2">
          {onClearResults && (
            <button
              type="button"
              onClick={onClearResults}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/80 hover:bg-rose-600/80 hover:border-rose-500/50 border border-slate-700/80 transition-colors"
              title="表示中の検索結果を消去"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-white" />
              <span>結果を消去</span>
            </button>
          )}

          <div className="flex items-center p-1 bg-slate-900/80 rounded-lg border border-slate-700/80 text-xs">
            <button
              onClick={() => setViewMode('aggregated')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                viewMode === 'aggregated' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              統合ベストマッチ
            </button>
            <button
              onClick={() => setViewMode('rawBySource')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                viewMode === 'rawBySource' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers2 className="w-3.5 h-3.5" />
              API別データ比較
            </button>
          </div>
        </div>
      </div>

      {/* Mode 1: Aggregated Best Match View (3 Columns on Large Screens) */}
      {viewMode === 'aggregated' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {candidates.map((cand, idx) => {
            const cd = cand.cd;
            const isSaved = savedCDIds.includes(cd.id);

            return (
              <div
                key={idx}
                className="bg-slate-800/90 hover:bg-slate-800 rounded-2xl border border-slate-700/80 p-4 transition-all hover:border-indigo-500/50 flex flex-col justify-between shadow-lg relative group"
              >
                <div>
                  <div className="flex gap-3">
                    {/* Sequential index number to the left of Jacket */}
                    <div className="flex-shrink-0 font-mono text-xs font-bold text-indigo-300 bg-slate-900 border border-slate-700/80 px-2 py-1 rounded-md text-center min-w-[32px] h-fit mt-1 shadow-sm">
                      #{idx + 1}
                    </div>

                    {/* Artwork image */}
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-slate-900 overflow-hidden flex-shrink-0 border border-slate-700/80 shadow-md relative group-hover:scale-[1.02] transition-transform">
                      {cd.coverUrl ? (
                        <img
                          src={cd.coverUrl}
                          alt={cd.title}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          loading="lazy"
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
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-2 text-center">
                          <Disc className="w-8 h-8 mb-1 opacity-50" />
                          <span className="text-[10px]">No Artwork</span>
                        </div>
                      )}
                    </div>

                    {/* Meta information */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5 flex-wrap mb-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {cd.catalogNumber ? (
                            <span className="text-xs font-mono font-bold text-indigo-300 bg-indigo-950/80 border border-indigo-500/40 px-2 py-0.5 rounded-md">
                              型番: {cd.catalogNumber}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">型番未判定</span>
                          )}

                          {cand.isExactMatch && (
                            <span className="text-[10px] font-bold text-amber-300 bg-amber-950/90 border border-amber-500/50 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm whitespace-nowrap">
                              🎯 {cand.exactMatchTypes?.includes('barcode') && cand.exactMatchTypes?.includes('catalogNumber')
                                ? '型番・JAN完全一致'
                                : cand.exactMatchTypes?.includes('barcode')
                                ? 'JANコード完全一致'
                                : cand.exactMatchTypes?.includes('catalogNumber') && cand.exactMatchTypes?.includes('title')
                                ? 'タイトル・型番完全一致'
                                : cand.exactMatchTypes?.includes('catalogNumber')
                                ? '型番完全一致'
                                : 'タイトル完全一致'}
                            </span>
                          )}

                          {(cand.verifiedByAI || cd.verifiedByAI) && (
                            <span className="text-[10px] font-bold text-purple-300 bg-purple-950/90 border border-purple-500/40 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                              <Sparkles className="w-2.5 h-2.5 text-purple-300" />
                              Gemini検証済
                            </span>
                          )}
                        </div>

                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-emerald-400" />
                          一致率 {cand.matchScore}%
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-white leading-tight truncate hover:text-indigo-300 transition-colors cursor-pointer" onClick={() => onSelectCD(cd, candidates.map((c) => c.cd))}>
                        {cd.title}
                      </h3>

                      <p className="text-sm font-medium text-slate-300 truncate mt-0.5">
                        {cd.artist}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-2">
                        {cd.label && (
                          <span className="truncate max-w-[150px]">🏷️ {cd.label}</span>
                        )}
                        {cd.releaseDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            {cd.releaseDate}
                          </span>
                        )}
                        {cd.tracks && cd.tracks.length > 0 && (
                          <span className="flex items-center gap-1 text-indigo-400">
                            <Music className="w-3 h-3" />
                            {cd.tracks.length} 曲収録
                          </span>
                        )}
                      </div>

                      {/* Source Badges matched */}
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <span className="text-[10px] text-slate-400">統合元:</span>
                        {cand.sourcesMatched.map((src) => (
                          <span
                            key={src}
                            className="text-[10px] font-semibold px-1.5 py-0.2 rounded uppercase bg-slate-900 text-slate-300 border border-slate-700"
                          >
                            {src === 'ndl' ? 'NDL' : src === 'musicbrainz' ? 'MB' : src}
                          </span>
                        ))}
                      </div>

                      {/* AI Verification Summary note */}
                      {(cand.aiVerificationSummary || cd.aiVerificationSummary) && (
                        <div className="bg-purple-950/30 border border-purple-800/40 rounded-lg p-2 text-[11px] text-purple-200 mt-2.5 flex items-start gap-1.5 leading-snug">
                          <Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                          <span>{cand.aiVerificationSummary || cd.aiVerificationSummary}</span>
                        </div>
                      )}

                    </div>
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="flex items-center justify-between flex-wrap gap-2 border-t border-slate-700/60 pt-3 mt-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => togglePreview(`agg_${idx}_${cd.id}`)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                        expandedPreviewKeys[`agg_${idx}_${cd.id}`]
                          ? 'bg-indigo-950/90 text-indigo-200 border-indigo-500/60 shadow-sm'
                          : 'bg-slate-900/80 hover:bg-slate-700/80 text-slate-200 border-slate-700'
                      }`}
                    >
                      <ListMusic className="w-3.5 h-3.5 text-indigo-400" />
                      <span>詳細をプレビュー</span>
                      {cd.tracks && cd.tracks.length > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-800 text-indigo-300 border border-slate-700">
                          {cd.tracks.length}曲
                        </span>
                      )}
                      {expandedPreviewKeys[`agg_${idx}_${cd.id}`] ? (
                        <ChevronUp className="w-3.5 h-3.5 text-indigo-300" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectCD(cd, candidates.map((c) => c.cd))}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 px-2 py-1 cursor-pointer"
                    >
                      曲順・詳細ソース比較 ➔
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isSaved}
                    onClick={() => onSaveToDB(cd)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      isSaved
                        ? 'bg-slate-700/60 text-emerald-400 border border-emerald-500/30'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                    }`}
                  >
                    {isSaved ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        保存済み
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        ライブラリに保存
                      </>
                    )}
                  </button>
                </div>

                {/* Slide-down Tracklist & Detail Preview */}
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    expandedPreviewKeys[`agg_${idx}_${cd.id}`]
                      ? 'grid-rows-[1fr] opacity-100 mt-3'
                      : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 space-y-2.5 shadow-inner">
                      <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2 text-[11px] text-slate-400">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-bold text-indigo-300 flex items-center gap-1">
                            <Music className="w-3.5 h-3.5" />
                            収録トラック一覧 ({cd.tracks?.length || 0}曲)
                          </span>
                          {cd.barcode && (
                            <span className="font-mono text-slate-300">JAN: {cd.barcode}</span>
                          )}
                          {cd.format && (
                            <span>フォーマット: {cd.format}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectCD(cd, candidates.map((c) => c.cd))}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                        >
                          モーダルで詳細編集 ➔
                        </button>
                      </div>

                      {cd.tracks && cd.tracks.length > 0 ? (
                        <div className="max-h-56 overflow-y-auto pr-1 divide-y divide-slate-800/70">
                          {cd.tracks.map((tr, tIdx) => (
                            <div
                              key={tIdx}
                              className="py-1.5 px-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-800/60 rounded transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="font-mono text-[11px] text-slate-500 w-6 text-right flex-shrink-0">
                                  {tr.trackNumber || tIdx + 1}.
                                </span>
                                <span className="text-slate-200 truncate font-medium">
                                  {tr.title}
                                </span>
                              </div>
                              {tr.duration && (
                                <span className="font-mono text-[11px] text-slate-400 flex-shrink-0">
                                  {tr.duration}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="py-4 text-center text-xs text-slate-400 space-y-1.5">
                          <p>この候補にはトラックリスト情報がまだ含まれていません。</p>
                          <button
                            type="button"
                            onClick={() => onSelectCD(cd, candidates.map((c) => c.cd))}
                            className="text-indigo-400 hover:underline font-medium cursor-pointer"
                          >
                            詳細モーダルを開いて曲名を登録・編集する
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Mode 2: Raw API Comparison View */}
      {viewMode === 'rawBySource' && (
        <div className="space-y-4">
          {/* Source Select Tabs */}
          <div className="flex flex-wrap gap-2">
            {searchedSourcesList.map((src) => {
              const res = sourceResults[src];
              const count = res?.count || 0;
              const isSelected = selectedRawSource === src;

              const srcNames: Record<APISource, string> = {
                musicbrainz: 'MusicBrainz',
                discogs: 'Discogs',
                itunes: 'iTunes Search',
                ndl: '国立国会図書館 (NDL)',
                spotify: 'Spotify API',
                rakuten: '楽天ブックス CD',
                vgmdb: 'VGMdb',
                yahoo: 'Yahoo! ショッピング',
                gemini: 'AI OCR',
              };

              return (
                <button
                  key={src}
                  onClick={() => setSelectedRawSource(src)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <span>{srcNames[src]}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    isSelected ? 'bg-indigo-950 text-indigo-200' : 'bg-slate-900 text-slate-400'
                  }`}>
                    {count}件
                  </span>
                </button>
              );
            })}
          </div>

          {/* Raw list for selected source */}
          {sourceResults[selectedRawSource]?.items && sourceResults[selectedRawSource]!.items.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {sourceResults[selectedRawSource]!.items.map((item, i) => {
                const rawPreviewKey = `raw_${selectedRawSource}_${i}_${item.id}`;
                const isRawExpanded = Boolean(expandedPreviewKeys[rawPreviewKey]);

                return (
                  <div key={i} className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 flex flex-col">
                    <div className="flex gap-3 items-start">
                      {/* Sequential index number to the left of Jacket */}
                      <div className="flex-shrink-0 font-mono text-xs font-bold text-slate-300 bg-slate-900 border border-slate-700 px-2 py-1 rounded-md text-center min-w-[28px] mt-0.5 shadow-xs">
                        #{i + 1}
                      </div>
                      <div className="w-16 h-16 rounded-lg bg-slate-900 flex-shrink-0 overflow-hidden border border-slate-700">
                        {item.coverUrl ? (
                          <img 
                            src={item.coverUrl} 
                            alt={item.title} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.dataset.triedProxy && item.coverUrl && !item.coverUrl.startsWith('data:')) {
                                target.dataset.triedProxy = 'true';
                                target.src = `/api/image-proxy?url=${encodeURIComponent(item.coverUrl)}`;
                              } else {
                                target.style.display = 'none';
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600 text-[10px]">No Cover</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {item.catalogNumber && (
                          <span className="text-[10px] font-mono text-indigo-300 font-bold bg-indigo-950/60 px-1.5 py-0.2 rounded">
                            {item.catalogNumber}
                          </span>
                        )}
                        <h4 className="text-sm font-bold text-white truncate">{item.title}</h4>
                        <p className="text-xs text-slate-300 truncate">{item.artist}</p>
                        <p className="text-[11px] text-slate-400 truncate">{item.label} {item.releaseDate}</p>
                      </div>
                      <div className="flex flex-col gap-1.5 self-center flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => togglePreview(rawPreviewKey)}
                          className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 border transition-colors cursor-pointer ${
                            isRawExpanded
                              ? 'bg-indigo-950 text-indigo-200 border-indigo-500/60'
                              : 'bg-slate-900 hover:bg-slate-700 text-slate-200 border-slate-700'
                          }`}
                        >
                          <ListMusic className="w-3 h-3 text-indigo-400" />
                          <span>詳細をプレビュー</span>
                          {isRawExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectCD(item)}
                          className="px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs text-center cursor-pointer"
                        >
                          詳細モーダル
                        </button>
                      </div>
                    </div>

                    {/* Slide-down Tracklist Preview for Raw Card */}
                    <div
                      className={`grid transition-all duration-300 ease-in-out ${
                        isRawExpanded
                          ? 'grid-rows-[1fr] opacity-100 mt-3'
                          : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="bg-slate-900/90 border border-slate-700/80 rounded-lg p-2.5 space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-1.5">
                            <span className="font-bold text-indigo-300">
                              収録トラック ({item.tracks?.length || 0}曲)
                            </span>
                            {item.barcode && <span className="font-mono">JAN: {item.barcode}</span>}
                          </div>
                          {item.tracks && item.tracks.length > 0 ? (
                            <div className="max-h-44 overflow-y-auto divide-y divide-slate-800/60">
                              {item.tracks.map((tr, tIdx) => (
                                <div key={tIdx} className="py-1 px-1.5 flex items-center justify-between gap-2 text-xs">
                                  <span className="truncate text-slate-200">
                                    <span className="font-mono text-slate-500 mr-2">{tr.trackNumber || tIdx + 1}.</span>
                                    {tr.title}
                                  </span>
                                  {tr.duration && (
                                    <span className="font-mono text-[11px] text-slate-400 flex-shrink-0">{tr.duration}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-center text-xs text-slate-500 py-2">トラックリスト情報なし</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-slate-800/40 p-6 text-center text-slate-400 text-xs rounded-xl border border-slate-800">
              このAPIからは結果が返されませんでした。
            </div>
          )}
        </div>
      )}

    </div>
  );
};
