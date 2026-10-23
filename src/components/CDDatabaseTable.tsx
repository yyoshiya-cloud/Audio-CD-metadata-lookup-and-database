import React, { useState, useMemo, useEffect } from 'react';
import { CDMetadata } from '../types/cd';
import { Search, FileSpreadsheet, ShieldCheck, Download, Trash2, CheckCircle2, Music, Disc, Filter, Plus, Sparkles, Table, BookOpen, Loader2, Tag, Edit3, Database, Languages, CheckSquare, Square, ChevronDown, ChevronUp, RefreshCw, SlidersHorizontal, LayoutGrid, X, Star, Layers, Eye, EyeOff } from 'lucide-react';
import { matchesCDSearchQuery, getMatchedTracksForQuery } from '../utils/japaneseSearchNormalizer';
import { lookupVinylReleasesBatch } from '../utils/formatUtils';
import { settingsStore, STORAGE_KEYS } from '../lib/settingsStore';
import { Modal } from './Modal';
import { compareSortKeys, sortKeyForArtist, sortKeyForTitle } from '../lib/readingSort';
import { normalizeTagList, normalizeSingleTag, normalizeCDTagsAndGenre } from '../lib/tagNormalizer';
import { loadTagPresetsDB, saveTagPresetsDB, DEFAULT_TAG_PRESETS } from '../lib/db';
import { SpreadsheetEditorView } from './SpreadsheetEditorView';
import { BatchEditModal } from './BatchEditModal';
import { createLogger } from '../lib/logger';

const log = createLogger('CDDatabaseTable');

export interface TableColumnConfig {
  id: string;
  label: string;
  canHide: boolean;
}

export const AVAILABLE_TABLE_COLUMNS: TableColumnConfig[] = [
  { id: 'index', label: 'No.', canHide: true },
  { id: 'jacket', label: 'ジャケット', canHide: true },
  { id: 'catalogNumber', label: '型番 (規格品番)', canHide: true },
  { id: 'title', label: 'CDタイトル', canHide: false },
  { id: 'artist', label: '歌手 / アーティスト', canHide: true },
  { id: 'label', label: 'レーベル', canHide: true },
  { id: 'releaseDate', label: 'CD発売年月日', canHide: true },
  { id: 'vinylRecordReleaseDate', label: 'LP/EP発売年月日', canHide: true },
  { id: 'trackCount', label: '収録曲数', canHide: true },
];

export type TableDensity = 'compact' | 'normal' | 'relaxed';

export type QuickFilterType =
  | 'all'
  | 'hasVinyl'
  | 'noTags'
  | 'rated'
  | 'decade80'
  | 'decade90'
  | 'decade00';

const QUICK_GENRE_OPTIONS = [
  'J-Pop',
  'アイドル',
  'ロック',
  'シティポップ',
  '昭和歌謡',
  'フォーク・ニューミュージック',
  'アニメ・ゲーム',
  'サウンドトラック',
  'ジャズ・フュージョン',
  'クラシック',
  'R&B・ソウル',
  'ヒップホップ・ラップ',
  'エレクトロ・テクノ',
  '洋楽',
];

interface CDDatabaseTableProps {
  cds: CDMetadata[];
  onSelectCD: (cd: CDMetadata, currentList?: CDMetadata[]) => void;
  onDeleteCD: (id: string) => void;
  onBatchDeleteCDs: (ids: string[]) => void;
  onOpenExportModal: (selectedCDs: CDMetadata[]) => void;
  onOpenImportModal?: () => void;
  /** JSON自動バックアップの設定画面を開く */
  onOpenBackupSettings?: () => void;
  /** 読み仮名をAIで生成する（選択中があれば選択分、なければ未登録のすべて） */
  onGenerateReadings?: (ids?: string[]) => void;
  isGeneratingReadings?: boolean;
  /** ゴミ箱を開く */
  onOpenTrash?: () => void;
  /** ゴミ箱に入っているCDの数（ボタンの表示用） */
  trashCount?: number;
  /** 自動バックアップが有効か（ボタンの表示用） */
  backupEnabled?: boolean;
  onOpenManualAdd?: () => void;
  onOpenAITagging?: (selectedCDs: CDMetadata[]) => void;
  onOpenPDFCatalog?: (selectedCDs: CDMetadata[]) => void;
  onBatchUpdateCDs?: (updatedCDs: CDMetadata[]) => Promise<void>;
  initialSearchKeyword?: string;
}

/** 登録ライブラリで既定で表示する列 */
const DEFAULT_VISIBLE_COLUMNS: Record<string, boolean> = {
  index: true,
  jacket: true,
  catalogNumber: true,
  title: true,
  artist: true,
  label: true,
  releaseDate: true,
  vinylRecordReleaseDate: true,
  trackCount: true,
};

export const CDDatabaseTable: React.FC<CDDatabaseTableProps> = ({
  cds,
  onSelectCD,
  onDeleteCD,
  onBatchDeleteCDs,
  onOpenExportModal,
  onOpenImportModal,
  onOpenBackupSettings,
  onOpenTrash,
  onGenerateReadings,
  isGeneratingReadings = false,
  trashCount = 0,
  backupEnabled = false,
  onOpenManualAdd,
  onOpenAITagging,
  onOpenPDFCatalog,
  onBatchUpdateCDs,
  initialSearchKeyword = '',
}) => {
  const [isSpreadsheetMode, setIsSpreadsheetMode] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState(initialSearchKeyword);

  React.useEffect(() => {
    if (initialSearchKeyword !== undefined) {
      setSearchKeyword(initialSearchKeyword);
    }
  }, [initialSearchKeyword]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedTracklistId, setExpandedTracklistId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'catalogNumber' | 'title' | 'artist' | 'label' | 'releaseDate' | 'vinylRecordReleaseDate' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isLookingUpVinylBatch, setIsLookingUpVinylBatch] = useState(false);
  const [vinylBatchProgress, setVinylBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [vinylLookupNotice, setVinylLookupNotice] = useState<string | null>(null);
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);

  // 1. Column Visibility Customization State
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    settingsStore.getJSON<Record<string, boolean>>(STORAGE_KEYS.tableVisibleColumns, DEFAULT_VISIBLE_COLUMNS)
  );
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);

  const toggleColumn = (colId: string) => {
    if (colId === 'title') return;
    setVisibleColumns((prev) => {
      const next = { ...prev, [colId]: !prev[colId] };
      settingsStore.setJSON(STORAGE_KEYS.tableVisibleColumns, next);
      return next;
    });
  };

  const resetColumns = () => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
    settingsStore.setJSON(STORAGE_KEYS.tableVisibleColumns, DEFAULT_VISIBLE_COLUMNS);
  };

  // 2. Table Density (Row Height & Padding) State
  const [tableDensity, setTableDensity] = useState<TableDensity>(() => {
    const stored = settingsStore.getString(STORAGE_KEYS.tableDensity);
    return stored === 'compact' || stored === 'normal' || stored === 'relaxed' ? stored : 'normal';
  });

  const handleSetDensity = (density: TableDensity) => {
    setTableDensity(density);
    settingsStore.setString(STORAGE_KEYS.tableDensity, density);
  };

  const densityConfig = useMemo(() => {
    switch (tableDensity) {
      case 'compact':
        return {
          th: 'py-1 px-2 text-[9px]',
          td: 'py-0.5 px-2 text-[11px]',
          jacket: 'w-6 h-6',
          title: 'text-xs leading-tight',
          badge: 'text-[9px] px-1 py-0',
        };
      case 'relaxed':
        return {
          th: 'py-2.5 px-4 text-[11px]',
          td: 'py-2.5 px-4 text-xs sm:text-sm',
          jacket: 'w-12 h-12',
          title: 'text-sm font-bold leading-normal',
          badge: 'text-xs px-2 py-0.5',
        };
      case 'normal':
      default:
        return {
          th: 'py-2 px-3 text-[10px]',
          td: 'py-1.5 px-3 text-xs',
          jacket: 'w-9 h-9',
          title: 'text-xs leading-snug',
          badge: 'text-[10px] px-1.5 py-0.2',
        };
    }
  }, [tableDensity]);

  // 3. Quick Filter Chip Bar State
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>('all');

  const quickFilterCounts = useMemo(() => {
    return {
      all: cds.length,
      hasVinyl: cds.filter((c) => !!c.vinylRecordReleaseDate).length,
      noTags: cds.filter((c) => !c.tags || c.tags.length === 0).length,
      rated: cds.filter((c) => !!c.rating && c.rating > 0).length,
      decade80: cds.filter(
        (c) =>
          (c.releaseDate && c.releaseDate.startsWith('198')) ||
          (c.tags && c.tags.some((t) => t.includes('80')))
      ).length,
      decade90: cds.filter(
        (c) =>
          (c.releaseDate && c.releaseDate.startsWith('199')) ||
          (c.tags && c.tags.some((t) => t.includes('90')))
      ).length,
      decade00: cds.filter(
        (c) =>
          (c.releaseDate && c.releaseDate.startsWith('200')) ||
          (c.tags && c.tags.some((t) => t.includes('2000') || t.includes('00')))
      ).length,
    };
  }, [cds]);

  // Total visible columns count for colSpan
  const totalVisibleCols = useMemo(() => {
    let count = 1; // checkbox
    if (visibleColumns.index) count++;
    if (visibleColumns.jacket) count++;
    if (visibleColumns.catalogNumber) count++;
    count++; // title is always visible
    if (visibleColumns.artist) count++;
    if (visibleColumns.label) count++;
    if (visibleColumns.releaseDate) count++;
    if (visibleColumns.vinylRecordReleaseDate) count++;
    if (visibleColumns.trackCount) count++;
    return count;
  }, [visibleColumns]);

  // Inline Checkbox Bulk Genre & Custom Tag Update Menu State
  const [isBulkTagMenuOpen, setIsBulkTagMenuOpen] = useState(false);
  const [bulkTagMode, setBulkTagMode] = useState<'add' | 'remove' | 'replace'>('add');
  const [bulkCheckedTags, setBulkCheckedTags] = useState<string[]>([]);
  const [bulkCustomTagInput, setBulkCustomTagInput] = useState('');
  const [bulkTagPresets, setBulkTagPresets] = useState<string[]>(DEFAULT_TAG_PRESETS);
  const [bulkApplyGenre, setBulkApplyGenre] = useState(false);
  const [bulkSelectedGenre, setBulkSelectedGenre] = useState('');
  const [isApplyingBulkTags, setIsApplyingBulkTags] = useState(false);

  useEffect(() => {
    loadTagPresetsDB()
      .then((loaded) => {
        if (Array.isArray(loaded) && loaded.length > 0) {
          setBulkTagPresets(loaded);
        }
      })
      .catch(() => {});
  }, [cds]);

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    type: 'single' | 'batch' | 'all';
    id?: string;
    count: number;
  } | null>(null);

  const totalCount = cds.length;

  // Filter & Sort logic
  const filteredCDs = cds.filter((cd) => {
    const matchesKw = matchesCDSearchQuery(cd, searchKeyword);


    let matchesQuick = true;
    switch (quickFilter) {
      case 'hasVinyl':
        matchesQuick = !!cd.vinylRecordReleaseDate;
        break;
      case 'noTags':
        matchesQuick = !cd.tags || cd.tags.length === 0;
        break;
      case 'rated':
        matchesQuick = !!cd.rating && cd.rating > 0;
        break;
      case 'decade80':
        matchesQuick =
          Boolean(cd.releaseDate && cd.releaseDate.startsWith('198')) ||
          Boolean(cd.tags && cd.tags.some((t) => t.includes('80')));
        break;
      case 'decade90':
        matchesQuick =
          Boolean(cd.releaseDate && cd.releaseDate.startsWith('199')) ||
          Boolean(cd.tags && cd.tags.some((t) => t.includes('90')));
        break;
      case 'decade00':
        matchesQuick =
          Boolean(cd.releaseDate && cd.releaseDate.startsWith('200')) ||
          Boolean(cd.tags && cd.tags.some((t) => t.includes('2000') || t.includes('00')));
        break;
      case 'all':
      default:
        matchesQuick = true;
        break;
    }

    return matchesKw && matchesQuick;
  });

  const handleSort = (field: 'catalogNumber' | 'title' | 'artist' | 'label' | 'releaseDate' | 'vinylRecordReleaseDate') => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortField(null);
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Batch lookup LP / EP vinyl record release dates via API for selected or all filtered CDs
  const handleBatchLookupVinylReleaseDates = async (targetItems: CDMetadata[]) => {
    if (!onBatchUpdateCDs || targetItems.length === 0 || isLookingUpVinylBatch) return;

    setIsLookingUpVinylBatch(true);
    setVinylBatchProgress({ current: 0, total: targetItems.length });
    setVinylLookupNotice(null);

    try {
      const targetMap = new Map(targetItems.map((c) => [c.id, c]));
      const results = await lookupVinylReleasesBatch(
        targetItems.map((c) => ({
          id: c.id,
          title: c.title,
          artist: c.artist,
          catalogNumber: c.catalogNumber,
          releaseDate: c.releaseDate,
        })),
        (current, total) => setVinylBatchProgress({ current, total })
      );

      const updatedCDs: CDMetadata[] = [];
      results.forEach((r) => {
        if (r && r.found && r.vinylRecordReleaseDate) {
          const orig = targetMap.get(r.id);
          if (orig) {
            updatedCDs.push({
              ...orig,
              vinylRecordReleaseDate: r.vinylRecordReleaseDate,
              vinylRecordFormat: r.vinylRecordFormat || orig.vinylRecordFormat || 'LP',
              vinylRecordCatalogNumber: r.vinylRecordCatalogNumber || orig.vinylRecordCatalogNumber,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      });

      if (updatedCDs.length > 0) {
        await onBatchUpdateCDs(updatedCDs);
        setVinylLookupNotice(`${updatedCDs.length} 件のCDについて、同タイトルのLP/EPレコード発売日をAPIから取得・記録しました！`);
      } else {
        setVinylLookupNotice('対象のCDについて、新たにAPIから取得できる同タイトルのLP/EP発売日は見つかりませんでした。');
      }
      setTimeout(() => setVinylLookupNotice(null), 5000);
    } catch (err) {
      log.error('Batch vinyl lookup error:', err);
      setVinylLookupNotice('LP/EPレコード発売日のAPI一括取得中にエラーが発生しました。');
      setTimeout(() => setVinylLookupNotice(null), 4000);
    } finally {
      setIsLookingUpVinylBatch(false);
      setVinylBatchProgress(null);
    }
  };

  const sortedCDs = [...filteredCDs].sort((a, b) => {
    if (!sortField) return 0;
    let result: number;
    if (sortField === 'title') {
      // 読み仮名があれば読みで、なければタイトルで五十音順に並べる
      result = compareSortKeys(sortKeyForTitle(a), sortKeyForTitle(b));
    } else if (sortField === 'artist') {
      result = compareSortKeys(sortKeyForArtist(a), sortKeyForArtist(b));
    } else {
      const valA = (a[sortField] || '').toString().toLowerCase();
      const valB = (b[sortField] || '').toString().toLowerCase();
      result = valA < valB ? -1 : valA > valB ? 1 : 0;
    }
    return sortDirection === 'asc' ? result : -result;
  });

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredCDs.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredCDs.map((c) => c.id));
    }
  };

  const toggleSelectRow = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleDeleteConfirmed = (id: string) => {
    setDeleteConfirmTarget({
      type: 'single',
      id,
      count: 1,
    });
  };

  const handleBatchDeleteConfirmed = () => {
    if (selectedIds.length === 0) return;
    setDeleteConfirmTarget({
      type: 'batch',
      count: selectedIds.length,
    });
  };

  const executeDelete = () => {
    if (!deleteConfirmTarget) return;

    if (deleteConfirmTarget.type === 'single' && deleteConfirmTarget.id) {
      onDeleteCD(deleteConfirmTarget.id);
      setSelectedIds((prev) => prev.filter((i) => i !== deleteConfirmTarget.id));
    } else if (deleteConfirmTarget.type === 'batch') {
      onBatchDeleteCDs(selectedIds);
      setSelectedIds([]);
    } else if (deleteConfirmTarget.type === 'all') {
      const targetIds = filteredCDs.length > 0 ? filteredCDs.map((c) => c.id) : cds.map((c) => c.id);
      onBatchDeleteCDs(targetIds);
      setSelectedIds([]);
    }
    setDeleteConfirmTarget(null);
  };

  const selectedCDs = cds.filter((c) => selectedIds.includes(c.id));

  // Count how many selected CDs already have each tag
  const selectedCDTagCounts = useMemo(() => {
    const map = new Map<string, number>();
    selectedCDs.forEach((cd) => {
      normalizeTagList(cd.tags || [], { preserveCustomName: true }).forEach((t) => {
        map.set(t, (map.get(t) || 0) + 1);
      });
    });
    return map;
  }, [selectedCDs]);

  // All available tags (presets + all tags used in library)
  const allAvailableBulkTags = useMemo(() => {
    const set = new Set<string>(bulkTagPresets);
    cds.forEach((cd) => {
      normalizeTagList(cd.tags || [], { preserveCustomName: true }).forEach((t) => set.add(t));
    });
    return Array.from(set);
  }, [cds, bulkTagPresets]);

  const toggleBulkTagCheckbox = (rawTag: string) => {
    const norm = normalizeSingleTag(rawTag, { preserveCustomName: true });
    if (!norm) return;
    setBulkCheckedTags((prev) =>
      prev.includes(norm) ? prev.filter((t) => t !== norm) : [...prev, norm]
    );
  };

  const handleAddBulkCustomTagToMenu = () => {
    if (!bulkCustomTagInput.trim()) return;
    const parsed = normalizeTagList(
      bulkCustomTagInput
        .split(/[,、]/)
        .map((t) => t.trim())
        .filter(Boolean),
      { preserveCustomName: true }
    );
    if (parsed.length === 0) return;

    const nextPresets = Array.from(new Set([...parsed, ...bulkTagPresets]));
    setBulkTagPresets(nextPresets);
    saveTagPresetsDB(nextPresets);

    setBulkCheckedTags((prev) => {
      const next = [...prev];
      parsed.forEach((t) => {
        if (!next.includes(t)) next.push(t);
      });
      return next;
    });
    setBulkCustomTagInput('');
  };

  const handleExecuteInlineBulkTagUpdate = async () => {
    if (!onBatchUpdateCDs || selectedCDs.length === 0 || isApplyingBulkTags) return;

    const pendingCustom = bulkCustomTagInput.trim()
      ? normalizeTagList(
          bulkCustomTagInput
            .split(/[,、]/)
            .map((t) => t.trim())
            .filter(Boolean),
          { preserveCustomName: true }
        )
      : [];
    const targetTags = normalizeTagList([...bulkCheckedTags, ...pendingCustom], {
      preserveCustomName: true,
    });

    if (pendingCustom.length > 0) {
      const nextPresets = Array.from(new Set([...pendingCustom, ...bulkTagPresets]));
      setBulkTagPresets(nextPresets);
      saveTagPresetsDB(nextPresets);
      setBulkCustomTagInput('');
    }

    if (!bulkApplyGenre && targetTags.length === 0 && bulkTagMode !== 'replace') {
      return;
    }

    setIsApplyingBulkTags(true);
    try {
      const nowIso = new Date().toISOString();
      const updatedList: CDMetadata[] = selectedCDs.map((cd) => {
        const currentTags = normalizeTagList(cd.tags || [], { preserveCustomName: true });
        let nextTags = [...currentTags];

        if (bulkTagMode === 'add' && targetTags.length > 0) {
          nextTags = normalizeTagList([...currentTags, ...targetTags], { preserveCustomName: true });
        } else if (bulkTagMode === 'remove' && targetTags.length > 0) {
          const removeSet = new Set(targetTags);
          nextTags = currentTags.filter((t) => !removeSet.has(t));
        } else if (bulkTagMode === 'replace') {
          nextTags = [...targetTags];
        }

        let nextGenre = cd.genre ? normalizeSingleTag(cd.genre, { preserveCustomName: true }) : cd.genre;
        if (bulkApplyGenre) {
          nextGenre = bulkSelectedGenre.trim()
            ? normalizeSingleTag(bulkSelectedGenre.trim(), { preserveCustomName: true })
            : '';
          if (nextGenre && !nextTags.includes(nextGenre)) {
            nextTags = normalizeTagList([nextGenre, ...nextTags], { preserveCustomName: true });
          }
        } else if (bulkTagMode === 'remove' && nextGenre && targetTags.includes(nextGenre)) {
          nextGenre =
            nextTags.find((t) => !/^(19\d0|20\d0|[56789]0)年代$/.test(t) && t !== '邦楽') ||
            nextTags[0] ||
            '';
        } else if (bulkTagMode === 'replace') {
          nextGenre =
            nextTags.find((t) => !/^(19\d0|20\d0|[56789]0)年代$/.test(t) && t !== '邦楽') ||
            nextTags[0] ||
            nextGenre;
        }

        return normalizeCDTagsAndGenre(
          {
            ...cd,
            tags: nextTags,
            genre: nextGenre,
            updatedAt: nowIso,
          },
          { preserveUserTags: true }
        );
      });

      await onBatchUpdateCDs(updatedList);
      setVinylLookupNotice(
        `選択した ${updatedList.length} 件のCDにジャンル・カスタムタグを一括適用しました！`
      );
      setTimeout(() => setVinylLookupNotice(null), 4000);
      setBulkCheckedTags([]);
    } finally {
      setIsApplyingBulkTags(false);
    }
  };

  // If Spreadsheet Mode is active, render SpreadsheetEditorView
  if (isSpreadsheetMode && onBatchUpdateCDs) {
    return (
      <SpreadsheetEditorView
        cds={cds}
        onBatchUpdateCDs={onBatchUpdateCDs}
        onBatchDeleteCDs={onBatchDeleteCDs}
        onClose={() => setIsSpreadsheetMode(false)}
        onSelectCD={onSelectCD}
      />
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-125px)] space-y-2 pb-1">
      
      {/* 1. Control Bar (Fixed at top): 検索窓とボタンを常に一列で表示。幅が約1800px未満のときはボタンの文字を隠してアイコンのみにする（ツールチップで名前を確認できる） */}
      <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 px-3 py-2 shadow-xl flex flex-row flex-nowrap items-center justify-between gap-2 flex-shrink-0">
        
        {/* Title, Search Input & Synced Filter */}
        <div className="flex items-center gap-2 flex-nowrap flex-shrink-0">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 ring-1 ring-white/20 flex-shrink-0">
              <Database className="w-3.5 h-3.5" />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1">
                <h2 className="text-xs sm:text-sm font-extrabold text-white tracking-tight whitespace-nowrap">
                  登録ライブラリ
                </h2>
                <span className="text-[10px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 rounded-full whitespace-nowrap">
                  {filteredCDs.length}/{cds.length}件
                </span>
              </div>
              <p className="text-[9px] text-slate-400 whitespace-nowrap hidden 2xl:block">
                登録CD一覧・一括編集・バックアップ
              </p>
            </div>
          </div>

          <div className="relative w-40 lg:w-48 xl:w-52 flex-shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="型番、タイトル、歌手名、曲名、タグ..."
              className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl py-1 pl-7 pr-6 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all shadow-inner"
            />
            {searchKeyword && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="absolute right-1.5 top-1 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-slate-800 transition-colors"
                title="検索条件をクリア"
              >
                ✕
              </button>
            )}
          </div>

        </div>

        {/* Action Buttons (Single Row) */}
        <div className="flex flex-nowrap items-center gap-1 justify-end flex-shrink-0">
          {onBatchUpdateCDs && (
            <button
              type="button"
              onClick={() => setIsSpreadsheetMode(!isSpreadsheetMode)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer border shadow-sm flex-shrink-0 ${
                isSpreadsheetMode
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 ring-2 ring-emerald-500/50 shadow-emerald-900/40'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700 hover:border-slate-600'
              }`}
              title="Excel・スプレッドシート形式で直接セル入力・一括編集"
            >
              <Table className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span className="hidden min-[1800px]:inline">{isSpreadsheetMode ? '通常テーブル' : 'スプレッドシート'}</span>
            </button>
          )}

          {onOpenManualAdd && (
            <button
              onClick={onOpenManualAdd}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/30 border border-indigo-400/30 transition-all cursor-pointer flex-shrink-0"
              title="新しいCDを手動で追加登録"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden min-[1800px]:inline">CD登録</span>
            </button>
          )}

          {onBatchUpdateCDs && (
            <button
              type="button"
              onClick={() => handleBatchLookupVinylReleaseDates(selectedIds.length > 0 ? selectedCDs : filteredCDs)}
              disabled={isLookingUpVinylBatch || filteredCDs.length === 0}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-amber-950/90 hover:bg-amber-900 text-amber-200 border border-amber-500/40 hover:border-amber-400 transition-all cursor-pointer shadow-sm disabled:opacity-50 flex-shrink-0"
              title="登録しているCDに同タイトルのLP・EPレコードがある場合、API（MusicBrainz・Discogs・NDL・Gemini）からLP/EP発売年月日を一括取得します"
            >
              {isLookingUpVinylBatch ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300 flex-shrink-0" />
              ) : (
                <Disc className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              )}
              <span className={isLookingUpVinylBatch ? '' : 'hidden min-[1800px]:inline'}>
                {isLookingUpVinylBatch
                  ? `LP/EP取得中 (${vinylBatchProgress?.current || 0}/${vinylBatchProgress?.total || 0})`
                  : selectedIds.length > 0
                  ? `LP/EP発売日API取得 (${selectedIds.length})`
                  : 'LP/EP発売日API一括取得'}
              </span>
            </button>
          )}

          {onBatchUpdateCDs && selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setIsBulkTagMenuOpen((prev) => !prev)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/30 border border-indigo-400/40 transition-all cursor-pointer flex-shrink-0"
              title="選択したCDに対してジャンルやカスタムタグをチェックボックスで一括適用"
            >
              <CheckSquare className="w-3.5 h-3.5 text-indigo-100 flex-shrink-0" />
              <span><span className="hidden min-[1800px]:inline">ジャンル・タグ一括 </span>({selectedIds.length})</span>
            </button>
          )}

          {onOpenAITagging && (
            <button
              onClick={() => onOpenAITagging(selectedCDs)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-700 hover:from-purple-500 hover:to-indigo-600 text-white shadow-md shadow-purple-900/30 border border-purple-400/30 transition-all cursor-pointer flex-shrink-0"
              title="Gemini AIでジャンル・雰囲気・年代を自動分析しタグを一括付与"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-200 flex-shrink-0" />
              <span><span className="hidden min-[1800px]:inline">{selectedIds.length > 0 ? 'AIタグ付け ' : 'AI自動タグ付け'}</span>{selectedIds.length > 0 ? `(${selectedIds.length})` : ''}</span>
            </button>
          )}

          {onOpenPDFCatalog && (
            <button
              type="button"
              onClick={() => onOpenPDFCatalog(selectedIds.length > 0 ? selectedCDs : cds)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-md shadow-amber-900/30 border border-amber-400/40 transition-all cursor-pointer flex-shrink-0"
              title="印刷用CDカタログ・LPアナログジャケット風ライナーノーツ・CDケース差し込みカードのPDF出力"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-100 flex-shrink-0" />
              <span className="hidden min-[1800px]:inline">PDFカタログ出力</span>
            </button>
          )}

          <button
            onClick={() => onOpenExportModal(selectedIds.length > 0 ? selectedCDs : cds)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30 transition-all cursor-pointer border border-emerald-500/40 flex-shrink-0"
            title="JSON・Excel・CSVの書き出し・読み込み（バックアップ・復元）"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-100 flex-shrink-0" />
            <span className="hidden min-[1800px]:inline">書き出し・読み込み</span>
            <span className="hidden min-[1800px]:inline text-[10px] bg-emerald-950/80 text-emerald-200 px-1.5 py-0.2 rounded-full border border-emerald-400/40 font-mono font-bold">
              {selectedIds.length > 0 ? selectedIds.length : cds.length}
            </span>
          </button>

          {onGenerateReadings && (
            <button
              type="button"
              disabled={isGeneratingReadings}
              onClick={() => onGenerateReadings(selectedIds.length > 0 ? selectedIds : undefined)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-slate-800 hover:bg-slate-700 text-slate-100 shadow transition-all cursor-pointer border border-slate-600/60 flex-shrink-0 disabled:opacity-60 disabled:cursor-wait"
              title="漢字を含むタイトル・歌手名の読み仮名（ひらがな）をAIで推定します。五十音順の並べ替えに使います。選択中のCDがあれば選択分のみ"
            >
              {isGeneratingReadings ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              ) : (
                <Languages className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
              )}
              <span className="hidden min-[1800px]:inline">
                {selectedIds.length > 0 ? `読み仮名生成 (${selectedIds.length})` : '読み仮名生成'}
              </span>
            </button>
          )}

          {onOpenTrash && (
            <button
              type="button"
              onClick={onOpenTrash}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-slate-800 hover:bg-slate-700 text-slate-100 shadow transition-all cursor-pointer border border-slate-600/60 flex-shrink-0"
              title={`ゴミ箱（削除したCDを元に戻せます。${trashCount}件）`}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-300 flex-shrink-0" />
              <span className="hidden min-[1800px]:inline">ゴミ箱</span>
              {trashCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full border font-mono font-bold bg-rose-950/80 text-rose-200 border-rose-400/40">
                  {trashCount}
                </span>
              )}
            </button>
          )}

          {onOpenBackupSettings && (
            <button
              type="button"
              onClick={onOpenBackupSettings}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-slate-800 hover:bg-slate-700 text-slate-100 shadow transition-all cursor-pointer border border-slate-600/60 flex-shrink-0"
              title="JSONの自動バックアップの設定・復元"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />
              <span className="hidden min-[1800px]:inline">自動バックアップ</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full border font-mono font-bold ${
                  backupEnabled
                    ? 'bg-emerald-950/80 text-emerald-200 border-emerald-400/40'
                    : 'bg-slate-900 text-slate-400 border-slate-600/60'
                }`}
              >
                {backupEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* Density 3-way Switcher */}
          <div className="flex items-center p-0.5 bg-slate-900/90 rounded-xl border border-slate-700/80 text-[10px] font-bold flex-shrink-0 shadow-inner" title="表示密度（行の高さ・余白）を切り替え">
            <button
              type="button"
              onClick={() => handleSetDensity('compact')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                tableDensity === 'compact'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="極小（高密度・Excel風一覧性重視）"
            >
              極小
            </button>
            <button
              type="button"
              onClick={() => handleSetDensity('normal')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                tableDensity === 'normal'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="標準"
            >
              標準
            </button>
            <button
              type="button"
              onClick={() => handleSetDensity('relaxed')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                tableDensity === 'relaxed'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="ゆったり（ジャケット・文字が大きめ）"
            >
              ゆったり
            </button>
          </div>

          {/* Column Visibility Selector Popover */}
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setIsColumnMenuOpen((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer border shadow-sm ${
                isColumnMenuOpen
                  ? 'bg-indigo-600 text-white border-indigo-400 ring-2 ring-indigo-400/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
              }`}
              title="テーブルの表示項目（列）をカスタマイズ"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
              <span className="hidden min-[1800px]:inline">表示列</span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-slate-900 text-indigo-300 border border-slate-700">
                {Object.values(visibleColumns).filter(Boolean).length}/{AVAILABLE_TABLE_COLUMNS.length}
              </span>
            </button>

            {/* 表示項目の選択: JSON自動バックアップと同じ、画面中央のモーダル（背景クリック・Escで閉じる） */}
            {isColumnMenuOpen && (
              <Modal
                title="表示項目の選択"
                subtitle={`登録ライブラリに表示する列を選びます（${Object.values(visibleColumns).filter(Boolean).length}/${AVAILABLE_TABLE_COLUMNS.length}列を表示中）`}
                icon={<LayoutGrid className="w-6 h-6 text-indigo-400" />}
                iconBoxClassName="bg-indigo-600/20 border-indigo-500/40"
                widthClassName="max-w-md"
                onClose={() => setIsColumnMenuOpen(false)}
              >
                <div className="p-6 space-y-3 overflow-y-auto">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-300">表示する列</p>
                    <button
                      type="button"
                      onClick={resetColumns}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
                    >
                      全列表示
                    </button>
                  </div>
                  <div className="space-y-1">
                    {AVAILABLE_TABLE_COLUMNS.map((col) => (
                      <label
                        key={col.id}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm cursor-pointer select-none transition-colors border ${
                          visibleColumns[col.id]
                            ? 'bg-slate-950/70 border-slate-700 text-white font-medium'
                            : 'border-transparent text-slate-400 hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={visibleColumns[col.id]}
                            disabled={!col.canHide}
                            onChange={() => toggleColumn(col.id)}
                            className="rounded border-slate-600 accent-indigo-500 w-4 h-4 cursor-pointer"
                          />
                          <span>{col.label}</span>
                        </div>
                        {!col.canHide && <span className="text-[10px] text-slate-500 font-mono">固定</span>}
                      </label>
                    ))}
                  </div>
                </div>
              </Modal>
            )}
          </div>
        </div>

      </div>

      {/* Quick Filter Chip Bar (Item 6) */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 px-1 flex-shrink-0 text-xs">
        <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap flex items-center gap-1 mr-1">
          <Filter className="w-3 h-3 text-indigo-400" />
          <span>クイック絞り込み:</span>
        </span>

        {[
          { id: 'all', label: 'すべて', count: quickFilterCounts.all },
          { id: 'hasVinyl', label: 'LP/EP発売日あり', count: quickFilterCounts.hasVinyl },
          { id: 'noTags', label: 'タグ未設定', count: quickFilterCounts.noTags },
          { id: 'rated', label: '高評価★', count: quickFilterCounts.rated },
          { id: 'decade80', label: '80年代', count: quickFilterCounts.decade80 },
          { id: 'decade90', label: '90年代', count: quickFilterCounts.decade90 },
          { id: 'decade00', label: '2000年代', count: quickFilterCounts.decade00 },
        ].map((chip) => {
          const isActive = quickFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setQuickFilter(chip.id as QuickFilterType)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer border ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                  : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700/80 hover:text-white'
              }`}
            >
              <span>{chip.label}</span>
              <span className={`text-[10px] font-mono px-1 rounded-full ${
                isActive ? 'bg-indigo-950 text-indigo-200' : 'bg-slate-900 text-slate-400'
              }`}>
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* LP/EP Vinyl Release Date API Lookup Notification Banner */}
      {vinylLookupNotice && (
        <div className="bg-amber-950/90 border border-amber-500/50 p-2.5 px-4 rounded-xl text-amber-200 text-xs flex items-center justify-between gap-2 shadow-lg animate-in fade-in duration-150 flex-shrink-0">
          <div className="flex items-center gap-2 font-semibold">
            <Disc className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{vinylLookupNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setVinylLookupNotice(null)}
            className="text-amber-300 hover:text-white text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. Database Table View (Fixed Header + Scrollable Rows) */}
      {filteredCDs.length > 0 ? (
        <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 shadow-xl flex-1 min-h-0 flex flex-col overflow-hidden">
          
          {/* Scrollable Container with Sticky Table Header */}
          <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="sticky top-0 z-20 bg-slate-900 text-slate-400 uppercase tracking-wider border-b border-slate-700 select-none shadow-md">
                <tr>
                  <th className={`${densityConfig.th} w-10 text-center whitespace-nowrap bg-slate-900`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.length === filteredCDs.length && filteredCDs.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  
                  {visibleColumns.index && (
                    <th className={`${densityConfig.th} w-12 text-center font-mono text-slate-400 whitespace-nowrap bg-slate-900`}>No.</th>
                  )}

                  {visibleColumns.jacket && (
                    <th className={`${densityConfig.th} w-14 text-center whitespace-nowrap bg-slate-900`}>ジャケット</th>
                  )}

                  {visibleColumns.catalogNumber && (
                    <th
                      onClick={() => handleSort('catalogNumber')}
                      className={`${densityConfig.th} w-32 cursor-pointer hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap bg-slate-900`}
                      title="型番で並べ替え"
                    >
                      <div className="flex items-center gap-1">
                        <span>型番 (規格品番)</span>
                        <span className={`text-[10px] font-bold ${sortField === 'catalogNumber' ? 'text-indigo-400' : 'text-slate-600'}`}>
                          {sortField === 'catalogNumber' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                  )}

                  {/* Sortable Column: Title (Always visible) */}
                  <th
                    onClick={() => handleSort('title')}
                    className={`${densityConfig.th} min-w-[260px] cursor-pointer hover:text-white hover:bg-slate-800 transition-colors bg-slate-900`}
                    title="CDタイトルで並べ替え"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>CDタイトル</span>
                      <span className={`text-[10px] font-bold ${sortField === 'title' ? 'text-indigo-400' : 'text-slate-600'}`}>
                        {sortField === 'title' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  {visibleColumns.artist && (
                    <th
                      onClick={() => handleSort('artist')}
                      className={`${densityConfig.th} min-w-[160px] cursor-pointer hover:text-white hover:bg-slate-800 transition-colors bg-slate-900`}
                      title="歌手 / アーティストで並べ替え"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>歌手 / アーティスト</span>
                        <span className={`text-[10px] font-bold ${sortField === 'artist' ? 'text-indigo-400' : 'text-slate-600'}`}>
                          {sortField === 'artist' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                  )}

                  {visibleColumns.label && (
                    <th
                      onClick={() => handleSort('label')}
                      className={`${densityConfig.th} min-w-[130px] cursor-pointer hover:text-white hover:bg-slate-800 transition-colors bg-slate-900`}
                      title="レーベルで並べ替え"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>レーベル</span>
                        <span className={`text-[10px] font-bold ${sortField === 'label' ? 'text-indigo-400' : 'text-slate-600'}`}>
                          {sortField === 'label' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                  )}

                  {visibleColumns.releaseDate && (
                    <th
                      onClick={() => handleSort('releaseDate')}
                      className={`${densityConfig.th} w-28 cursor-pointer hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap bg-slate-900`}
                      title="CD発売年月日などで並べ替え"
                    >
                      <div className="flex items-center gap-1">
                        <span>CD発売年月日</span>
                        <span className={`text-[10px] font-bold ${sortField === 'releaseDate' ? 'text-indigo-400' : 'text-slate-600'}`}>
                          {sortField === 'releaseDate' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                  )}

                  {visibleColumns.vinylRecordReleaseDate && (
                    <th
                      onClick={() => handleSort('vinylRecordReleaseDate')}
                      className={`${densityConfig.th} w-36 cursor-pointer hover:text-amber-200 hover:bg-slate-800 transition-colors whitespace-nowrap bg-slate-900 text-amber-300/90`}
                      title="同タイトルのLP・EPレコード発売年月日で並べ替え"
                    >
                      <div className="flex items-center gap-1">
                        <span>LP/EP発売年月日</span>
                        <span className={`text-[10px] font-bold ${sortField === 'vinylRecordReleaseDate' ? 'text-amber-400' : 'text-slate-600'}`}>
                          {sortField === 'vinylRecordReleaseDate' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                  )}

                  {visibleColumns.trackCount && (
                    <th className={`${densityConfig.th} text-center whitespace-nowrap bg-slate-900`}>収録曲</th>
                  )}

                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {sortedCDs.map((cd, index) => {
                  const isChecked = selectedIds.includes(cd.id);
                  const isExpanded = expandedTracklistId === cd.id;

                  return (
                    <React.Fragment key={cd.id}>
                      <tr className={`hover:bg-slate-700/30 transition-colors ${isChecked ? 'bg-indigo-950/20' : ''}`}>
                        <td className={`${densityConfig.td} text-center`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectRow(cd.id)}
                            className="rounded border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                          />
                        </td>

                        {visibleColumns.index && (
                          <td className={`${densityConfig.td} text-center font-mono font-bold text-slate-300 whitespace-nowrap`}>
                            <span className="bg-slate-900/90 border border-slate-700 text-indigo-300 px-1.5 py-0.2 rounded-md font-mono text-[10px] shadow-xs">
                              #{index + 1}
                            </span>
                          </td>
                        )}

                        {visibleColumns.jacket && (
                          <td className={`${densityConfig.td} text-center`}>
                            <div
                              onClick={() => onSelectCD(cd, sortedCDs)}
                              className={`${densityConfig.jacket} rounded-lg bg-slate-900 overflow-hidden border border-slate-700 mx-auto flex items-center justify-center cursor-pointer hover:border-indigo-400 transition-colors flex-shrink-0`}
                              title="クリックして詳細・曲順を確認"
                            >
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
                                <Disc className="w-3.5 h-3.5 text-slate-600" />
                              )}
                            </div>
                          </td>
                        )}

                        {visibleColumns.catalogNumber && (
                          <td className={`${densityConfig.td} font-mono font-bold text-indigo-300 whitespace-nowrap`}>
                            {cd.catalogNumber || '-'}
                          </td>
                        )}

                        {/* Title (Always visible) */}
                        <td className={`${densityConfig.td} max-w-[280px]`}>
                          <button
                            type="button"
                            onClick={() => onSelectCD(cd, sortedCDs)}
                            className={`text-left font-bold text-white hover:text-indigo-300 hover:underline transition-colors block truncate w-full cursor-pointer focus:outline-none ${densityConfig.title}`}
                            title={`「${cd.title}」をクリックして詳細・曲順を編集`}
                          >
                            {!!cd.rating && cd.rating > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-400 bg-amber-950/70 border border-amber-500/40 px-1.5 py-0.2 rounded-full mr-1.5 shadow-2xs font-mono">
                                ★{cd.rating}
                              </span>
                            )}
                            {cd.title}
                          </button>
                          {searchKeyword.trim() && (() => {
                            const matchedTrs = getMatchedTracksForQuery(cd, searchKeyword);
                            if (matchedTrs.length === 0) return null;
                            return (
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {matchedTrs.slice(0, 2).map((tr, mIdx) => (
                                  <span
                                    key={mIdx}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedTracklistId(isExpanded ? null : cd.id);
                                    }}
                                    className="text-[10px] font-bold bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 px-1.5 py-0 rounded inline-flex items-center gap-1 cursor-pointer leading-tight"
                                    title="クリックしてトラックリストを展開"
                                  >
                                    <Music className="w-2.5 h-2.5 text-emerald-400" />
                                    <span>Tr.{tr.trackNumber} {tr.title}</span>
                                  </span>
                                ))}
                                {matchedTrs.length > 2 && (
                                  <span className="text-[10px] text-emerald-400 font-mono">
                                    +{matchedTrs.length - 2}曲一致
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                          {cd.tags && cd.tags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap mt-0.5">
                              {cd.tags.slice(0, 5).map((t, idx) => (
                                <span
                                  key={idx}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSearchKeyword(`#${t}`);
                                  }}
                                  className="text-[10px] bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 px-1.5 py-0 rounded cursor-pointer transition-colors leading-tight"
                                  title={`タグ「${t}」で絞り込み`}
                                >
                                  #{t}
                                </span>
                              ))}
                              {cd.tags.length > 5 && (
                                <span className="text-[10px] text-slate-500 font-mono">+{cd.tags.length - 5}</span>
                              )}
                            </div>
                          )}
                        </td>

                        {visibleColumns.artist && (
                          <td className={`${densityConfig.td} font-medium text-slate-200 max-w-[160px] truncate`} title={cd.artist}>
                            {cd.artist}
                          </td>
                        )}

                        {visibleColumns.label && (
                          <td className={`${densityConfig.td} text-slate-400 max-w-[120px] truncate`}>
                            {cd.label || '-'}
                          </td>
                        )}

                        {visibleColumns.releaseDate && (
                          <td className={`${densityConfig.td} text-slate-400 font-mono whitespace-nowrap`}>
                            {cd.releaseDate || '-'}
                          </td>
                        )}

                        {visibleColumns.vinylRecordReleaseDate && (
                          <td className={`${densityConfig.td} font-mono whitespace-nowrap`}>
                            {cd.vinylRecordReleaseDate ? (
                              <div className="flex flex-col leading-tight">
                                <span className="text-amber-300 font-bold text-xs">
                                  {cd.vinylRecordReleaseDate}
                                </span>
                                <span className="text-[10px] text-amber-400/80">
                                  {cd.vinylRecordFormat || 'LP'}
                                  {cd.vinylRecordCatalogNumber ? ` (${cd.vinylRecordCatalogNumber})` : ''}
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-600 text-[11px]">-</span>
                            )}
                          </td>
                        )}

                        {visibleColumns.trackCount && (
                          <td className={`${densityConfig.td} text-center`}>
                            <button
                              onClick={() => setExpandedTracklistId(isExpanded ? null : cd.id)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 text-indigo-300 border border-slate-700 hover:border-indigo-500 text-[11px] cursor-pointer"
                            >
                              <Music className="w-3 h-3" />
                              {cd.tracks ? cd.tracks.length : 0}曲
                            </button>
                          </td>
                        )}

                      </tr>
                      
                      {/* Expandable Tracklist Drawer */}
                      {isExpanded && cd.tracks && cd.tracks.length > 0 && (
                        <tr className="bg-slate-900/60 border-b border-slate-800">
                          <td colSpan={totalVisibleCols} className="py-3 px-6">
                            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 max-h-48 overflow-y-auto">
                              <p className="text-[11px] font-bold text-slate-400 mb-2">トラックリスト ({cd.tracks.length}曲):</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-300 font-mono">
                                {cd.tracks.map((t) => (
                                  <div key={t.trackNumber} className="truncate flex items-center gap-2">
                                    <span className="text-slate-500 w-5">{t.trackNumber}.</span>
                                    <span className="truncate flex-1">{t.title}</span>
                                    {t.duration && <span className="text-slate-500 text-[10px]">({t.duration})</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom Table Summary Counter (Fixed at bottom of table card) */}
          <div className="px-4 py-2 bg-slate-900/90 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between flex-shrink-0">
            <div>
              表示中: <span className="font-bold text-white font-mono">{filteredCDs.length}</span> / 全 {cds.length} 枚
            </div>
            {selectedIds.length > 0 && (
              <div className="text-indigo-300 font-bold">
                {selectedIds.length} 件選択中
              </div>
            )}
          </div>

        </div>
      ) : (
        <div className="bg-slate-800/40 rounded-2xl border border-slate-700/60 p-12 text-center text-slate-400 space-y-4">
          <Disc className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <div>
            <h3 className="text-base font-semibold text-slate-300">データベースに登録されたCDがありません</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              「Web検索・メタデータ取得」からCDを追加するか、バックアップファイル（JSON / Excel / CSV）からインポートしてください。
            </p>
          </div>
          {onOpenImportModal && (
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onOpenImportModal}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>バックアップファイルからインポート</span>
              </button>
            </div>
          )}
        </div>
      )}

      
      {/* 4. Smart Floating Action Dock for Selected CDs (Item 4) */}
      {selectedIds.length > 0 && (
        <>
          {/* Backdrop for floating bulk tag menu */}
          {isBulkTagMenuOpen && onBatchUpdateCDs && (
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
              onClick={() => setIsBulkTagMenuOpen(false)}
            />
          )}

          {/* Floating Checkbox-based Genre & Custom Tag Bulk Update Popover */}
          {isBulkTagMenuOpen && onBatchUpdateCDs && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[95vw] max-w-4xl bg-slate-900/98 backdrop-blur-xl border border-indigo-500/60 rounded-2xl shadow-2xl overflow-hidden p-4 space-y-3 max-h-[72vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                    <CheckSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white">
                      ジャンル・カスタムタグ一括更新メニュー（{selectedCDs.length}枚選択中）
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsBulkTagMenuOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  title="メニューを閉じる"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Row 1: Operation Mode & Main Genre Checkbox Selector */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {/* Left: Tag Operation Mode & Custom Tag Input */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-indigo-200 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-indigo-400" />
                      <span>1. カスタムタグ・属性タグの一括操作モード</span>
                    </span>

                    <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setBulkTagMode('add')}
                        className={`px-2 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1 ${
                          bulkTagMode === 'add'
                            ? 'bg-indigo-600 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Plus className="w-3 h-3" />
                        <span>チェックしたタグを追加</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkTagMode('remove')}
                        className={`px-2 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1 ${
                          bulkTagMode === 'remove'
                            ? 'bg-rose-600 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>チェックしたタグを削除</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkTagMode('replace')}
                        className={`px-2 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1 ${
                          bulkTagMode === 'replace'
                            ? 'bg-amber-600 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>すべて置換</span>
                      </button>
                    </div>
                  </div>

                  {/* Add New Custom Tag Input */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={bulkCustomTagInput}
                      onChange={(e) => setBulkCustomTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddBulkCustomTagToMenu();
                        }
                      }}
                      placeholder="新しいカスタムタグ名を入力（カンマ区切りで複数可: 例 80年代アイドル, 紙ジャケ, 初回盤）..."
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddBulkCustomTagToMenu}
                      disabled={!bulkCustomTagInput.trim()}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>追加してチェック</span>
                    </button>
                  </div>
                </div>

                {/* Right: Main Genre Checkbox Selection */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 font-bold text-amber-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={bulkApplyGenre}
                        onChange={(e) => setBulkApplyGenre(e.target.checked)}
                        className="rounded border-slate-700 text-amber-500 focus:ring-0"
                      />
                      <Music className="w-3.5 h-3.5 text-amber-400" />
                      <span>2. メインジャンル（Genre）も一括設定する</span>
                    </label>

                    <input
                      type="text"
                      value={bulkSelectedGenre}
                      onChange={(e) => {
                        setBulkSelectedGenre(e.target.value);
                        if (e.target.value.trim()) setBulkApplyGenre(true);
                      }}
                      placeholder="自由入力または下のジャンルをチェック..."
                      className="w-52 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  {/* Genre Checkboxes */}
                  <div className="flex items-center gap-1.5 flex-wrap max-h-20 overflow-y-auto pt-0.5">
                    {QUICK_GENRE_OPTIONS.map((gOpt) => {
                      const isGenreChecked = bulkApplyGenre && bulkSelectedGenre === gOpt;
                      return (
                        <button
                          key={gOpt}
                          type="button"
                          onClick={() => {
                            if (isGenreChecked) {
                              setBulkSelectedGenre('');
                              setBulkApplyGenre(false);
                            } else {
                              setBulkSelectedGenre(gOpt);
                              setBulkApplyGenre(true);
                              if (bulkTagMode === 'add' && !bulkCheckedTags.includes(gOpt)) {
                                setBulkCheckedTags((prev) => [...prev, gOpt]);
                              }
                            }
                          }}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer flex items-center gap-1 ${
                            isGenreChecked
                              ? 'bg-amber-600 text-white border-amber-400 shadow-sm font-bold'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
                          }`}
                        >
                          {isGenreChecked ? (
                            <CheckSquare className="w-3 h-3 text-white flex-shrink-0" />
                          ) : (
                            <Square className="w-3 h-3 text-slate-500 flex-shrink-0" />
                          )}
                          <span>{gOpt}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Row 2: Custom & Preset Tags Checkbox Grid */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-bold text-slate-300">
                    チェックボックスで適用するタグを選択（複数チェック可 / 右の数字は選択中 {selectedCDs.length} 枚のうち現在付与済みの枚数）:
                  </span>
                  {bulkCheckedTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBulkCheckedTags([])}
                      className="text-[11px] text-indigo-300 hover:text-white font-semibold cursor-pointer"
                    >
                      チェックをすべて解除 ({bulkCheckedTags.length}個選択中)
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1.5 max-h-36 overflow-y-auto p-1">
                  {allAvailableBulkTags.map((tag) => {
                    const isChecked = bulkCheckedTags.includes(tag);
                    const existingCount = selectedCDTagCounts.get(tag) || 0;
                    return (
                      <label
                        key={tag}
                        onClick={(e) => {
                          e.preventDefault();
                          toggleBulkTagCheckbox(tag);
                        }}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer flex items-center justify-between gap-1 select-none ${
                          isChecked
                            ? bulkTagMode === 'remove'
                              ? 'bg-rose-600 text-white border-rose-400 shadow-sm font-bold'
                              : 'bg-indigo-600 text-white border-indigo-400 shadow-sm font-bold'
                            : existingCount > 0
                            ? 'bg-slate-900/90 hover:bg-slate-800 text-indigo-200 border-indigo-500/30'
                            : 'bg-slate-900/60 hover:bg-slate-800 text-slate-300 border-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded border-slate-600 text-indigo-600 focus:ring-0 pointer-events-none w-3.5 h-3.5 flex-shrink-0"
                          />
                          <span className="truncate">#{tag}</span>
                        </div>
                        {existingCount > 0 && (
                          <span
                            className={`text-[9px] font-mono px-1 rounded flex-shrink-0 ${
                              isChecked
                                ? 'bg-black/30 text-white'
                                : 'bg-indigo-950 text-indigo-300 border border-indigo-500/30'
                            }`}
                            title={`選択中 ${selectedCDs.length} 枚中 ${existingCount} 枚に付与済み`}
                          >
                            {existingCount}/{selectedCDs.length}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Row 3: Summary & Execute Action Bar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-300">
                  <span>適用内容プレビュー:</span>
                  {bulkApplyGenre && (
                    <span className="bg-amber-950 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-md font-bold">
                      ジャンル: {bulkSelectedGenre || '(空欄にクリア)'}
                    </span>
                  )}
                  {bulkCheckedTags.length > 0 ? (
                    <span
                      className={`px-2 py-0.5 rounded-md font-bold border ${
                        bulkTagMode === 'remove'
                          ? 'bg-rose-950 text-rose-300 border-rose-500/40'
                          : 'bg-indigo-950 text-indigo-200 border-indigo-500/40'
                      }`}
                    >
                      {bulkTagMode === 'add'
                        ? '追加タグ'
                        : bulkTagMode === 'remove'
                        ? '削除タグ'
                        : '置換タグ'}
                      : {bulkCheckedTags.map((t) => `#${t}`).join(', ')}
                    </span>
                  ) : (
                    !bulkApplyGenre && (
                      <span className="text-slate-500">
                        上のチェックボックスから適用したいジャンルまたはカスタムタグにチェックを入れてください
                      </span>
                    )
                  )}
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() => setIsBulkTagMenuOpen(false)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    メニューを閉じる
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteInlineBulkTagUpdate}
                    disabled={
                      isApplyingBulkTags ||
                      (!bulkApplyGenre &&
                        bulkCheckedTags.length === 0 &&
                        !bulkCustomTagInput.trim() &&
                        bulkTagMode !== 'replace')
                    }
                    className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg cursor-pointer transition-all"
                  >
                    {isApplyingBulkTags ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>選択中の {selectedCDs.length} 枚に一括適用する</span>
                  </button>
                </div>
              </div>
            
            </div>
          )}

          {/* Floating Pill Dock */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-xl border border-indigo-500/60 shadow-2xl rounded-2xl p-2 px-3 sm:px-4 flex items-center gap-2 max-w-[96vw] overflow-x-auto scrollbar-none animate-in fade-in slide-in-from-bottom-5 duration-200 ring-1 ring-white/10">
            {/* Selected count badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-950/90 rounded-xl border border-indigo-500/50 text-indigo-200 font-bold text-xs whitespace-nowrap shadow-inner flex-shrink-0">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span>{selectedIds.length}件選択中</span>
            </div>

            {/* Bulk Tag Menu Button */}
            {onBatchUpdateCDs && (
              <button
                type="button"
                onClick={() => setIsBulkTagMenuOpen((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer shadow-md flex-shrink-0 border ${
                  isBulkTagMenuOpen
                    ? 'bg-indigo-500 text-white border-white/50 ring-2 ring-indigo-400/50'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400/40'
                }`}
                title="選択したCDにジャンルやカスタムタグをチェックボックスで一括適用"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>ジャンル・タグ一括設定</span>
                {isBulkTagMenuOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            )}

            {/* AI Tagging */}
            {onOpenAITagging && (
              <button
                type="button"
                onClick={() => onOpenAITagging(selectedCDs)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer border border-purple-400/40 flex-shrink-0"
                title="Gemini AIでジャンル・雰囲気・年代を自動分析しタグを一括付与"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                <span className="hidden sm:inline">AI自動タグ</span>
              </button>
            )}

            {/* LP/EP Release Date API */}
            {onBatchUpdateCDs && (
              <button
                type="button"
                onClick={() => handleBatchLookupVinylReleaseDates(selectedCDs)}
                disabled={isLookingUpVinylBatch}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold transition-all shadow-md cursor-pointer border border-amber-500/40 disabled:opacity-50 flex-shrink-0"
                title="同タイトルのLP・EPレコード発売年月日をAPIから一括取得"
              >
                {isLookingUpVinylBatch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Disc className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">LP/EP発売日</span>
              </button>
            )}

            {/* PDF Catalog */}
            {onOpenPDFCatalog && (
              <button
                type="button"
                onClick={() => onOpenPDFCatalog(selectedCDs)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer border border-amber-400/40 flex-shrink-0"
                title="選択分をPDFカタログ化"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden md:inline">PDFカタログ</span>
              </button>
            )}

            {/* Export */}
            <button
              type="button"
              onClick={() => onOpenExportModal(selectedCDs)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer border border-emerald-400/40 flex-shrink-0"
              title="選択分をJSON・Excel・CSVへ書き出し"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span className="hidden md:inline">データ書き出し</span>
            </button>

            {/* Batch Delete */}
            <button
              type="button"
              onClick={handleBatchDeleteConfirmed}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-900/80 hover:bg-rose-800 text-rose-200 text-xs font-bold border border-rose-700/60 transition-all cursor-pointer shadow-md flex-shrink-0"
              title="選択したCDをライブラリから一括削除"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">削除</span>
            </button>

            {/* Deselect All */}
            <button
              type="button"
              onClick={() => {
                setSelectedIds([]);
                setIsBulkTagMenuOpen(false);
              }}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer flex-shrink-0 ml-1"
              title="選択をすべて解除"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {/* In-App Delete Confirmation Modal */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/90 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {deleteConfirmTarget.type === 'all'
                    ? 'ライブラリの全件一括削除'
                    : deleteConfirmTarget.type === 'batch'
                    ? '選択CDの一括削除'
                    : 'CDレコードの削除'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {deleteConfirmTarget.type === 'all'
                    ? `ライブラリ内のすべてのCD（全 ${deleteConfirmTarget.count} 件）を一括削除します`
                    : deleteConfirmTarget.type === 'batch'
                    ? `選択された ${deleteConfirmTarget.count} 件のCDを一括削除します`
                    : '指定されたCDレコードを削除します'}
                </p>
              </div>
            </div>

            <div className="bg-rose-950/30 border border-rose-800/40 p-3.5 rounded-xl text-xs text-rose-200 leading-relaxed space-y-1">
              <p className="font-bold text-rose-300 flex items-center gap-1">
                <span>⚠️ 警告：この操作は取り消せません</span>
              </p>
              <p className="text-[11px] text-rose-300/80">
                データベースから該当するデータが完全に消去されます。本当に削除を実行してもよろしいですか？
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={executeDelete}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/60 transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleteConfirmTarget.count > 1 ? `${deleteConfirmTarget.count}件を完全に削除` : '削除を実行する'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Tag & Notes Edit Modal */}
      {onBatchUpdateCDs && (
        <BatchEditModal
          isOpen={isBatchEditModalOpen}
          onClose={() => setIsBatchEditModalOpen(false)}
          selectedCDs={selectedCDs}
          allCDs={cds}
          onBatchUpdateCDs={async (updatedCDs) => {
            await onBatchUpdateCDs(updatedCDs);
            setVinylLookupNotice(`${updatedCDs.length} 件のCDのタグ・備考を一括更新しました！`);
            setTimeout(() => setVinylLookupNotice(null), 4000);
          }}
        />
      )}

    </div>
  );
};
