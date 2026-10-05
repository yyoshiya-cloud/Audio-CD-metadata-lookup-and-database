import React, { useState } from 'react';
import { CDMetadata } from '../types/cd';
import { Search, FileSpreadsheet, Download, Upload, Trash2, CheckCircle2, Music, ExternalLink, Disc, Filter, Plus, PlusCircle, Sparkles, AlertCircle, Clock, ArrowRight, Files, Table } from 'lucide-react';
import { SpreadsheetEditorView } from './SpreadsheetEditorView';

interface CDDatabaseTableProps {
  cds: CDMetadata[];
  onSelectCD: (cd: CDMetadata, currentList?: CDMetadata[]) => void;
  onDeleteCD: (id: string) => void;
  onBatchDeleteCDs: (ids: string[]) => void;
  onOpenExportSheetsModal: (selectedCDs: CDMetadata[]) => void;
  onOpenManualAdd?: () => void;
  onOpenBatchModal?: () => void;
  onOpenAITagging?: (selectedCDs: CDMetadata[]) => void;
  onBatchUpdateCDs?: (updatedCDs: CDMetadata[]) => Promise<void>;
  initialSearchKeyword?: string;
}

export const CDDatabaseTable: React.FC<CDDatabaseTableProps> = ({
  cds,
  onSelectCD,
  onDeleteCD,
  onBatchDeleteCDs,
  onOpenExportSheetsModal,
  onOpenManualAdd,
  onOpenBatchModal,
  onOpenAITagging,
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
  const [filterSynced, setFilterSynced] = useState<'all' | 'synced' | 'notSynced'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedTracklistId, setExpandedTracklistId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'catalogNumber' | 'title' | 'artist' | 'label' | 'releaseDate' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    type: 'single' | 'batch' | 'all';
    id?: string;
    count: number;
  } | null>(null);

  const totalCount = cds.length;
  const syncedCount = cds.filter((c) => c.syncedToSheets).length;
  const notSyncedCount = totalCount - syncedCount;

  // Filter & Sort logic
  const filteredCDs = cds.filter((cd) => {
    const kw = searchKeyword.toLowerCase().trim();
    const matchesKw =
      !kw ||
      (cd.title && cd.title.toLowerCase().includes(kw)) ||
      (cd.artist && cd.artist.toLowerCase().includes(kw)) ||
      (cd.catalogNumber && cd.catalogNumber.toLowerCase().includes(kw)) ||
      (cd.label && cd.label.toLowerCase().includes(kw)) ||
      (cd.barcode && cd.barcode.includes(kw)) ||
      (cd.tags && cd.tags.some((t) => t.toLowerCase().includes(kw))) ||
      (cd.tracks && cd.tracks.some((t) => t.title && t.title.toLowerCase().includes(kw)));

    const matchesSynced =
      filterSynced === 'all'
        ? true
        : filterSynced === 'synced'
        ? cd.syncedToSheets
        : !cd.syncedToSheets;

    return matchesKw && matchesSynced;
  });

  const handleSort = (field: 'catalogNumber' | 'title' | 'artist' | 'label' | 'releaseDate') => {
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

  const sortedCDs = [...filteredCDs].sort((a, b) => {
    if (!sortField) return 0;
    const valA = (a[sortField] || '').toString().toLowerCase();
    const valB = (b[sortField] || '').toString().toLowerCase();

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
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

  const handleOpenBulkDeleteModal = () => {
    if (selectedIds.length > 0) {
      setDeleteConfirmTarget({
        type: 'batch',
        count: selectedIds.length,
      });
    } else {
      setDeleteConfirmTarget({
        type: 'all',
        count: filteredCDs.length > 0 ? filteredCDs.length : cds.length,
      });
    }
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
    <div className="flex flex-col h-[calc(100vh-130px)] space-y-3 pb-1">
      
      {/* 1. Control Bar (Fixed at top): Filters, Search & Action Buttons */}
      <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-4 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 flex-shrink-0">
        
        {/* Search Input & Synced Filter */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto flex-1">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="型番、タイトル、歌手名、曲名、タグで検索..."
              className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl py-2 pl-9 pr-8 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none transition-all shadow-inner"
            />
            {searchKeyword && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-slate-800 transition-colors"
                title="検索条件をクリア"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-700/80 text-xs w-full sm:w-auto shadow-inner">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5" />
            <button
              type="button"
              onClick={() => setFilterSynced('all')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                filterSynced === 'all'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              すべて ({cds.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterSynced('synced')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                filterSynced === 'synced'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              連携済 ({syncedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterSynced('notSynced')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                filterSynced === 'notSynced'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              未同期 ({notSyncedCount})
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          {onBatchUpdateCDs && (
            <button
              type="button"
              onClick={() => setIsSpreadsheetMode(!isSpreadsheetMode)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-sm ${
                isSpreadsheetMode
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 ring-2 ring-emerald-500/50 shadow-emerald-900/40'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700 hover:border-slate-600'
              }`}
              title="Excel・スプレッドシート形式で直接セル入力・一括編集"
            >
              <Table className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isSpreadsheetMode ? '通常テーブル' : 'スプレットシート'}</span>
            </button>
          )}

          {onOpenManualAdd && (
            <button
              onClick={onOpenManualAdd}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/30 border border-indigo-400/30 transition-all cursor-pointer"
              title="新しいCDを手動で追加登録"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>CD登録</span>
            </button>
          )}

          {onOpenBatchModal && (
            <button
              onClick={onOpenBatchModal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 hover:border-slate-600 transition-all cursor-pointer shadow-sm"
              title="型番の一括連続自動取得"
            >
              <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>型番一括</span>
            </button>
          )}

          {onOpenAITagging && (
            <button
              onClick={() => onOpenAITagging(selectedCDs)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-700 hover:from-purple-500 hover:to-indigo-600 text-white shadow-md shadow-purple-900/30 border border-purple-400/30 transition-all cursor-pointer"
              title="Gemini AIでジャンル・雰囲気・年代を自動分析しタグを一括付与"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-200" />
              <span>{selectedIds.length > 0 ? `AIタグ付け (${selectedIds.length}件)` : 'AI自動タグ付け'}</span>
            </button>
          )}

          <button
            onClick={() => onOpenExportSheetsModal(selectedIds.length > 0 ? selectedCDs : filteredCDs)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30 transition-all cursor-pointer border border-emerald-500/40"
            title="Googleスプレッドシート・Excel・CSVファイル（2ファイル一括対応）の双方向連携"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-100" />
            <span>スプレッドシート / Excel / CSV連携</span>
            <span className="text-[10px] bg-emerald-950/80 text-emerald-200 px-1.5 py-0.5 rounded-full border border-emerald-400/40 font-mono font-bold">
              {syncedCount}
            </span>
          </button>
        </div>

      </div>

      {/* Contextual Batch Selection Banner (Shows only when items are checked) */}
      {selectedIds.length > 0 && (
        <div className="bg-indigo-950/90 border border-indigo-500/50 p-2.5 px-4 rounded-xl shadow-lg flex flex-wrap items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-2 text-indigo-200 font-bold">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>{selectedIds.length} 件選択中</span>
            <span className="text-slate-400 font-normal">（全 {filteredCDs.length} 件中）</span>
          </div>

          <div className="flex items-center gap-2">
            {onOpenAITagging && (
              <button
                type="button"
                onClick={() => onOpenAITagging(selectedCDs)}
                className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors cursor-pointer flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                選択分にAIタグ付け
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenExportSheetsModal(selectedCDs)}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors cursor-pointer flex items-center gap-1"
            >
              <FileSpreadsheet className="w-3 h-3" />
              選択分を書き出し
            </button>

            <button
              type="button"
              onClick={handleBatchDeleteConfirmed}
              className="px-2.5 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-rose-200 font-semibold border border-rose-700/50 transition-colors cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              選択分を削除
            </button>

            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              選択解除
            </button>
          </div>
        </div>
      )}

      {/* 2. Database Table View (Fixed Header + Scrollable Rows) */}
      {filteredCDs.length > 0 ? (
        <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 shadow-xl flex-1 min-h-0 flex flex-col overflow-hidden">
          
          {/* Scrollable Container with Sticky Table Header */}
          <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="sticky top-0 z-20 bg-slate-900 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-700 select-none shadow-md">
                <tr>
                  <th className="py-3 px-3 w-10 text-center whitespace-nowrap bg-slate-900">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === filteredCDs.length && filteredCDs.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                    />
                  </th>
                  
                  {/* Jacket Header */}
                  <th className="py-3 px-2 w-12 text-center font-mono text-slate-400 text-[11px] bg-slate-900 whitespace-nowrap">No.</th>
                  <th className="py-3 px-3 w-16 text-center whitespace-nowrap bg-slate-900">ジャケット</th>

                  {/* Sortable Column: Catalog Number */}
                  <th
                    onClick={() => handleSort('catalogNumber')}
                    className="py-3 px-3 w-32 cursor-pointer hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap bg-slate-900"
                    title="型番で並べ替え"
                  >
                    <div className="flex items-center gap-1">
                      <span>型番 (規格品番)</span>
                      <span className={`text-[10px] font-bold ${sortField === 'catalogNumber' ? 'text-indigo-400' : 'text-slate-600'}`}>
                        {sortField === 'catalogNumber' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  {/* Sortable Column: Title (Click title in rows to edit details) */}
                  <th
                    onClick={() => handleSort('title')}
                    className="py-3 px-4 min-w-[280px] cursor-pointer hover:text-white hover:bg-slate-800 transition-colors bg-slate-900"
                    title="CDタイトルで並べ替え"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>CDタイトル</span>
                      <span className={`text-[10px] font-bold ${sortField === 'title' ? 'text-indigo-400' : 'text-slate-600'}`}>
                        {sortField === 'title' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  {/* Sortable Column: Artist */}
                  <th
                    onClick={() => handleSort('artist')}
                    className="py-3 px-4 min-w-[180px] cursor-pointer hover:text-white hover:bg-slate-800 transition-colors bg-slate-900"
                    title="歌手 / アーティストで並べ替え"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>歌手 / アーティスト</span>
                      <span className={`text-[10px] font-bold ${sortField === 'artist' ? 'text-indigo-400' : 'text-slate-600'}`}>
                        {sortField === 'artist' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  {/* Sortable Column: Label */}
                  <th
                    onClick={() => handleSort('label')}
                    className="py-3 px-3 min-w-[140px] cursor-pointer hover:text-white hover:bg-slate-800 transition-colors bg-slate-900"
                    title="レーベルで並べ替え"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>レーベル</span>
                      <span className={`text-[10px] font-bold ${sortField === 'label' ? 'text-indigo-400' : 'text-slate-600'}`}>
                        {sortField === 'label' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  {/* Sortable Column: Release Date */}
                  <th
                    onClick={() => handleSort('releaseDate')}
                    className="py-3 px-3 w-28 cursor-pointer hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap bg-slate-900"
                    title="発売年月日などで並べ替え"
                  >
                    <div className="flex items-center gap-1">
                      <span>発売年月日</span>
                      <span className={`text-[10px] font-bold ${sortField === 'releaseDate' ? 'text-indigo-400' : 'text-slate-600'}`}>
                        {sortField === 'releaseDate' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  <th className="py-3 px-3 text-center whitespace-nowrap bg-slate-900">収録曲</th>
                  <th className="py-3 px-3 text-center whitespace-nowrap bg-slate-900">スプレッドシート</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap bg-slate-900">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {sortedCDs.map((cd, index) => {
                  const isChecked = selectedIds.includes(cd.id);
                  const isExpanded = expandedTracklistId === cd.id;

                  return (
                    <React.Fragment key={cd.id}>
                      <tr className={`hover:bg-slate-700/30 transition-colors ${isChecked ? 'bg-indigo-950/20' : ''}`}>
                        <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectRow(cd.id)}
                            className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                          />
                        </td>

                        {/* Sequential Index Number */}
                        <td className="py-3 px-2 text-center font-mono text-xs font-bold text-slate-300 whitespace-nowrap">
                          <span className="bg-slate-900/90 border border-slate-700 text-indigo-300 px-2 py-0.5 rounded-md font-mono text-[11px] shadow-xs">
                            #{index + 1}
                          </span>
                        </td>

                        {/* Jacket Image */}
                        <td className="py-3 px-3 text-center">
                          <div
                            onClick={() => onSelectCD(cd, sortedCDs)}
                            className="w-10 h-10 rounded-lg bg-slate-900 overflow-hidden border border-slate-700 mx-auto flex items-center justify-center cursor-pointer hover:border-indigo-400 transition-colors"
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
                              <Disc className="w-5 h-5 text-slate-600" />
                            )}
                          </div>
                        </td>

                        {/* Catalog Number */}
                        <td className="py-3 px-3 font-mono font-bold text-indigo-300">
                          {cd.catalogNumber || '-'}
                        </td>

                        {/* Title (Clickable to open Detail Modal) */}
                        <td className="py-3 px-4 max-w-[280px]">
                          <button
                            type="button"
                            onClick={() => onSelectCD(cd, sortedCDs)}
                            className="text-left font-bold text-white hover:text-indigo-300 hover:underline transition-colors block truncate w-full cursor-pointer focus:outline-none"
                            title={`「${cd.title}」をクリックして詳細・曲順を編集`}
                          >
                            {cd.title}
                          </button>
                          {cd.tags && cd.tags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap mt-1">
                              {cd.tags.slice(0, 3).map((t, idx) => (
                                <span
                                  key={idx}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSearchKeyword(t);
                                  }}
                                  className="text-[10px] bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 px-1.5 py-0.2 rounded cursor-pointer transition-colors"
                                  title={`タグ「${t}」で絞り込み`}
                                >
                                  #{t}
                                </span>
                              ))}
                              {cd.tags.length > 3 && (
                                <span className="text-[10px] text-slate-500 font-mono">+{cd.tags.length - 3}</span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Artist */}
                        <td className="py-3 px-4 font-medium text-slate-200 max-w-[160px] truncate" title={cd.artist}>
                          {cd.artist}
                        </td>

                        {/* Label */}
                        <td className="py-3 px-3 text-slate-400 max-w-[120px] truncate">
                          {cd.label || '-'}
                        </td>

                        {/* Release Date */}
                        <td className="py-3 px-3 text-slate-400 font-mono">
                          {cd.releaseDate || '-'}
                        </td>

                        {/* Track Count & Drawer Toggle */}
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => setExpandedTracklistId(isExpanded ? null : cd.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 text-indigo-300 border border-slate-700 hover:border-indigo-500 text-[11px]"
                          >
                            <Music className="w-3 h-3" />
                            {cd.tracks ? cd.tracks.length : 0}曲
                          </button>
                        </td>

                        {/* Synced Status Badge */}
                        <td className="py-3 px-3 text-center">
                          {cd.syncedToSheets ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                              <CheckCircle2 className="w-3 h-3" />
                              同期済み
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500">未同期</span>
                          )}
                        </td>

                        {/* Actions (Delete only, edit is on title click) */}
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end">
                            <button
                              onClick={() => handleDeleteConfirmed(cd.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                              title="削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Tracklist Drawer */}
                      {isExpanded && cd.tracks && cd.tracks.length > 0 && (
                        <tr className="bg-slate-900/60 border-b border-slate-800">
                          <td colSpan={10} className="py-3 px-6">
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
        <div className="bg-slate-800/40 rounded-2xl border border-slate-700/60 p-12 text-center text-slate-400">
          <Disc className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-300">データベースに登録されたCDがありません</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            「Web検索・メタデータ取得」タブから検索し、ライブラリにCDを追加してください。
          </p>
        </div>
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

    </div>
  );
};
