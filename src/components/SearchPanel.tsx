import React, { useState } from 'react';
import { Search, Camera, Disc, HelpCircle, RefreshCw, Barcode, Check, RotateCcw, Trash2, Sparkles } from 'lucide-react';
import { APISource, SearchQuery } from '../types/cd';

interface SearchPanelProps {
  onSearch: (query: SearchQuery) => void;
  isLoading: boolean;
  onOpenOCRModal: () => void;
  onClear?: () => void;
}

const API_SOURCE_OPTIONS: { id: APISource; label: string; description: string; badgeColor: string }[] = [
  {
    id: 'musicbrainz',
    label: 'MusicBrainz',
    description: '型番・バーコード・国際リリースデータベース',
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  {
    id: 'discogs',
    label: 'Discogs',
    description: '洋楽・邦楽・盤面仕様・Catalog No.詳細',
    badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  {
    id: 'itunes',
    label: 'iTunes Search',
    description: '高画質ジャケット・曲順・プレビュー試聴',
    badgeColor: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  },
  {
    id: 'ndl',
    label: '国立国会図書館 (NDL)',
    description: '国内盤CDの型番・発売元・書誌情報に特化',
    badgeColor: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  },
  {
    id: 'spotify',
    label: 'Spotify API',
    description: 'ストリーミング楽曲・アルバム構成・ジャケット',
    badgeColor: 'bg-green-500/10 text-green-400 border-green-500/20',
  },
  {
    id: 'rakuten',
    label: '楽天ブックス CD検索',
    description: '国内市販CD・JANコード・レーベル・発売日',
    badgeColor: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
];

const SAMPLE_CD_QUERIES = [
  { catno: 'VICL-60300', title: 'さくら', artist: 'サザンオールスターズ', label: 'サザン - さくら (VICL-60300)' },
  { catno: 'TOCT-24067', title: 'First Love', artist: '宇多田ヒカル', label: '宇多田ヒカル - First Love' },
  { catno: 'TFCC-88077', title: '深海', artist: 'Mr.Children', label: 'ミスチル - 深海 (TFCC-88077)' },
  { artist: 'Yellow Magic Orchestra', barcode: '4562109401813', label: 'Y.M.O  - (JAN:4562109401813)' },
];

export const SearchPanel: React.FC<SearchPanelProps> = ({
  onSearch,
  isLoading,
  onOpenOCRModal,
  onClear,
}) => {
  const [catno, setCatno] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [trackTitle, setTrackTitle] = useState('');
  const [barcode, setBarcode] = useState('');

  const handleClearAll = () => {
    setCatno('');
    setTitle('');
    setArtist('');
    setTrackTitle('');
    setBarcode('');
    if (onClear) {
      onClear();
    }
  };
  const VALID_SOURCES: APISource[] = [
    'musicbrainz',
    'discogs',
    'itunes',
    'ndl',
    'spotify',
    'rakuten',
  ];

  const [selectedSources, setSelectedSources] = useState<APISource[]>(() => {
    try {
      const saved = localStorage.getItem('cd_search_selected_sources');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((s: APISource) => VALID_SOURCES.includes(s));
          if (valid.length > 0) {
            return valid;
          }
        }
      }
    } catch {}
    return VALID_SOURCES;
  });

  const toggleSource = (source: APISource) => {
    let next: APISource[];
    if (selectedSources.includes(source)) {
      if (selectedSources.length === 1) return; // keep at least one
      next = selectedSources.filter((s) => s !== source);
    } else {
      next = [...selectedSources, source];
    }
    setSelectedSources(next);
    try {
      localStorage.setItem('cd_search_selected_sources', JSON.stringify(next));
    } catch {}
  };

  const selectAllSources = () => {
    const all: APISource[] = ['musicbrainz', 'discogs', 'itunes', 'ndl', 'spotify', 'rakuten'];
    setSelectedSources(all);
    try {
      localStorage.setItem('cd_search_selected_sources', JSON.stringify(all));
    } catch {}
  };

  const selectDomesticSources = () => {
    const domestic: APISource[] = ['ndl', 'rakuten', 'itunes'];
    setSelectedSources(domestic);
    try {
      localStorage.setItem('cd_search_selected_sources', JSON.stringify(domestic));
    } catch {}
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catno.trim() && !title.trim() && !artist.trim() && !trackTitle.trim() && !barcode.trim()) return;

    onSearch({
      catalogNumber: catno.trim() || undefined,
      title: title.trim() || undefined,
      artist: artist.trim() || undefined,
      trackTitle: trackTitle.trim() || undefined,
      barcode: barcode.trim() || undefined,
      sources: selectedSources,
    });
  };

  const applySample = (sample: any) => {
    setCatno(sample.catno || '');
    setTitle(sample.title || '');
    setArtist(sample.artist || '');
    setTrackTitle(sample.trackTitle || '');
    setBarcode(sample.barcode || '');
    
    onSearch({
      catalogNumber: sample.catno,
      title: sample.title,
      artist: sample.artist,
      trackTitle: sample.trackTitle,
      barcode: sample.barcode,
      sources: selectedSources,
    });
  };

  return (
    <div className="bg-slate-800/80 rounded-2xl border border-slate-700/80 p-4 sm:p-5 shadow-xl relative overflow-hidden">
      {/* Background subtle glow */}
      <div className="absolute -right-10 -top-10 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <form onSubmit={handleSearchSubmit} className="space-y-4 relative z-10">
        
        {/* Top Header & AI Scan trigger */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-700/60 pb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5 truncate">
              <Search className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <span>CD検索＆メタデータ自動抽出</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              規格品番・タイトル・アーティスト・JANから横断抽出
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenOCRModal}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-900/30 transition-all hover:scale-[1.02] border border-purple-400/30 whitespace-nowrap cursor-pointer"
            title="CD背表紙・帯・ジャケットの写真からAI OCR解析"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>写真からAI解析</span>
          </button>
        </div>

        {/* Input Fields Grid (2-column layout with non-wrapping labels) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Catalog Number Input */}
          <div className="sm:col-span-1">
            <label className="block text-[11px] font-semibold text-indigo-300 mb-1 flex items-center justify-between whitespace-nowrap">
              <span>型番（規格品番）</span>
            </label>
            <div className="relative">
              <Disc className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={catno}
                onChange={(e) => setCatno(e.target.value)}
                placeholder="VICL-60001"
                className="w-full bg-slate-900/80 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl py-2 pl-8 pr-2 text-xs text-white placeholder-slate-500 transition-all uppercase tracking-wider font-mono"
              />
            </div>
          </div>

          {/* JAN / EAN Barcode Input */}
          <div className="sm:col-span-1">
            <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1 whitespace-nowrap">
              <Barcode className="w-3 h-3 text-slate-400" />
              <span>JAN/EANコード</span>
            </label>
            <input
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="4988001..."
              className="w-full bg-slate-900/80 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-500 font-mono transition-all"
            />
          </div>

          {/* Title Input */}
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-300 mb-1 whitespace-nowrap">
              CD/アルバムタイトル
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="アルバム題名"
              className="w-full bg-slate-900/80 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-500 transition-all"
            />
          </div>

          {/* Artist Input */}
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-300 mb-1 whitespace-nowrap">
              歌手 / アーティスト名
            </label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="歌手・バンド名"
              className="w-full bg-slate-900/80 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-500 transition-all"
            />
          </div>

          {/* Track Name Input */}
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-emerald-400 mb-1 flex items-center justify-between whitespace-nowrap">
              <span>曲名 (収録曲)</span>
            </label>
            <input
              type="text"
              value={trackTitle}
              onChange={(e) => setTrackTitle(e.target.value)}
              placeholder="収録曲のタイトル"
              className="w-full bg-slate-900/80 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-500 transition-all"
            />
          </div>
        </div>

        {/* Quick Samples (Guaranteed 2 Rows via 2-column Grid) */}
        <div className="space-y-1.5 pt-0.5">
          <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
            <span>クイック検索サンプル (全4件):</span>
          </span>
          <div className="grid grid-cols-2 gap-1.5 w-full">
            {SAMPLE_CD_QUERIES.map((sample, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => applySample(sample)}
                className="text-[10.5px] px-2 py-1 rounded-lg bg-slate-900/90 hover:bg-indigo-950 text-slate-300 hover:text-indigo-200 border border-slate-700/80 hover:border-indigo-500/50 transition-colors cursor-pointer truncate text-left shadow-xs"
                title={sample.label}
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>

        {/* API Sources Checkboxes */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <label className="font-semibold text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
              <span>横断検索対象 API:</span>
              <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/80 px-1.5 py-0.2 rounded border border-indigo-500/40">
                {selectedSources.length}/{API_SOURCE_OPTIONS.length}
              </span>
            </label>
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={selectAllSources}
                className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                全選択
              </button>
              <span className="text-slate-600">|</span>
              <button
                type="button"
                onClick={selectDomesticSources}
                className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors cursor-pointer whitespace-nowrap"
                title="NDL(国会図書館)・楽天ブックス・iTunesのみ選択"
              >
                主要国内
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {API_SOURCE_OPTIONS.map((src) => {
              const isChecked = selectedSources.includes(src.id);
              const shortLabels: Record<APISource, string> = {
                musicbrainz: 'MusicBrainz',
                discogs: 'Discogs',
                itunes: 'iTunes',
                ndl: '国会図書館',
                spotify: 'Spotify',
                rakuten: '楽天ブックス',
                vgmdb: 'VGMdb',
                yahoo: 'Yahoo!',
                gemini: 'AI OCR',
              };

              return (
                <button
                  type="button"
                  key={src.id}
                  onClick={() => toggleSource(src.id)}
                  className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-left transition-all ${
                    isChecked
                      ? 'bg-slate-700/60 border-indigo-500 text-white ring-1 ring-indigo-500/40 shadow-xs'
                      : 'bg-slate-900/40 border-slate-800 text-slate-500 hover:text-slate-400 opacity-60'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                    isChecked ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-600 bg-slate-800'
                  }`}>
                    {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span className={`text-[10.5px] font-semibold truncate whitespace-nowrap ${isChecked ? 'text-white' : 'text-slate-400'}`}>
                    {shortLabels[src.id] || src.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Gemini AI Integration & Exact Match Info Banner */}
        <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-500/20 text-[10px] text-indigo-300">
          <span className="flex items-center gap-1 min-w-0">
            <Sparkles className="w-3 h-3 text-indigo-400 flex-shrink-0" />
            <span className="truncate">複数APIの結果をGeminiが自動統合・完全一致最優先</span>
          </span>
          <span className="text-[9px] bg-indigo-900/60 text-indigo-200 px-1.5 py-0.2 rounded border border-indigo-500/30 font-mono whitespace-nowrap flex-shrink-0">
            重複排除済
          </span>
        </div>

        {/* Submit Search & Clear Buttons */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            onClick={handleClearAll}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700/80 transition-colors whitespace-nowrap cursor-pointer"
            title="検索入力・結果を全消去"
          >
            <RotateCcw className="w-3 h-3 text-rose-400" />
            <span>クリア</span>
          </button>

          <button
            type="submit"
            disabled={isLoading || (!catno.trim() && !title.trim() && !artist.trim() && !trackTitle.trim() && !barcode.trim())}
            className="flex-1 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>検索中...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>{selectedSources.length}件のAPIで検索</span>
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
};
