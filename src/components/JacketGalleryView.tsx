import React, { useState, useMemo } from 'react';
import { CDMetadata } from '../types/cd';
import { enhanceImageWithCanvas, convertImageUrlToBase64 } from '../utils/imageEnhancer';
import { normalizeSingleTag, normalizeTagList } from '../lib/tagNormalizer';
import {
  Search,
  Disc,
  Sparkles,
  Music,
  ArrowUp,
  ArrowDown,
  Loader2,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  BookOpen,
} from 'lucide-react';

interface JacketGalleryViewProps {
  cds: CDMetadata[];
  onSelectCD: (cd: CDMetadata, currentList?: CDMetadata[]) => void;
  onSaveCD: (updatedCD: CDMetadata) => Promise<void>;
  onBatchUpdateCDs?: (updatedCDs: CDMetadata[], onProgress?: (completed: number, total: number) => void) => Promise<void>;
  onNavigateToSpreadsheet?: () => void;
  onOpenPDFCatalog?: (selectedCDs: CDMetadata[]) => void;
}

type SortOption = 'updatedAt' | 'releaseDate' | 'title' | 'artist' | 'trackCount';

export const JacketGalleryView: React.FC<JacketGalleryViewProps> = ({
  cds,
  onSelectCD,
  onSaveCD,
  onBatchUpdateCDs,
  onNavigateToSpreadsheet,
  onOpenPDFCatalog,
}) => {
  const [searchQuery, setSearchKeyword] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [sortField, setSortField] = useState<SortOption>('updatedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [upscalingCDId, setUpscalingCDId] = useState<string | null>(null);
  const [convertingCDId, setConvertingCDId] = useState<string | null>(null);
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const [batchConvertProgress, setBatchConvertProgress] = useState<{ current: number; total: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Collect unique normalized genres & tags
  const genresList = useMemo(() => {
    const set = new Set<string>();
    cds.forEach((c) => {
      if (c.genre) {
        for (const g of normalizeTagList([c.genre])) {
          set.add(g);
        }
      }
      if (c.tags) {
        for (const t of normalizeTagList(c.tags)) {
          set.add(t);
        }
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [cds]);

  // Filter & Sort CDs
  const filteredCDs = useMemo(() => {
    let list = [...cds];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.artist.toLowerCase().includes(q) ||
          (c.catalogNumber && c.catalogNumber.toLowerCase().includes(q)) ||
          (c.label && c.label.toLowerCase().includes(q)) ||
          (c.genre && normalizeSingleTag(c.genre).toLowerCase().includes(q)) ||
          (c.tags && normalizeTagList(c.tags).some((t) => t.toLowerCase().includes(q)))
      );
    }

    // Genre filter
    if (selectedGenre !== 'all') {
      list = list.filter(
        (c) =>
          normalizeTagList(c.genre ? [c.genre] : []).includes(selectedGenre) ||
          normalizeTagList(c.tags).includes(selectedGenre)
      );
    }

    // Sort
    list.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      if (sortField === 'trackCount') {
        valA = a.tracks ? a.tracks.length : 0;
        valB = b.tracks ? b.tracks.length : 0;
        return sortDirection === 'asc' ? valA - valB : valB - valA;
      } else if (sortField === 'releaseDate') {
        valA = a.releaseDate || '0000-00-00';
        valB = b.releaseDate || '0000-00-00';
      } else if (sortField === 'title') {
        valA = a.title.toLowerCase();
        valB = b.title.toLowerCase();
      } else if (sortField === 'artist') {
        valA = a.artist.toLowerCase();
        valB = b.artist.toLowerCase();
      } else {
        valA = new Date(a.updatedAt || 0).getTime();
        valB = new Date(b.updatedAt || 0).getTime();
        return sortDirection === 'asc' ? valA - valB : valB - valA;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [cds, searchQuery, selectedGenre, sortField, sortDirection]);

  // AI Cover Art Upscaling Handler
  const handleUpscaleJacket = async (e: React.MouseEvent, cd: CDMetadata) => {
    e.stopPropagation();
    if (!cd.coverUrl) {
      showToast('アップスケーリング対象の画像URLがありません');
      return;
    }

    setUpscalingCDId(cd.id);
    try {
      const res = await fetch('/api/upscale-jacket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: cd.coverUrl,
          title: cd.title,
          artist: cd.artist,
          catalogNumber: cd.catalogNumber,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (data.enhancedImageBase64) {
        const updatedCD: CDMetadata = {
          ...cd,
          coverUrl: data.enhancedImageBase64,
          updatedAt: new Date().toISOString(),
        };
        await onSaveCD(updatedCD);
        showToast(`「${cd.title}」のジャケットをGemini AIで高画質化・更新しました！`);
      } else if (data.isQuotaError || data.error) {
        // Fallback to high-res canvas sharpening
        const canvasEnhanced = await enhanceImageWithCanvas(cd.coverUrl, 1000);
        const updatedCD: CDMetadata = {
          ...cd,
          coverUrl: canvasEnhanced,
          updatedAt: new Date().toISOString(),
        };
        await onSaveCD(updatedCD);
        showToast(`「${cd.title}」のジャケットを超解像キャンバスフィルターで高画質化しました！`);
      } else {
        throw new Error('高画質化処理に失敗しました');
      }
    } catch (err: any) {
      console.error('Upscale error:', err);
      try {
        const canvasEnhanced = await enhanceImageWithCanvas(cd.coverUrl, 1000);
        const updatedCD: CDMetadata = {
          ...cd,
          coverUrl: canvasEnhanced,
          updatedAt: new Date().toISOString(),
        };
        await onSaveCD(updatedCD);
        showToast(`「${cd.title}」のジャケットを超解像キャンバスフィルターで更新しました！`);
      } catch {
        showToast('高画質化処理に失敗しました');
      }
    } finally {
      setUpscalingCDId(null);
    }
  };

  // Count how many CDs still use external http/https cover links instead of Base64
  const externalLinkCDs = useMemo(() => {
    return cds.filter(
      (c) =>
        c.coverUrl &&
        c.coverUrl.trim() !== '' &&
        !c.coverUrl.trim().startsWith('data:image/') &&
        (c.coverUrl.trim().startsWith('http://') || c.coverUrl.trim().startsWith('https://'))
    );
  }, [cds]);

  // Convert single CD cover link to Base64
  const handleConvertSingleToBase64 = async (e: React.MouseEvent, cd: CDMetadata) => {
    e.stopPropagation();
    if (!cd.coverUrl || cd.coverUrl.startsWith('data:image/')) return;

    setConvertingCDId(cd.id);
    try {
      const base64Url = await convertImageUrlToBase64(cd.coverUrl);
      if (base64Url && base64Url.startsWith('data:image/')) {
        const updatedCD: CDMetadata = {
          ...cd,
          coverUrl: base64Url,
          updatedAt: new Date().toISOString(),
        };
        await onSaveCD(updatedCD);
        showToast(`「${cd.title}」のジャケット画像をBASE64形式に変換・保存しました！`);
      } else {
        showToast('画像のBASE64変換に失敗しました（リンク切れの可能性があります）');
      }
    } catch {
      showToast('画像のBASE64変換中にエラーが発生しました');
    } finally {
      setConvertingCDId(null);
    }
  };

  // Batch convert all external cover links to Base64
  const handleBatchConvertAllToBase64 = async () => {
    if (externalLinkCDs.length === 0 || isBatchConverting) return;

    setIsBatchConverting(true);
    setBatchConvertProgress({ current: 0, total: externalLinkCDs.length });

    try {
      const updatedList: CDMetadata[] = [];
      let completed = 0;
      const CONCURRENCY = 4;

      for (let i = 0; i < externalLinkCDs.length; i += CONCURRENCY) {
        const chunk = externalLinkCDs.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (cd) => {
            if (!cd.coverUrl) return null;
            const base64 = await convertImageUrlToBase64(cd.coverUrl);
            if (base64 && base64.startsWith('data:image/')) {
              return {
                ...cd,
                coverUrl: base64,
                updatedAt: new Date().toISOString(),
              };
            }
            return null;
          })
        );

        for (const item of results) {
          if (item) updatedList.push(item);
        }
        completed += chunk.length;
        setBatchConvertProgress({ current: Math.min(completed, externalLinkCDs.length), total: externalLinkCDs.length });
      }

      if (updatedList.length > 0) {
        if (onBatchUpdateCDs) {
          await onBatchUpdateCDs(updatedList);
        } else {
          for (const item of updatedList) {
            await onSaveCD(item);
          }
        }
        showToast(`${updatedList.length} 件の外部リンク画像をBASE64形式に変換してIndexedDBに保存しました！`);
      } else {
        showToast('変換可能な外部画像リンクがありませんでした');
      }
    } catch (err) {
      console.error('Batch Base64 conversion error:', err);
      showToast('一括BASE64変換中にエラーが発生しました');
    } finally {
      setIsBatchConverting(false);
      setBatchConvertProgress(null);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-indigo-500/50 text-indigo-200 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in slide-in-from-bottom-5">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Controls Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-center justify-between gap-3">
        
        {/* Title & Stats */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 ring-1 ring-white/20">
            <Disc className="w-5 h-5 animate-spin-slow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                ジャケットギャラリー ビュー
              </h2>
              <span className="text-[11px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                {filteredCDs.length} / {cds.length} 件
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              レコードスリーブ・3D回転アニメーション付きインタラクティブギャラリー
            </p>
          </div>
        </div>

        {/* Search, Filter & Actions */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
          
          {/* Keyword Search */}
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="タイトル・歌手・型番で検索..."
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl py-1.5 pl-8 pr-7 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Genre Filter */}
          {genresList.length > 0 && (
            <select
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">すべてのジャンル・タグ ({genresList.length})</option>
              {genresList.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}

          {/* Sort Selector */}
          <div className="flex items-center bg-slate-950 border border-slate-700/80 rounded-xl p-1 text-xs">
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortOption)}
              className="bg-transparent text-slate-300 focus:outline-none px-1 text-xs font-medium cursor-pointer"
            >
              <option value="updatedAt">更新日順</option>
              <option value="releaseDate">発売年月日順</option>
              <option value="title">タイトル順</option>
              <option value="artist">アーティスト順</option>
              <option value="trackCount">収録曲数順</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
              title="昇順/降順切替"
            >
              {sortDirection === 'asc' ? (
                <ArrowUp className="w-3.5 h-3.5 text-indigo-400" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-indigo-400" />
              )}
            </button>
          </div>

          {/* Batch Convert External Image Links to Base64 Button */}
          {externalLinkCDs.length > 0 && (
            <button
              type="button"
              onClick={handleBatchConvertAllToBase64}
              disabled={isBatchConverting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/40 shadow-md transition-all cursor-pointer disabled:opacity-50"
              title="外部URLリンクのままになっているジャケット画像をすべて取得し、BASE64形式に変換してローカルDBに永続保存します"
            >
              {isBatchConverting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-200" />
              ) : (
                <Link2 className="w-3.5 h-3.5 text-emerald-100" />
              )}
              <span>
                {isBatchConverting
                  ? `BASE64変換中 (${batchConvertProgress?.current || 0}/${batchConvertProgress?.total || 0})`
                  : `外部リンク画像をBASE64保存 (${externalLinkCDs.length}件)`}
              </span>
            </button>
          )}

          {/* PDF Catalog / Analog Sleeve Export Button */}
          {onOpenPDFCatalog && (
            <button
              type="button"
              onClick={() => onOpenPDFCatalog(filteredCDs)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white border border-amber-400/40 shadow-md transition-all cursor-pointer"
              title="現在表示中のCDコレクションを印刷用CDカタログ / LPアナログジャケット風PDFとして出力"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-100" />
              <span>アナログジャケット・PDFカタログ出力 ({filteredCDs.length}件)</span>
            </button>
          )}

          {/* Spreadsheet View Navigation Button */}
          {onNavigateToSpreadsheet && (
            <button
              type="button"
              onClick={onNavigateToSpreadsheet}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>表形式表示</span>
            </button>
          )}
        </div>

      </div>

      {/* Gallery Cards Grid */}
      {filteredCDs.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
          {filteredCDs.map((cd) => {
            const isUpscaling = upscalingCDId === cd.id;
            const isConverting = convertingCDId === cd.id;
            const isBase64 = Boolean(cd.coverUrl && cd.coverUrl.startsWith('data:image/'));
            const trackCount = cd.tracks ? cd.tracks.length : 0;

            return (
              <div
                key={cd.id}
                onClick={() => onSelectCD(cd, filteredCDs)}
                className="group bg-slate-900 border border-slate-800 hover:border-indigo-500/60 rounded-2xl p-3 flex flex-col justify-between transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-950/60 hover:-translate-y-1.5 cursor-pointer relative overflow-hidden"
              >
                {/* 3D Vinyl Sleeve Container */}
                <div className="relative aspect-square rounded-xl bg-slate-950 overflow-hidden border border-slate-800 shadow-md group-hover:shadow-indigo-900/40 mb-3 flex items-center justify-center">
                  
                  {/* Sliding Vinyl Disc on Hover */}
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3/4 h-3/4 rounded-full bg-slate-950 border-4 border-slate-800 shadow-2xl transition-all duration-500 transform translate-x-12 opacity-0 group-hover:translate-x-3 group-hover:opacity-100 group-hover:rotate-180 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-indigo-600/80 border-2 border-indigo-400/60 flex items-center justify-center">
                      <div className="w-3 h-3 rounded-full bg-slate-950" />
                    </div>
                  </div>

                  {/* Jacket Image */}
                  {cd.coverUrl ? (
                    <img
                      src={cd.coverUrl}
                      alt={cd.title}
                      className="w-full h-full object-cover relative z-10 transition-transform duration-500 group-hover:scale-105"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (!target.dataset.triedProxy && cd.coverUrl && !cd.coverUrl.startsWith('data:')) {
                          target.dataset.triedProxy = 'true';
                          target.src = `/api/image-proxy?url=${encodeURIComponent(cd.coverUrl)}`;
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 p-2 text-center relative z-10">
                      <Disc className="w-10 h-10 mb-1 opacity-50 group-hover:text-indigo-400 transition-colors" />
                      <span className="text-[10px] text-slate-500">No Image</span>
                    </div>
                  )}

                  {/* Top-Right Action Overlay Buttons */}
                  {cd.coverUrl && (
                    <div className="absolute top-2 right-2 z-20 flex flex-col items-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        type="button"
                        onClick={(e) => handleUpscaleJacket(e, cd)}
                        disabled={isUpscaling}
                        className="px-2 py-1 rounded-lg bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-500/50 text-[10px] font-bold shadow-lg flex items-center gap-1 cursor-pointer"
                        title="Gemini AIでこのジャケットを高画質化・超解像化"
                      >
                        {isUpscaling ? (
                          <Loader2 className="w-3 h-3 animate-spin text-indigo-300" />
                        ) : (
                          <Sparkles className="w-3 h-3 text-indigo-300" />
                        )}
                        <span>{isUpscaling ? 'AI高画質化中...' : '✨ AI高画質化'}</span>
                      </button>

                      {!isBase64 && (
                        <button
                          type="button"
                          onClick={(e) => handleConvertSingleToBase64(e, cd)}
                          disabled={isConverting}
                          className="px-2 py-1 rounded-lg bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/50 text-[10px] font-bold shadow-lg flex items-center gap-1 cursor-pointer"
                          title="リンク先の画像をBASE64形式に変換してローカルDBに保存"
                        >
                          {isConverting ? (
                            <Loader2 className="w-3 h-3 animate-spin text-emerald-300" />
                          ) : (
                            <Link2 className="w-3 h-3 text-emerald-300" />
                          )}
                          <span>{isConverting ? '変換中...' : 'BASE64保存'}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Base64 Status Badge (Top-Left) */}
                  {isBase64 && (
                    <div className="absolute top-2 left-2 z-20">
                      <span
                        className="text-[9px] font-mono font-bold bg-emerald-950/85 backdrop-blur-md text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded shadow flex items-center gap-0.5"
                        title="BASE64形式でローカルIndexedDBに永続保存済み"
                      >
                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                        <span>BASE64</span>
                      </span>
                    </div>
                  )}

                  {/* Catalog Number Tag Overlay */}
                  <div className="absolute bottom-2 left-2 z-20">
                    <span className="text-[10px] font-mono font-bold bg-slate-950/80 backdrop-blur-md text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded shadow">
                      {cd.catalogNumber || '型番未設定'}
                    </span>
                  </div>
                </div>

                {/* Album Info */}
                <div className="space-y-1 min-w-0">
                  <h3
                    className="text-xs font-extrabold text-white truncate leading-tight group-hover:text-indigo-300 transition-colors"
                    title={cd.title}
                  >
                    {cd.title}
                  </h3>
                  <p
                    className="text-[11px] font-medium text-slate-400 truncate"
                    title={cd.artist}
                  >
                    {cd.artist}
                  </p>
                </div>

                {/* Card Footer Badges */}
                <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                  <span className="flex items-center gap-1 font-mono text-indigo-300 font-semibold">
                    <Music className="w-3 h-3 text-indigo-400" />
                    <span>{trackCount} 曲</span>
                  </span>

                  <span className="font-mono text-slate-400 truncate max-w-[90px]">
                    {cd.releaseDate || cd.label || '-'}
                  </span>
                </div>

              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <Disc className="w-12 h-12 text-slate-600 mx-auto animate-spin-slow" />
          <h3 className="text-sm font-bold text-slate-300">
            該当するCDアルバムが見つかりませんでした
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            検索キーワードやジャンルフィルターを変更するか、検索画面から新しいCDを検索・保存してください。
          </p>
        </div>
      )}

    </div>
  );
};
