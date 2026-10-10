import React, { useState, useMemo, useEffect } from 'react';
import { CDMetadata } from '../types/cd';
import { enhanceImageWithCanvas, convertImageUrlToBase64 } from '../utils/imageEnhancer';
import { normalizeSingleTag, normalizeTagList } from '../lib/tagNormalizer';
import { loadTagPresetsDB, DEFAULT_TAG_PRESETS } from '../lib/db';
import { matchesCDSearchQuery } from '../utils/japaneseSearchNormalizer';
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
  Tag,
  EyeOff,
  Eye,
  Edit3,
  Layers,
  ZoomIn,
  ZoomOut,
  Images,
} from 'lucide-react';

interface JacketGalleryViewProps {
  cds: CDMetadata[];
  onSelectCD: (cd: CDMetadata, currentList?: CDMetadata[]) => void;
  onSaveCD: (updatedCD: CDMetadata) => Promise<void>;
  onBatchUpdateCDs?: (updatedCDs: CDMetadata[], onProgress?: (completed: number, total: number) => void) => Promise<void>;
  onNavigateToSpreadsheet?: () => void;
  onOpenPDFCatalog?: (selectedCDs: CDMetadata[]) => void;
  onOpenTagManager?: () => void;
}

type SortOption = 'updatedAt' | 'releaseDate' | 'title' | 'artist' | 'trackCount';
type UnusedTagDisplayMode = 'hide' | 'grayout';
type GridDensityLevel = 1 | 2 | 3 | 4; // 1: Large LP (3-4 cols), 2: Standard (5-6 cols), 3: Medium (7-8 cols), 4: Compact (9-10 cols)
type GroupByMode = 'none' | 'artist' | 'decade' | 'label';

export const JacketGalleryView: React.FC<JacketGalleryViewProps> = ({
  cds,
  onSelectCD,
  onSaveCD,
  onBatchUpdateCDs,
  onNavigateToSpreadsheet,
  onOpenPDFCatalog,
  onOpenTagManager,
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
  const [tagPresets, setTagPresets] = useState<string[]>(DEFAULT_TAG_PRESETS);
  const [unusedTagMode, setUnusedTagMode] = useState<UnusedTagDisplayMode>('hide');
  const [gridDensity, setGridDensity] = useState<GridDensityLevel>(2);
  const [groupByMode, setGroupByMode] = useState<GroupByMode>('none');
  const [previewImageByCdId, setPreviewImageByCdId] = useState<Record<string, string>>({});

  // Load registered tag presets whenever cds change so we know both used and unused registered tags
  useEffect(() => {
    loadTagPresetsDB()
      .then((loaded) => {
        if (Array.isArray(loaded) && loaded.length > 0) {
          setTagPresets(loaded);
        }
      })
      .catch(() => {});
  }, [cds]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Compute usage count for every tag across the current library + registered presets
  const { activeGenreStats, unusedGenreStats } = useMemo(() => {
    const countMap = new Map<string, number>();

    // First, count tags actually checked/registered on CDs in the library
    cds.forEach((c) => {
      if (!Array.isArray(c.tags) || c.tags.length === 0) return;
      const cdTags = normalizeTagList(c.tags, { preserveCustomName: true });
      for (const t of cdTags) {
        if (t) {
          countMap.set(t, (countMap.get(t) || 0) + 1);
        }
      }
    });

    // Separate active (count > 0) vs unused (count === 0 in presets)
    const activeList = Array.from(countMap.entries())
      .filter(([, count]) => count > 0)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0], 'ja');
      })
      .map(([tag, count]) => ({ tag, count, isUnused: false }));

    const unusedSet = new Set<string>();
    tagPresets.forEach((preset) => {
      const cleaned = normalizeSingleTag(preset, { preserveCustomName: true });
      if (cleaned && (!countMap.has(cleaned) || countMap.get(cleaned) === 0)) {
        unusedSet.add(cleaned);
      }
    });

    const unusedList = Array.from(unusedSet)
      .sort((a, b) => a.localeCompare(b, 'ja'))
      .map((tag) => ({ tag, count: 0, isUnused: true }));

    return {
      activeGenreStats: activeList,
      unusedGenreStats: unusedList,
    };
  }, [cds, tagPresets]);

  // Automatically reset selectedGenre to 'all' if the selected tag is no longer present on any CD in the library
  useEffect(() => {
    if (selectedGenre !== 'all' && !activeGenreStats.some((g) => g.tag === selectedGenre)) {
      setSelectedGenre('all');
    }
  }, [activeGenreStats, selectedGenre]);

  // Filter & Sort CDs
  const filteredCDs = useMemo(() => {
    let list = [...cds];

    // Search filter (Title, Artist, Catalog Number, Label, Tags, and Track Titles with Japanese orthographic normalization)
    if (searchQuery.trim()) {
      list = list.filter((c) => matchesCDSearchQuery(c, searchQuery));
    }

    // Genre/Tag filter (strictly matches tags currently registered on the CD)
    if (selectedGenre !== 'all') {
      list = list.filter((c) => {
        const cdTags = normalizeTagList(c.tags || [], { preserveCustomName: true });
        return cdTags.includes(selectedGenre);
      });
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

  // Group filteredCDs into shelf sections when groupByMode !== 'none'
  const groupedSections = useMemo(() => {
    if (groupByMode === 'none') {
      return [{ key: 'all', title: 'すべてのアルバム', subtitle: '', items: filteredCDs }];
    }

    const groups = new Map<string, CDMetadata[]>();

    filteredCDs.forEach((cd) => {
      let groupKey = '未分類';
      if (groupByMode === 'artist') {
        groupKey = (cd.artist || 'アーティスト未設定').trim() || 'アーティスト未設定';
      } else if (groupByMode === 'label') {
        groupKey = (cd.label || 'レーベル未設定').trim() || 'レーベル未設定';
      } else if (groupByMode === 'decade') {
        const effectiveDate = (cd.vinylRecordReleaseDate || cd.releaseDate || '').trim();
        const yearMatch = effectiveDate.match(/(\d{4})/);
        if (yearMatch) {
          const y = parseInt(yearMatch[1], 10);
          groupKey = `${Math.floor(y / 10) * 10}年代`;
        } else {
          // Check if tags contain a decade
          const decadeTag = (cd.tags || []).find((t) => /^(19\d0|20\d0)年代$/.test(t));
          groupKey = decadeTag || '発売年代未設定';
        }
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(cd);
    });

    const entries = Array.from(groups.entries()).map(([key, items]) => ({
      key,
      title: key,
      subtitle:
        groupByMode === 'artist'
          ? 'アーティスト棚'
          : groupByMode === 'decade'
          ? 'リリース年代棚 (LP/EP優先)'
          : 'レコードレーベル棚',
      items,
    }));

    entries.sort((a, b) => {
      if (a.key.includes('未設定')) return 1;
      if (b.key.includes('未設定')) return -1;
      return a.key.localeCompare(b.key, 'ja');
    });

    return entries;
  }, [filteredCDs, groupByMode]);

  const gridColsClass = useMemo(() => {
    if (gridDensity === 1) {
      return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6';
    }
    if (gridDensity === 3) {
      return 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-3 sm:gap-3.5';
    }
    if (gridDensity === 4) {
      return 'grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-10 gap-2.5';
    }
    return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5';
  }, [gridDensity]);

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
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl px-3.5 py-2 shadow-xl flex flex-col md:flex-row items-center justify-between gap-2.5">
        
        {/* Title & Stats */}
        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 ring-1 ring-white/20 flex-shrink-0">
            <Disc className="w-4 h-4 animate-spin-slow" />
          </div>
          <div>
            <div className="flex items-center gap-2 leading-tight">
              <h2 className="text-sm font-extrabold text-white tracking-tight">
                ジャケットギャラリー ビュー
              </h2>
              <span className="text-[10px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/30 px-2 py-0.2 rounded-full">
                {filteredCDs.length} / {cds.length} 件
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
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

          {/* Genre / Tag Filter (Automatically hides unused tags or shows them grayed-out as disabled) */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedGenre}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'all' || activeGenreStats.some((g) => g.tag === val)) {
                  setSelectedGenre(val);
                }
              }}
              className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
              title="現在CDに付与されているタグで絞り込み（未使用タグは自動非表示またはグレーアウト）"
            >
              <option value="all">
                すべてのジャンル・タグ ({activeGenreStats.length}種 使用中)
              </option>
              {activeGenreStats.length > 0 && (
                <optgroup label={`使用中のタグ (${activeGenreStats.length}種)`}>
                  {activeGenreStats.map((g) => (
                    <option key={g.tag} value={g.tag} className="text-white bg-slate-900">
                      #{g.tag} ({g.count}件)
                    </option>
                  ))}
                </optgroup>
              )}
              {unusedTagMode === 'grayout' && unusedGenreStats.length > 0 && (
                <optgroup
                  label={`未使用のタグ (${unusedGenreStats.length}種・該当CDなし)`}
                  className="text-slate-500"
                >
                  {unusedGenreStats.map((u) => (
                    <option
                      key={`unused-${u.tag}`}
                      value={u.tag}
                      disabled
                      className="text-slate-500 bg-slate-950 italic"
                    >
                      #{u.tag} (0件・未使用)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {unusedGenreStats.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setUnusedTagMode((prev) => (prev === 'hide' ? 'grayout' : 'hide'))
                }
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer ${
                  unusedTagMode === 'grayout'
                    ? 'bg-slate-800 text-slate-300 border-slate-600'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border-slate-800'
                }`}
                title={
                  unusedTagMode === 'hide'
                    ? `未使用タグ (${unusedGenreStats.length}種) は現在自動非表示です。クリックすると「未使用」としてグレーアウト表示します`
                    : `未使用タグ (${unusedGenreStats.length}種) をグレーアウト表示中です。クリックすると自動非表示に戻します`
                }
              >
                {unusedTagMode === 'hide' ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                    <span className="hidden sm:inline">未使用を非表示中 ({unusedGenreStats.length})</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="hidden sm:inline">未使用をグレー表示中 ({unusedGenreStats.length})</span>
                  </>
                )}
              </button>
            )}

            {onOpenTagManager && (
              <button
                type="button"
                onClick={onOpenTagManager}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-purple-950/60 hover:bg-purple-900/70 text-purple-200 border border-purple-500/40 transition-colors cursor-pointer"
                title="タグ名称の追加・変更・一括管理を開く"
              >
                <Edit3 className="w-3.5 h-3.5 text-purple-400" />
                <span className="hidden sm:inline">タグ管理</span>
              </button>
            )}
          </div>

          {/* Shelf Grouping Selector (Artist / Decade / Label) */}
          <div className="flex items-center bg-slate-950 border border-slate-700/80 rounded-xl px-2.5 py-1 text-xs gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <select
              value={groupByMode}
              onChange={(e) => setGroupByMode(e.target.value as GroupByMode)}
              className="bg-transparent text-slate-200 focus:outline-none text-xs font-semibold cursor-pointer"
              title="ギャラリーをアーティスト別・発売年代別・レーベル別のレコード棚形式でグループ表示します"
            >
              <option value="none" className="bg-slate-900">棚グループ: なし (一覧)</option>
              <option value="artist" className="bg-slate-900">棚表示: アーティスト別</option>
              <option value="decade" className="bg-slate-900">棚表示: 発売年代別</option>
              <option value="label" className="bg-slate-900">棚表示: レーベル別</option>
            </select>
          </div>

          {/* Grid Density / Jacket Size Slider */}
          <div
            className="flex items-center gap-1.5 bg-slate-950 border border-slate-700/80 rounded-xl px-2.5 py-1 text-xs"
            title="ジャケット表示サイズ・グリッド密度の切り替え（大判LP鑑賞モード ⇔ コンパクト一覧モード）"
          >
            <button
              type="button"
              onClick={() => setGridDensity((d) => Math.min(4, d + 1) as GridDensityLevel)}
              className="text-slate-400 hover:text-white cursor-pointer"
              title="ジャケットを小さく（一覧密度を高く）"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={5 - gridDensity}
              onChange={(e) => {
                const inv = parseInt(e.target.value, 10);
                setGridDensity((5 - inv) as GridDensityLevel);
              }}
              className="w-16 sm:w-20 accent-indigo-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />
            <button
              type="button"
              onClick={() => setGridDensity((d) => Math.max(1, d - 1) as GridDensityLevel)}
              className="text-slate-400 hover:text-white cursor-pointer"
              title="ジャケットを大きく（大判LPサイズ表示）"
            >
              <ZoomIn className="w-3.5 h-3.5 text-indigo-400" />
            </button>
            <span className="text-[10px] font-mono text-indigo-300 font-bold min-w-[44px] text-center">
              {gridDensity === 1
                ? '大判LP'
                : gridDensity === 2
                ? '標準'
                : gridDensity === 3
                ? '中密度'
                : '高密度'}
            </span>
          </div>

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
        </div>

      </div>

      {/* Tag Filter Pills Bar (Active Tags + Optional Grayed-Out Unused Tags) */}
      {(activeGenreStats.length > 0 || (unusedTagMode === 'grayout' && unusedGenreStats.length > 0)) && (
        <div className="bg-slate-900/75 border border-slate-800/90 rounded-2xl px-4 py-2.5 flex items-center gap-1.5 flex-wrap shadow-md">
          <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1 mr-1">
            <Tag className="w-3.5 h-3.5 text-indigo-400" />
            <span>タグ絞り込み:</span>
          </span>

          <button
            type="button"
            onClick={() => setSelectedGenre('all')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
              selectedGenre === 'all'
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                : 'bg-slate-950/80 text-slate-300 border-slate-700/80 hover:bg-slate-800 hover:text-white'
            }`}
          >
            すべて ({cds.length}件)
          </button>

          {activeGenreStats.map((g) => {
            const isSelected = selectedGenre === g.tag;
            return (
              <button
                key={g.tag}
                type="button"
                onClick={() => setSelectedGenre(isSelected ? 'all' : g.tag)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer flex items-center gap-1 ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm font-bold'
                    : 'bg-slate-950/80 text-purple-300 border-purple-500/30 hover:bg-purple-950/60 hover:border-purple-400/50'
                }`}
                title={`タグ「#${g.tag}」が付与されたCD (${g.count}件) で絞り込み`}
              >
                <span>#{g.tag}</span>
                <span
                  className={`text-[10px] font-mono px-1 rounded ${
                    isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {g.count}
                </span>
              </button>
            );
          })}

          {unusedTagMode === 'grayout' &&
            unusedGenreStats.map((u) => (
              <span
                key={`unused-pill-${u.tag}`}
                aria-disabled="true"
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-800/80 bg-slate-950/40 text-slate-600 cursor-not-allowed select-none flex items-center gap-1 opacity-60"
                title={`「#${u.tag}」は現在ライブラリのどのCDにも設定されていません（未使用・0件）`}
              >
                <span className="line-through decoration-slate-700">#{u.tag}</span>
                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-900 text-slate-500 border border-slate-800">
                  未使用 (0)
                </span>
              </span>
            ))}
        </div>
      )}

      {/* Gallery Cards Grid (Supports Flat Grid and Shelf Grouped Sections) */}
      {filteredCDs.length > 0 ? (
        <div className="space-y-7">
          {groupedSections.map((section) => (
            <div key={section.key} className="space-y-3">
              {groupByMode !== 'none' && (
                <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border-l-4 border-amber-500 border-y border-r border-slate-800 rounded-r-2xl px-4 py-2.5 flex items-center justify-between shadow-lg">
                  <div className="flex items-center gap-2.5">
                    <Disc className="w-4 h-4 text-amber-400" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-extrabold text-white tracking-tight">
                          {section.title}
                        </h3>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-950/90 text-amber-300 border border-amber-500/40">
                          {section.items.length} 枚
                        </span>
                      </div>
                      {section.subtitle && (
                        <p className="text-[10px] text-slate-400">{section.subtitle}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className={`grid ${gridColsClass}`}>
                {section.items.map((cd) => {
                  const isUpscaling = upscalingCDId === cd.id;
                  const isConverting = convertingCDId === cd.id;
                  const activePreviewUrl = previewImageByCdId[cd.id] || cd.coverUrl;
                  const isBase64 = Boolean(activePreviewUrl && activePreviewUrl.startsWith('data:image/'));
                  const trackCount = cd.tracks ? cd.tracks.length : 0;
                  const subImages = cd.subImages || [];
                  const isCompact = gridDensity >= 3;

                  return (
                    <div
                      key={cd.id}
                      onClick={() => onSelectCD(cd, filteredCDs)}
                      className={`group bg-slate-900 border border-slate-800 hover:border-indigo-500/60 rounded-2xl ${
                        isCompact ? 'p-2' : 'p-3'
                      } flex flex-col justify-between transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-950/60 hover:-translate-y-1.5 cursor-pointer relative overflow-hidden`}
                    >
                      {/* 3D Vinyl Sleeve Container */}
                      <div className="relative aspect-square rounded-xl bg-slate-950 overflow-hidden border border-slate-800 shadow-md group-hover:shadow-indigo-900/40 mb-2.5 flex items-center justify-center">
                        {/* Sliding Vinyl Disc on Hover */}
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3/4 h-3/4 rounded-full bg-slate-950 border-4 border-slate-800 shadow-2xl transition-all duration-500 transform translate-x-12 opacity-0 group-hover:translate-x-3 group-hover:opacity-100 group-hover:rotate-180 flex items-center justify-center">
                          <div className="w-10 h-10 rounded-full bg-indigo-600/80 border-2 border-indigo-400/60 flex items-center justify-center">
                            <div className="w-3 h-3 rounded-full bg-slate-950" />
                          </div>
                        </div>

                        {/* Jacket Image */}
                        {activePreviewUrl ? (
                          <img
                            src={activePreviewUrl}
                            alt={cd.title}
                            className="w-full h-full object-cover relative z-10 transition-transform duration-500 group-hover:scale-105"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.dataset.triedProxy && activePreviewUrl && !activePreviewUrl.startsWith('data:')) {
                                target.dataset.triedProxy = 'true';
                                target.src = `/api/image-proxy?url=${encodeURIComponent(activePreviewUrl)}`;
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
                        {cd.coverUrl && !isCompact && (
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

                        {/* Base64 & Sub-Images Status Badges (Top-Left) */}
                        <div className="absolute top-2 left-2 z-20 flex items-center gap-1 flex-wrap">
                          {isBase64 && !isCompact && (
                            <span
                              className="text-[9px] font-mono font-bold bg-emerald-950/85 backdrop-blur-md text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded shadow flex items-center gap-0.5"
                              title="BASE64形式でローカルIndexedDBに永続保存済み"
                            >
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                              <span>BASE64</span>
                            </span>
                          )}
                          {subImages.length > 0 && (
                            <span
                              className="text-[9px] font-bold bg-amber-950/90 backdrop-blur-md text-amber-200 border border-amber-500/50 px-1.5 py-0.5 rounded shadow flex items-center gap-0.5"
                              title={`サブ画像（裏ジャケ・帯・盤面など）${subImages.length}枚登録済み`}
                            >
                              <Images className="w-2.5 h-2.5 text-amber-400" />
                              <span>+{subImages.length}</span>
                            </span>
                          )}
                        </div>

                        {/* Sub-Images Quick Switcher Pill Strip (Bottom-Right when subImages exist) */}
                        {subImages.length > 0 && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute bottom-2 right-2 z-20 flex items-center gap-1 bg-slate-950/90 backdrop-blur-md border border-slate-700/80 rounded-lg px-1.5 py-0.5 shadow-lg"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImageByCdId((prev) => {
                                  const next = { ...prev };
                                  delete next[cd.id];
                                  return next;
                                })
                              }
                              className={`text-[9px] px-1 py-0.2 rounded font-bold cursor-pointer transition-colors ${
                                !previewImageByCdId[cd.id]
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                              title="表ジャケットを表示"
                            >
                              表
                            </button>
                            {subImages.slice(0, 3).map((sub) => {
                              const isCurrent = previewImageByCdId[cd.id] === sub.imageUrl;
                              const shortLabel =
                                sub.type === 'back'
                                  ? '裏'
                                  : sub.type === 'obi'
                                  ? '帯'
                                  : sub.type === 'disc'
                                  ? '盤'
                                  : sub.type === 'booklet'
                                  ? '冊'
                                  : sub.label.slice(0, 2);
                              return (
                                <button
                                  key={sub.id}
                                  type="button"
                                  onClick={() =>
                                    setPreviewImageByCdId((prev) => ({
                                      ...prev,
                                      [cd.id]: sub.imageUrl,
                                    }))
                                  }
                                  className={`text-[9px] px-1 py-0.2 rounded font-bold cursor-pointer transition-colors ${
                                    isCurrent
                                      ? 'bg-amber-600 text-white'
                                      : 'text-amber-300/80 hover:text-amber-200'
                                  }`}
                                  title={`${sub.label}を表示`}
                                >
                                  {shortLabel}
                                </button>
                              );
                            })}
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
                        {!isCompact && cd.tags && cd.tags.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap pt-0.5">
                            {normalizeTagList(cd.tags, { preserveCustomName: true }).slice(0, 5).map((tagItem, tIdx) => (
                              <span
                                key={tIdx}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedGenre(tagItem);
                                }}
                                className={`text-[9px] px-1.5 py-0.2 rounded border transition-colors ${
                                  selectedGenre === tagItem
                                    ? 'bg-indigo-600 text-white border-indigo-400 font-bold'
                                    : 'bg-slate-800/90 text-purple-300 border-purple-500/30 hover:bg-slate-700'
                                }`}
                                title={`タグ「#${tagItem}」で絞り込み`}
                              >
                                #{tagItem}
                              </span>
                            ))}
                            {cd.tags.length > 5 && (
                              <span className="text-[9px] text-slate-500 font-mono">+{cd.tags.length - 5}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Card Footer Badges */}
                      <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="flex items-center gap-1 font-mono text-indigo-300 font-semibold">
                          <Music className="w-3 h-3 text-indigo-400" />
                          <span>{trackCount} 曲</span>
                        </span>

                        <span className="font-mono text-slate-400 truncate max-w-[90px]">
                          {cd.vinylRecordReleaseDate || cd.releaseDate || cd.label || '-'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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
