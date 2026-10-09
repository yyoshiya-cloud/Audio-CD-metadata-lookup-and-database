import React, { useState, useMemo, useEffect } from 'react';
import { CDMetadata, CustomSetlist, CustomSetlistItem } from '../types/cd';
import {
  loadCustomSetlistsDB,
  saveCustomSetlistsDB,
  loadFavoriteTrackKeysDB,
  saveFavoriteTrackKeysDB,
} from '../lib/db';
import {
  normalizeJapaneseSearchText,
  matchesSearchToken,
} from '../utils/japaneseSearchNormalizer';
import {
  Search,
  Music,
  Disc,
  Heart,
  ListMusic,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Clock,
  Copy,
  CheckCircle2,
  Layers,
  Sparkles,
  FileText,
} from 'lucide-react';

interface TrackSearchAndSetlistViewProps {
  cds: CDMetadata[];
  onSelectCD: (cd: CDMetadata, currentList?: CDMetadata[]) => void;
  onBatchUpdateCDs?: (updatedCDs: CDMetadata[]) => Promise<void>;
}

interface FlattenedTrackRow {
  key: string; // `${cd.id}::${idx}::${trackNumber}`
  cd: CDMetadata;
  trackNumber: number;
  trackTitle: string;
  trackArtist: string;
  duration: string;
  durationSeconds: number;
  normalizedSongKey: string;
}

const MEDIA_CAPACITY_PRESETS = [
  { label: 'カセット 46分 (片面23分)', minutes: 46 },
  { label: 'カセット 60分 (片面30分)', minutes: 60 },
  { label: 'CD-R / MD 74分', minutes: 74 },
  { label: 'CD-R / MD 80分', minutes: 80 },
  { label: 'カセット 90分 (片面45分)', minutes: 90 },
  { label: '制限なし (120分)', minutes: 120 },
];

function parseDurationToSeconds(dur?: string): number {
  if (!dur) return 0;
  const trimmed = dur.trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(':').map((p) => parseInt(p, 10) || 0);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function formatSecondsToMMSS(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '00:00';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function toHalfWidthAndNormalized(str?: string): string {
  if (!str) return '';
  return String(str)
    .normalize('NFKC')
    .toLowerCase()
    // Katakana to Hiragana so searching in Hiragana or Katakana matches both
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s　\-‐－―ー〜~()（）\[\]「」『』【】・,、.。!！?？'"”’]/g, '')
    .trim();
}

function normalizeSongTitleKey(title: string): string {
  return normalizeJapaneseSearchText(title);
}

export const TrackSearchAndSetlistView: React.FC<TrackSearchAndSetlistViewProps> = ({
  cds,
  onSelectCD,
  onBatchUpdateCDs,
}) => {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'favorites' | 'multiVersion'>('all');
  const [selectedArtistFilter, setSelectedArtistFilter] = useState<string>('all');
  const [isBackfillingTracks, setIsBackfillingTracks] = useState(false);

  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [setlists, setSetlists] = useState<CustomSetlist[]>([]);
  const [activeSetlistId, setActiveSetlistId] = useState<string>('');
  const [newSetlistName, setNewSetlistName] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  // Load saved favorite tracks and custom setlists from IndexedDB on mount
  useEffect(() => {
    loadFavoriteTrackKeysDB().then((keys) => {
      setFavoriteKeys(new Set(keys));
    });
    loadCustomSetlistsDB().then((loaded) => {
      if (loaded.length > 0) {
        setSetlists(loaded);
        setActiveSetlistId(loaded[0].id);
      } else {
        const defaultList: CustomSetlist = {
          id: `setlist-default-${Date.now()}`,
          name: 'マイ・ベスト・セットリスト #1',
          description: 'お気に入り曲・カセット/MD録音用タイム計算リスト',
          targetMinutes: 60,
          items: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setSetlists([defaultList]);
        setActiveSetlistId(defaultList.id);
        saveCustomSetlistsDB([defaultList]);
      }
    });
  }, []);

  // Flatten all tracks across all CDs in the library
  const { allFlattenedTracks, songOccurrenceCountMap, artistList, cdsWithoutTracks } = useMemo(() => {
    const rows: FlattenedTrackRow[] = [];
    const occurrenceMap = new Map<string, number>();
    const artistsSet = new Set<string>();
    const missingTrackCDs: CDMetadata[] = [];

    cds.forEach((cd) => {
      const cdArtist = (cd.artist || '').trim();
      if (cdArtist) artistsSet.add(cdArtist);
      const validTracks = (cd.tracks || []).filter((tr) => tr && String(tr.title || '').trim());
      if (validTracks.length === 0) {
        missingTrackCDs.push(cd);
      }

      (cd.tracks || []).forEach((tr, idx) => {
        if (!tr) return;
        const trackNum = tr.trackNumber || idx + 1;
        const title = String(tr.title || '').trim();
        if (!title) return;
        const normKey = normalizeSongTitleKey(title);
        if (normKey) {
          occurrenceMap.set(normKey, (occurrenceMap.get(normKey) || 0) + 1);
        }
        rows.push({
          key: `${cd.id}::${idx}::${trackNum}`,
          cd,
          trackNumber: trackNum,
          trackTitle: title,
          trackArtist: String(tr.artist || cd.artist || '').trim(),
          duration: String(tr.duration || '').trim(),
          durationSeconds: parseDurationToSeconds(tr.duration),
          normalizedSongKey: normKey,
        });
      });
    });

    return {
      allFlattenedTracks: rows,
      songOccurrenceCountMap: occurrenceMap,
      artistList: Array.from(artistsSet).sort((a, b) => a.localeCompare(b, 'ja')),
      cdsWithoutTracks: missingTrackCDs,
    };
  }, [cds]);

  // Filter tracks based on searchKeyword, filterMode, and selectedArtistFilter
  const filteredTracks = useMemo(() => {
    const rawKw = searchKeyword.trim();
    const kwTokens = rawKw
      ? rawKw
          .split(/[\s　]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    return allFlattenedTracks.filter((row) => {
      const legacyKey = `${row.cd.id}::${row.trackNumber}`;
      const isFav = favoriteKeys.has(row.key) || favoriteKeys.has(legacyKey);
      if (filterMode === 'favorites' && !isFav) {
        return false;
      }
      if (
        filterMode === 'multiVersion' &&
        (songOccurrenceCountMap.get(row.normalizedSongKey) || 0) < 2
      ) {
        return false;
      }
      if (selectedArtistFilter !== 'all' && (row.cd.artist || '').trim() !== selectedArtistFilter) {
        return false;
      }
      if (kwTokens.length === 0) return true;

      const rawCombined = [
        row.trackTitle,
        row.trackArtist,
        row.cd.title || '',
        row.cd.artist || '',
        row.cd.catalogNumber || '',
        row.cd.label || '',
        row.cd.notes || '',
        ...(row.cd.tags || []),
      ].join(' ');

      return kwTokens.every((token) => matchesSearchToken(rawCombined, token));
    });
  }, [allFlattenedTracks, searchKeyword, filterMode, selectedArtistFilter, favoriteKeys, songOccurrenceCountMap]);

  const activeSetlist = useMemo(() => {
    return setlists.find((s) => s.id === activeSetlistId) || setlists[0] || null;
  }, [setlists, activeSetlistId]);

  const toggleFavoriteTrack = async (rowKey: string, trackTitle: string) => {
    const next = new Set(favoriteKeys);
    if (next.has(rowKey)) {
      next.delete(rowKey);
      showToast(`「${trackTitle}」をお気に入りから解除しました`);
    } else {
      next.add(rowKey);
      showToast(`「${trackTitle}」をお気に入り曲に登録しました`);
    }
    setFavoriteKeys(next);
    await saveFavoriteTrackKeysDB(Array.from(next));
  };

  const handleCreateSetlist = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSetlistName.trim();
    if (!trimmed) return;

    const newList: CustomSetlist = {
      id: `setlist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: trimmed,
      description: '',
      targetMinutes: 60,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const nextLists = [newList, ...setlists];
    setSetlists(nextLists);
    setActiveSetlistId(newList.id);
    setNewSetlistName('');
    await saveCustomSetlistsDB(nextLists);
    showToast(`新しいセットリスト「${trimmed}」を作成しました`);
  };

  const handleDeleteCurrentSetlist = async () => {
    if (!activeSetlist || setlists.length <= 1) return;
    const remaining = setlists.filter((s) => s.id !== activeSetlist.id);
    setSetlists(remaining);
    setActiveSetlistId(remaining[0].id);
    await saveCustomSetlistsDB(remaining);
    showToast(`セットリスト「${activeSetlist.name}」を削除しました`);
  };

  const handleAddTrackToSetlist = async (row: FlattenedTrackRow) => {
    if (!activeSetlist) return;
    const newItem: CustomSetlistItem = {
      id: `item-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      cdId: row.cd.id,
      cdTitle: row.cd.title,
      cdArtist: row.cd.artist,
      catalogNumber: row.cd.catalogNumber,
      coverUrl: row.cd.coverUrl,
      trackNumber: row.trackNumber,
      trackTitle: row.trackTitle,
      duration: row.duration,
    };

    const nextLists = setlists.map((s) =>
      s.id === activeSetlist.id
        ? {
            ...s,
            items: [...s.items, newItem],
            updatedAt: new Date().toISOString(),
          }
        : s
    );
    setSetlists(nextLists);
    await saveCustomSetlistsDB(nextLists);
    showToast(`「${row.trackTitle}」を「${activeSetlist.name}」に追加しました`);
  };

  const handleRemoveItemFromSetlist = async (itemId: string) => {
    if (!activeSetlist) return;
    const nextLists = setlists.map((s) =>
      s.id === activeSetlist.id
        ? {
            ...s,
            items: s.items.filter((i) => i.id !== itemId),
            updatedAt: new Date().toISOString(),
          }
        : s
    );
    setSetlists(nextLists);
    await saveCustomSetlistsDB(nextLists);
  };

  const handleMoveSetlistItem = async (index: number, direction: 'up' | 'down') => {
    if (!activeSetlist) return;
    const items = [...activeSetlist.items];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;

    const temp = items[index];
    items[index] = items[targetIdx];
    items[targetIdx] = temp;

    const nextLists = setlists.map((s) =>
      s.id === activeSetlist.id
        ? {
            ...s,
            items,
            updatedAt: new Date().toISOString(),
          }
        : s
    );
    setSetlists(nextLists);
    await saveCustomSetlistsDB(nextLists);
  };

  const handleChangeTargetMinutes = async (minutes: number) => {
    if (!activeSetlist) return;
    const nextLists = setlists.map((s) =>
      s.id === activeSetlist.id
        ? {
            ...s,
            targetMinutes: minutes,
            updatedAt: new Date().toISOString(),
          }
        : s
    );
    setSetlists(nextLists);
    await saveCustomSetlistsDB(nextLists);
  };

  const handleCopySetlistAsText = () => {
    if (!activeSetlist || activeSetlist.items.length === 0) return;
    const totalSec = activeSetlist.items.reduce(
      (sum, item) => sum + parseDurationToSeconds(item.duration),
      0
    );
    const lines = [
      `■ ${activeSetlist.name} (全${activeSetlist.items.length}曲 / 合計時間: ${formatSecondsToMMSS(totalSec)})`,
      '--------------------------------------------------',
      ...activeSetlist.items.map(
        (item, idx) =>
          `${String(idx + 1).padStart(2, '0')}. ${item.trackTitle} / ${item.cdArtist} [${
            item.duration || '--:--'
          }] (収録盤: 『${item.cdTitle}』 ${item.catalogNumber || ''} Tr.${item.trackNumber})`
      ),
    ];
    navigator.clipboard?.writeText(lines.join('\n')).then(() => {
      showToast('セットリストの曲順・収録アルバム情報をクリップボードにコピーしました！');
    });
  };

  // Calculate setlist total duration and Side A / Side B split for cassette tape simulation
  const setlistDurationStats = useMemo(() => {
    if (!activeSetlist) {
      return { totalSeconds: 0, targetSeconds: 3600, usagePercent: 0, isOverCapacity: false };
    }
    const totalSeconds = activeSetlist.items.reduce(
      (sum, item) => sum + parseDurationToSeconds(item.duration),
      0
    );
    const targetMinutes = activeSetlist.targetMinutes || 60;
    const targetSeconds = targetMinutes * 60;
    const usagePercent = Math.min(100, Math.round((totalSeconds / targetSeconds) * 100));
    const isOverCapacity = totalSeconds > targetSeconds;

    return {
      totalSeconds,
      targetSeconds,
      usagePercent,
      isOverCapacity,
    };
  }, [activeSetlist]);

  const multiVersionTrackCount = useMemo(() => {
    return allFlattenedTracks.filter(
      (r) => (songOccurrenceCountMap.get(r.normalizedSongKey) || 0) >= 2
    ).length;
  }, [allFlattenedTracks, songOccurrenceCountMap]);

  const handleBackfillMissingTracks = async () => {
    if (!onBatchUpdateCDs || cdsWithoutTracks.length === 0 || isBackfillingTracks) return;
    setIsBackfillingTracks(true);
    try {
      const targetBatch = cdsWithoutTracks.slice(0, 20);
      const res = await fetch('/api/ai-backfill-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cds: targetBatch }),
      });
      if (!res.ok) {
        throw new Error('収録曲の自動補完に失敗しました');
      }
      const data = await res.json();
      const results = data.results || [];
      const updatedList: CDMetadata[] = [];

      results.forEach((item: any) => {
        const orig = targetBatch.find((c) => c.id === item.id);
        if (orig && Array.isArray(item.tracks) && item.tracks.length > 0) {
          updatedList.push({
            ...orig,
            tracks: item.tracks,
            updatedAt: new Date().toISOString(),
          });
        }
      });

      if (updatedList.length > 0) {
        await onBatchUpdateCDs(updatedList);
        showToast(`${updatedList.length} 枚のアルバムの収録曲データを自動補完しました！`);
      } else {
        showToast('補完できる収録曲データが見つかりませんでした。');
      }
    } catch (err: any) {
      showToast(err.message || '収録曲補完中にエラーが発生しました');
    } finally {
      setIsBackfillingTracks(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-indigo-500/60 text-indigo-200 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Summary Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-600/30 ring-1 ring-white/20">
            <ListMusic className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                全CD横断「収録曲（トラック名）検索」＆ カスタムセットリスト作成
              </h2>
              <span className="text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                全 {allFlattenedTracks.length} 曲 ({cds.length} アルバム)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              「あの曲はどのアルバムに入っていたか？」を横断検索し、同名曲の収録盤比較やカセットテープ/MD/CD-R用の仮想セットリスト・録音時間計算が行えます
            </p>
          </div>
        </div>

        {/* Filter Mode Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
              filterMode === 'all'
                ? 'bg-indigo-600 text-white border-indigo-400 shadow'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            <span>全収録曲 ({allFlattenedTracks.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('favorites')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
              filterMode === 'favorites'
                ? 'bg-rose-600 text-white border-rose-400 shadow'
                : 'bg-slate-950 text-rose-300 border-rose-500/30 hover:bg-rose-950/60'
            }`}
          >
            <Heart className="w-3.5 h-3.5 fill-current" />
            <span>お気に入り曲 ({favoriteKeys.size})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('multiVersion')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
              filterMode === 'multiVersion'
                ? 'bg-amber-600 text-white border-amber-400 shadow'
                : 'bg-slate-950 text-amber-300 border-amber-500/30 hover:bg-amber-950/60'
            }`}
            title="オリジナル盤とベスト盤・ライブ盤など、複数のアルバムに重複収録されている同名曲を抽出して比較します"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>複数アルバム収録曲・バージョン比較 ({multiVersionTrackCount})</span>
          </button>
        </div>
      </div>

      {/* Missing Tracklist Notice Banner (if some CDs in library have 0 tracks) */}
      {cdsWithoutTracks.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-2xl px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-xs text-amber-200">
            <span className="font-bold">⚠️ 収録曲（トラック情報）が未登録のCDが {cdsWithoutTracks.length} 枚あります。</span>
            <span className="text-amber-300/80 ml-1.5">
              収録曲が未登録のCDは曲名検索にヒットしません。AI自動補完または各CDの詳細画面からトラックリストを取得できます。
            </span>
          </div>
          {onBatchUpdateCDs && (
            <button
              type="button"
              onClick={handleBackfillMissingTracks}
              disabled={isBackfillingTracks}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isBackfillingTracks
                  ? '収録曲を自動取得中...'
                  : `未登録CD (${Math.min(cdsWithoutTracks.length, 20)}枚) の収録曲を一括補完`}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Main 2-Column Layout: Left Track Cross-Search Table / Right Custom Setlist Builder */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_440px] gap-5 items-start">
        {/* LEFT COLUMN: Cross-CD Track Search & Version Comparison */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
          {/* Search & Artist Filter Bar */}
          <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-emerald-400 absolute left-3.5 top-2.5" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="曲名（トラック名）・アーティスト名・収録アルバム名・規格品番で横断検索..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl py-2 pl-10 pr-8 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => setSearchKeyword('')}
                  className="absolute right-3 top-2 text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={selectedArtistFilter}
                onChange={(e) => setSelectedArtistFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none cursor-pointer max-w-[220px]"
              >
                <option value="all">すべてのアーティスト ({artistList.length}組)</option>
                {artistList.map((art) => (
                  <option key={art} value={art}>
                    {art}
                  </option>
                ))}
              </select>

              <span className="text-xs font-mono font-bold text-emerald-300 bg-emerald-950/70 border border-emerald-500/30 px-2.5 py-1.5 rounded-xl whitespace-nowrap">
                該当 {filteredTracks.length} 曲
              </span>
            </div>
          </div>

          {/* Track Search Results Table */}
          {filteredTracks.length > 0 ? (
            <div className="overflow-x-auto max-h-[680px] overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="sticky top-0 z-10 bg-slate-950 text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-800 shadow-sm">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">★</th>
                    <th className="py-2.5 px-3">曲名 (トラックタイトル)</th>
                    <th className="py-2.5 px-2 w-16 text-center">時間</th>
                    <th className="py-2.5 px-3">収録アルバム / 規格品番 / 発売日</th>
                    <th className="py-2.5 px-2 w-14 text-center">曲順</th>
                    <th className="py-2.5 px-3 w-28 text-center">セットリスト</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredTracks.map((row) => {
                    const isFav = favoriteKeys.has(row.key);
                    const sameTitleCount = songOccurrenceCountMap.get(row.normalizedSongKey) || 1;
                    const releaseYear = (row.cd.vinylRecordReleaseDate || row.cd.releaseDate || '').slice(0, 4);

                    return (
                      <tr
                        key={row.key}
                        className="hover:bg-slate-800/50 transition-colors group"
                      >
                        {/* Favorite Heart */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleFavoriteTrack(row.key, row.trackTitle)}
                            className={`p-1 rounded-lg transition-colors cursor-pointer ${
                              isFav
                                ? 'text-rose-400 hover:text-rose-300'
                                : 'text-slate-600 hover:text-rose-400'
                            }`}
                            title={isFav ? 'お気に入り解除' : 'お気に入り曲に登録'}
                          >
                            <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                          </button>
                        </td>

                        {/* Track Title & Same-Song Version Comparison Badge */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-white text-xs">
                              {row.trackTitle}
                            </span>
                            {sameTitleCount >= 2 && (
                              <button
                                type="button"
                                onClick={() => setSearchKeyword(row.trackTitle)}
                                className="text-[10px] font-bold bg-amber-950/90 hover:bg-amber-900 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded-md cursor-pointer transition-colors"
                                title="クリックしてこの曲名が収録されている全アルバムを抽出比較"
                              >
                                全{sameTitleCount}盤に収録
                              </button>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {row.trackArtist}
                          </div>
                        </td>

                        {/* Duration */}
                        <td className="py-2.5 px-2 text-center font-mono text-slate-300">
                          {row.duration || '--:--'}
                        </td>

                        {/* Album Info (Clickable to open CDDetailModal) */}
                        <td className="py-2.5 px-3">
                          <div
                            onClick={() => onSelectCD(row.cd, cds)}
                            className="flex items-center gap-2.5 cursor-pointer group/album"
                            title={`クリックしてアルバム「${row.cd.title}」の詳細を開く`}
                          >
                            <div className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-700 overflow-hidden flex-shrink-0 flex items-center justify-center group-hover/album:border-indigo-400 transition-colors">
                              {row.cd.coverUrl ? (
                                <img
                                  src={row.cd.coverUrl}
                                  alt={row.cd.title}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <Disc className="w-4 h-4 text-slate-600" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-indigo-200 group-hover/album:text-indigo-300 group-hover/album:underline truncate max-w-[260px]">
                                {row.cd.title}
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                                <span className="text-indigo-400 font-semibold">
                                  {row.cd.catalogNumber || '型番未設定'}
                                </span>
                                {releaseYear && <span>• {releaseYear}年</span>}
                                {row.cd.tags && row.cd.tags.includes('ベスト盤') && (
                                  <span className="bg-purple-950/90 text-purple-300 border border-purple-500/30 px-1 rounded text-[9px]">
                                    ベスト盤
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Track Number */}
                        <td className="py-2.5 px-2 text-center font-mono">
                          <span className="bg-slate-800 border border-slate-700 text-slate-200 px-2 py-0.5 rounded text-[11px] font-bold">
                            Tr.{String(row.trackNumber).padStart(2, '0')}
                          </span>
                        </td>

                        {/* Add to Setlist Action */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleAddTrackToSetlist(row)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                            title={`現在のセットリスト「${activeSetlist?.name || ''}」にこの曲を追加`}
                          >
                            <Plus className="w-3 h-3" />
                            <span>リスト追加</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center space-y-2">
              <Music className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm font-bold text-slate-300">
                該当する収録曲が見つかりませんでした
              </p>
              <p className="text-xs text-slate-500">
                検索キーワードやフィルター条件を変更してお試しください。
              </p>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Custom Setlist / Cassette & MD Time Calculator */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl p-4 space-y-4 lg:sticky lg:top-[68px]">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs sm:text-sm font-extrabold text-white">
                カスタムセットリスト ＆ 録音タイム計算
              </h3>
            </div>
            {activeSetlist && activeSetlist.items.length > 0 && (
              <button
                type="button"
                onClick={handleCopySetlistAsText}
                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-sm"
                title="セットリストの曲順と収録CD情報をテキストとしてコピー"
              >
                <Copy className="w-3 h-3" />
                <span>リストをコピー</span>
              </button>
            )}
          </div>

          {/* Setlist Selector & Create New */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={activeSetlist?.id || ''}
                onChange={(e) => setActiveSetlistId(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none cursor-pointer"
              >
                {setlists.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.items.length}曲)
                  </option>
                ))}
              </select>

              {setlists.length > 1 && (
                <button
                  type="button"
                  onClick={handleDeleteCurrentSetlist}
                  className="p-2 rounded-xl bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-500/40 cursor-pointer"
                  title="選択中のセットリストを削除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <form onSubmit={handleCreateSetlist} className="flex gap-1.5">
              <input
                type="text"
                value={newSetlistName}
                onChange={(e) => setNewSetlistName(e.target.value)}
                placeholder="新規セットリスト名を入力 (例: 80年代ドライブ用カセット)..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newSetlistName.trim()}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新規作成</span>
              </button>
            </form>
          </div>

          {/* Media Capacity & Recording Time Meter */}
          {activeSetlist && (
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>メディア録音時間ゲージ:</span>
                </span>
                <select
                  value={activeSetlist.targetMinutes || 60}
                  onChange={(e) => handleChangeTargetMinutes(parseInt(e.target.value, 10))}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-amber-300 font-semibold focus:outline-none cursor-pointer"
                >
                  {MEDIA_CAPACITY_PRESETS.map((preset) => (
                    <option key={preset.minutes} value={preset.minutes}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 font-bold">
                    合計: <strong className="text-emerald-300">{formatSecondsToMMSS(setlistDurationStats.totalSeconds)}</strong> ({activeSetlist.items.length}曲)
                  </span>
                  <span
                    className={
                      setlistDurationStats.isOverCapacity
                        ? 'text-rose-400 font-bold'
                        : 'text-slate-400'
                    }
                  >
                    {setlistDurationStats.isOverCapacity
                      ? `⚠️ 容量超過 (+${formatSecondsToMMSS(
                          setlistDurationStats.totalSeconds - setlistDurationStats.targetSeconds
                        )})`
                      : `残り ${formatSecondsToMMSS(
                          setlistDurationStats.targetSeconds - setlistDurationStats.totalSeconds
                        )}`}
                  </span>
                </div>

                <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      setlistDurationStats.isOverCapacity
                        ? 'bg-rose-500'
                        : setlistDurationStats.usagePercent > 85
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${setlistDurationStats.usagePercent}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Setlist Track Items */}
          {activeSetlist && activeSetlist.items.length > 0 ? (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
              {activeSetlist.items.map((item, idx) => {
                // Compute cumulative time up to this track for Side A / Side B indication
                const cumulativeSeconds = activeSetlist.items
                  .slice(0, idx + 1)
                  .reduce((acc, cur) => acc + parseDurationToSeconds(cur.duration), 0);
                const halfTargetSeconds = ((activeSetlist.targetMinutes || 60) * 60) / 2;
                const isSideB =
                  (activeSetlist.targetMinutes === 46 ||
                    activeSetlist.targetMinutes === 60 ||
                    activeSetlist.targetMinutes === 90) &&
                  cumulativeSeconds > halfTargetSeconds;

                return (
                  <div
                    key={item.id}
                    className="bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 rounded-xl p-2.5 flex items-center justify-between gap-2 group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="flex flex-col items-center flex-shrink-0">
                        <span className="text-[11px] font-mono font-extrabold text-indigo-300 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        {(activeSetlist.targetMinutes === 46 ||
                          activeSetlist.targetMinutes === 60 ||
                          activeSetlist.targetMinutes === 90) && (
                          <span
                            className={`text-[8px] font-mono font-bold mt-0.5 px-1 rounded ${
                              isSideB
                                ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                                : 'bg-indigo-950 text-indigo-300 border border-indigo-500/30'
                            }`}
                          >
                            {isSideB ? 'B面' : 'A面'}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-white truncate">
                          {item.trackTitle}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {item.cdArtist} • 『{item.cdTitle}』 (Tr.{item.trackNumber})
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[11px] font-mono text-emerald-300 mr-1">
                        {item.duration || '--:--'}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleMoveSetlistItem(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1 text-slate-500 hover:text-white disabled:opacity-25 cursor-pointer"
                        title="1つ上へ移動"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveSetlistItem(idx, 'down')}
                        disabled={idx === activeSetlist.items.length - 1}
                        className="p-1 text-slate-500 hover:text-white disabled:opacity-25 cursor-pointer"
                        title="1つ下へ移動"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveItemFromSetlist(item.id)}
                        className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                        title="セットリストから削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-slate-950/50 border border-dashed border-slate-800 rounded-xl p-6 text-center space-y-2">
              <FileText className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs font-bold text-slate-300">
                セットリストに曲がまだ追加されていません
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                左側の全CD横断トラック一覧から「＋リスト追加」ボタンを押すと、ここに好きな曲を集めてカセットテープ（A面/B面）やCD-Rの収録時間を自動計算できます。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
