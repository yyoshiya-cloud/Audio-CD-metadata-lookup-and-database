import React, { useState, useMemo } from 'react';
import { CDMetadata } from '../types/cd';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import {
  Disc,
  Music,
  Users,
  Calendar,
  Sparkles,
  FileSpreadsheet,
  TrendingUp,
  Tag,
  Building,
  Filter,
  ArrowRight,
  PieChart as PieIcon,
  BarChart3,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  Search,
  Database,
  Check,
  ShieldCheck,
  Layers,
  Info,
} from 'lucide-react';

interface DashboardViewProps {
  cds: CDMetadata[];
  onNavigateToLibrary: (filterKeyword?: string) => void;
  onOpenAITagging: (selected: CDMetadata[]) => void;
  onApplyBatchCDUpdate?: (updatedCDs: CDMetadata[]) => Promise<void>;
}

const PIE_COLORS = [
  '#6366f1', // Indigo
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#f43f5e', // Rose
  '#8b5cf6', // Violet
  '#64748b', // Slate
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  cds,
  onNavigateToLibrary,
  onOpenAITagging,
  onApplyBatchCDUpdate,
}) => {
  const [selectedTimeSpan, setSelectedTimeSpan] = useState<'all' | 'recent'>('all');

  // Auto-backfill modal state
  const [isBackfillModalOpen, setIsBackfillModalOpen] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState(0);
  const [backfilledResults, setBackfillResults] = useState<{ cd: CDMetadata; summary: string; fields: string[] }[] | null>(null);
  const [backfillErrorMessage, setBackfillErrorMessage] = useState<string | null>(null);

  // Analyze missing/incomplete metadata across collection
  const incompleteAnalysis = useMemo(() => {
    const missingArtist: CDMetadata[] = [];
    const missingReleaseDate: CDMetadata[] = [];
    const missingLabel: CDMetadata[] = [];
    const missingCatalogNumber: CDMetadata[] = [];
    const missingTracks: CDMetadata[] = [];

    cds.forEach((cd) => {
      const isMissingArtist = !cd.artist || cd.artist.trim() === '' || cd.artist === 'Unknown Artist' || cd.artist === 'アーティスト未登録';
      const isMissingReleaseDate = !cd.releaseDate || cd.releaseDate.trim() === '' || cd.releaseDate === '未設定';
      const isMissingLabel = !cd.label || cd.label.trim() === '' || cd.label === '未設定';
      const isMissingCatNo = !cd.catalogNumber || cd.catalogNumber.trim() === '';
      const isMissingTracks = !cd.tracks || cd.tracks.length === 0;

      if (isMissingArtist) missingArtist.push(cd);
      if (isMissingReleaseDate) missingReleaseDate.push(cd);
      if (isMissingLabel) missingLabel.push(cd);
      if (isMissingCatNo) missingCatalogNumber.push(cd);
      if (isMissingTracks) missingTracks.push(cd);
    });

    const allIncompleteCDs = Array.from(new Set([
      ...missingArtist,
      ...missingReleaseDate,
      ...missingLabel,
      ...missingCatalogNumber,
      ...missingTracks,
    ]));

    return {
      missingArtist,
      missingReleaseDate,
      missingLabel,
      missingCatalogNumber,
      missingTracks,
      allIncompleteCDs,
    };
  }, [cds]);

  // Auto-backfill handler calling Gemini server API in chunks
  const handleRunBackfill = async () => {
    const targetCDs = incompleteAnalysis.allIncompleteCDs.length > 0 ? incompleteAnalysis.allIncompleteCDs : cds;
    if (targetCDs.length === 0) return;

    setIsBackfilling(true);
    setBackfillErrorMessage(null);
    setBackfillResults(null);
    setBackfillProgress(5);

    try {
      const resultMap = new Map<string, any>();
      const CHUNK_SIZE = 6;

      for (let i = 0; i < targetCDs.length; i += CHUNK_SIZE) {
        const chunk = targetCDs.slice(i, i + CHUNK_SIZE);

        const res = await fetch('/api/ai-backfill-metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cds: chunk }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || 'Gemini APIによる自動補完処理に失敗しました');
        }

        const data = await res.json();
        const resultsList = data.results || [];
        resultsList.forEach((r: any) => resultMap.set(r.id, r));

        const doneCount = Math.min(i + chunk.length, targetCDs.length);
        setBackfillProgress(Math.round((doneCount / targetCDs.length) * 100));
      }

      const updatedCDsWithDetails: { cd: CDMetadata; summary: string; fields: string[] }[] = [];

      targetCDs.forEach((original) => {
        const b = resultMap.get(original.id);
        if (b) {
          const updated: CDMetadata = {
            ...original,
            artist: (b.artist && b.artist !== 'Unknown Artist' && b.artist !== 'アーティスト未登録') ? b.artist : original.artist,
            releaseDate: b.releaseDate || original.releaseDate,
            label: b.label || original.label,
            catalogNumber: b.catalogNumber || original.catalogNumber,
            genre: b.genre || original.genre,
            tracks: (b.tracks && b.tracks.length > 0) ? b.tracks : original.tracks,
            updatedAt: new Date().toISOString(),
            verifiedByAI: true,
            aiVerificationSummary: b.backfillSummary || original.aiVerificationSummary,
          };

          updatedCDsWithDetails.push({
            cd: updated,
            summary: b.backfillSummary || '情報をオンライン公的情報から自動補完しました',
            fields: b.backfilledFields || [],
          });
        }
      });

      setBackfillProgress(100);
      setBackfillResults(updatedCDsWithDetails);
    } catch (err: any) {
      console.error('Backfill error:', err);
      setBackfillErrorMessage(err.message || '自動補完中にエラーが発生しました');
    } finally {
      setIsBackfilling(false);
    }
  };

  const handleSaveBackfilledToLibrary = async () => {
    if (!backfilledResults || backfilledResults.length === 0) return;
    const updatedCDs = backfilledResults.map((item) => item.cd);
    if (onApplyBatchCDUpdate) {
      await onApplyBatchCDUpdate(updatedCDs);
    }
    setIsBackfillModalOpen(false);
    setBackfillResults(null);
  };

  // KPI calculations
  const totalCDs = cds.length;
  const totalTracks = useMemo(() => {
    return cds.reduce((sum, cd) => sum + (cd.tracks ? cd.tracks.length : 0), 0);
  }, [cds]);

  const uniqueArtistsCount = useMemo(() => {
    const set = new Set(cds.map((c) => c.artist?.trim()).filter(Boolean));
    return set.size;
  }, [cds]);

  const uniqueLabelsCount = useMemo(() => {
    const set = new Set(cds.map((c) => c.label?.trim()).filter(Boolean));
    return set.size;
  }, [cds]);

  const syncedCount = useMemo(() => {
    return cds.filter((c) => c.syncedToSheets).length;
  }, [cds]);

  const taggedCount = useMemo(() => {
    return cds.filter((c) => c.tags && c.tags.length > 0).length;
  }, [cds]);

  // 1. Decades Distribution
  const decadesData = useMemo(() => {
    const decadesMap: Record<string, number> = {
      '1970年代以前': 0,
      '1980年代': 0,
      '1990年代': 0,
      '2000年代': 0,
      '2010年代': 0,
      '2020年代〜': 0,
      '年代未分類': 0,
    };

    cds.forEach((cd) => {
      let year: number | null = null;
      if (cd.releaseDate) {
        const match = cd.releaseDate.match(/\b(19\d{2}|20\d{2})\b/);
        if (match) year = parseInt(match[1], 10);
      }

      // Check tags for era hints if no releaseDate
      if (!year && cd.tags) {
        if (cd.tags.some((t) => t.includes('70年代') || t.includes('昭和'))) year = 1978;
        else if (cd.tags.some((t) => t.includes('80年代'))) year = 1985;
        else if (cd.tags.some((t) => t.includes('90年代'))) year = 1995;
        else if (cd.tags.some((t) => t.includes('2000年代'))) year = 2005;
        else if (cd.tags.some((t) => t.includes('2010年代'))) year = 2015;
        else if (cd.tags.some((t) => t.includes('2020年代') || t.includes('令和'))) year = 2022;
      }

      if (year === null) {
        decadesMap['年代未分類'] += 1;
      } else if (year < 1980) {
        decadesMap['1970年代以前'] += 1;
      } else if (year < 1990) {
        decadesMap['1980年代'] += 1;
      } else if (year < 2000) {
        decadesMap['1990年代'] += 1;
      } else if (year < 2010) {
        decadesMap['2000年代'] += 1;
      } else if (year < 2020) {
        decadesMap['2010年代'] += 1;
      } else {
        decadesMap['2020年代〜'] += 1;
      }
    });

    return Object.entries(decadesMap).map(([decade, count]) => ({
      decade,
      count,
      percentage: totalCDs > 0 ? Math.round((count / totalCDs) * 100) : 0,
    }));
  }, [cds, totalCDs]);

  // 2. Genre Distribution
  const genreData = useMemo(() => {
    const map: Record<string, number> = {};

    cds.forEach((cd) => {
      let g = '';
      if (cd.tags && cd.tags.length > 0) {
        // Look for common genre in tags first so removed tags in cd.genre don't skew stats
        const genreTag = cd.tags.find((t) =>
          ['J-Pop', 'J-POP', 'シティポップ', 'ロック', '昭和歌謡', '歌謡曲', 'ニューミュージック', 'ジャズ', 'アニソン', 'アニメソング', 'アイドル', 'R&B', 'ヒップホップ', 'クラシック', 'フォーク', 'AOR', 'シンガーソングライター'].includes(t)
        );
        if (genreTag) g = genreTag === 'J-POP' ? 'J-Pop' : genreTag;
      }
      if (!g && cd.genre?.trim()) {
        g = cd.genre.trim() === 'J-POP' ? 'J-Pop' : cd.genre.trim();
      }

      const finalGenre = g || '未分類 / その他';
      map[finalGenre] = (map[finalGenre] || 0) + 1;
    });

    const entries = Object.entries(map).map(([name, value]) => ({
      name,
      value,
      percentage: totalCDs > 0 ? Math.round((value / totalCDs) * 100) : 0,
    }));

    // Sort descending and keep top 7, group rest as "その他"
    entries.sort((a, b) => b.value - a.value);
    if (entries.length > 7) {
      const top7 = entries.slice(0, 6);
      const otherCount = entries.slice(6).reduce((sum, item) => sum + item.value, 0);
      top7.push({
        name: 'その他',
        value: otherCount,
        percentage: totalCDs > 0 ? Math.round((otherCount / totalCDs) * 100) : 0,
      });
      return top7;
    }
    return entries;
  }, [cds, totalCDs]);

  // 3. Top Artists Distribution
  const topArtistsData = useMemo(() => {
    const map: Record<string, { albumCount: number; trackCount: number }> = {};

    cds.forEach((cd) => {
      const artist = cd.artist?.trim() || 'アーティスト未登録';
      if (!map[artist]) {
        map[artist] = { albumCount: 0, trackCount: 0 };
      }
      map[artist].albumCount += 1;
      map[artist].trackCount += cd.tracks ? cd.tracks.length : 0;
    });

    return Object.entries(map)
      .map(([artist, data]) => ({
        artist,
        albums: data.albumCount,
        tracks: data.trackCount,
      }))
      .sort((a, b) => b.albums - a.albums || b.tracks - a.tracks)
      .slice(0, 10);
  }, [cds]);

  // 4. Top Record Labels Distribution
  const topLabelsData = useMemo(() => {
    const map: Record<string, number> = {};

    cds.forEach((cd) => {
      const label = cd.label?.trim() || 'レーベル未登録';
      map[label] = (map[label] || 0) + 1;
    });

    return Object.entries(map)
      .map(([label, count]) => ({
        label: label.length > 18 ? label.slice(0, 18) + '…' : label,
        fullName: label,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [cds]);

  // 5. Top Tags Cloud / Ranking
  const topTagsData = useMemo(() => {
    const map: Record<string, number> = {};

    cds.forEach((cd) => {
      (cd.tags || []).forEach((tag) => {
        const t = tag.trim();
        if (t) map[t] = (map[t] || 0) + 1;
      });
    });

    return Object.entries(map)
      .map(([tag, count]) => ({
        tag,
        count,
        percentage: totalCDs > 0 ? Math.round((count / totalCDs) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [cds, totalCDs]);

  // Empty state handling
  if (totalCDs === 0) {
    return (
      <div className="bg-slate-800/40 rounded-2xl border border-slate-700/60 p-12 text-center text-slate-400 space-y-4 my-6">
        <Disc className="w-16 h-16 text-slate-600 mx-auto animate-spin-slow" />
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">ライブラリに分析可能なCDがありません</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            CDを検索・登録すると、アーティスト、ジャンル、リリース年代などの統計グラフが自動生成されます。
          </p>
        </div>
        <button
          onClick={() => onNavigateToLibrary()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-all"
        >
          <span>ライブラリ画面へ移動</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-130px)] space-y-4 pb-2">
      
      {/* Dashboard Top Banner (Fixed at top) */}
      <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <span>CDコレクション 分析ダッシュボード</span>
            </h2>
            <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-mono">
              Live Data
            </span>
          </div>
          <p className="text-xs text-slate-400">
            ライブラリに保存された {totalCDs} 枚のアルバム、{totalTracks} 曲のメタデータを多角的に可視化
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onOpenAITagging([])}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md shadow-purple-900/30 transition-all"
            title="Gemini AI で未分類CDを自動タグ付け"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-200" />
            <span>AIで未分析CDをタグ付け</span>
          </button>

          <button
            onClick={() => onNavigateToLibrary()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <span>ライブラリ一覧へ</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Dashboard Body (KPIs, Charts, Clouds) */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1 pb-6">
        
        {/* Gemini AI Missing Metadata Auto-Backfill Card */}
        <div className="bg-gradient-to-r from-slate-900 via-purple-950/40 to-slate-900 border border-purple-500/40 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="p-1.5 rounded-lg bg-purple-600/30 border border-purple-400/40 text-purple-300">
                  <Sparkles className="w-5 h-5 text-purple-300 animate-pulse" />
                </span>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Gemini AI オンライン公的情報からの未入力メタデータ自動補完</span>
                </h3>
                <span className="text-[10px] font-mono font-bold text-purple-200 bg-purple-900/80 px-2.5 py-0.5 rounded-full border border-purple-400/40">
                  Web & NDL/MusicBrainz照合
                </span>
              </div>
              <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                コレクション内の全CDデータから、アーティスト名や発売年月日、レーベル（発売元）、規格品番（型番）、曲順などの空欄・未入力項目を自動検出。Gemini APIがWeb上の公的音楽データベースから正しい情報を自動検索して補完します。
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsBackfillModalOpen(true)}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white shadow-lg shadow-emerald-900/40 border border-emerald-400/40 transition-all cursor-pointer flex-shrink-0"
            >
              <Sparkles className="w-4 h-4 text-emerald-200" />
              <span>
                {incompleteAnalysis.allIncompleteCDs.length > 0
                  ? `${incompleteAnalysis.allIncompleteCDs.length}件の未入力CDをAI自動補完`
                  : '全CDメタデータをAIで再検証・補完'}
              </span>
            </button>
          </div>

          {/* Incomplete items breakdown badges */}
          <div className="flex flex-wrap items-center gap-2 text-xs pt-2 border-t border-purple-900/40">
            <span className="text-slate-400 text-[11px] font-medium">ライブラリの空欄検出ステータス:</span>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
              incompleteAnalysis.missingArtist.length > 0
                ? 'bg-rose-950/70 border-rose-700/60 text-rose-300 font-bold'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}>
              🎤 アーティスト未設定: {incompleteAnalysis.missingArtist.length}件
            </span>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
              incompleteAnalysis.missingReleaseDate.length > 0
                ? 'bg-amber-950/70 border-amber-700/60 text-amber-300 font-bold'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}>
              📅 発売年月日未設定: {incompleteAnalysis.missingReleaseDate.length}件
            </span>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
              incompleteAnalysis.missingLabel.length > 0
                ? 'bg-indigo-950/70 border-indigo-700/60 text-indigo-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}>
              🏷️ レーベル未設定: {incompleteAnalysis.missingLabel.length}件
            </span>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
              incompleteAnalysis.missingCatalogNumber.length > 0
                ? 'bg-purple-950/70 border-purple-700/60 text-purple-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}>
              💿 規格品番未設定: {incompleteAnalysis.missingCatalogNumber.length}件
            </span>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
              incompleteAnalysis.missingTracks.length > 0
                ? 'bg-pink-950/70 border-pink-700/60 text-pink-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}>
              🎵 収録曲数0: {incompleteAnalysis.missingTracks.length}件
            </span>
          </div>
        </div>
        {/* KPI Overview Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        
        {/* Total Albums */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-4 space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-medium">総CDアルバム</span>
            <Disc className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-white">{totalCDs}</p>
          <p className="text-[10px] text-slate-400">コレクション登録数</p>
        </div>

        {/* Total Tracks */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-4 space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-medium">総収録曲数</span>
            <Music className="w-4 h-4 text-pink-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-white">{totalTracks}</p>
          <p className="text-[10px] text-slate-400">平均 {Math.round(totalTracks / (totalCDs || 1))} 曲/枚</p>
        </div>

        {/* Unique Artists */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-4 space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-medium">アーティスト数</span>
            <Users className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-white">{uniqueArtistsCount}</p>
          <p className="text-[10px] text-slate-400">重複を除く歌手・バンド</p>
        </div>

        {/* Unique Labels */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-4 space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-medium">登録レーベル数</span>
            <Building className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-white">{uniqueLabelsCount}</p>
          <p className="text-[10px] text-slate-400">レコード会社・発売元</p>
        </div>

        {/* Google Sheets Synced */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-4 space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-medium">スプレッドシート同期</span>
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl font-bold font-mono text-white">{syncedCount}</p>
            <span className="text-xs text-emerald-400 font-bold">
              ({Math.round((syncedCount / (totalCDs || 1)) * 100)}%)
            </span>
          </div>
          <p className="text-[10px] text-slate-400">連携済みレコード</p>
        </div>

        {/* AI Tagged Rate */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-4 space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-medium">AIタグ付与率</span>
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl font-bold font-mono text-white">{taggedCount}</p>
            <span className="text-xs text-purple-300 font-bold">
              ({Math.round((taggedCount / (totalCDs || 1)) * 100)}%)
            </span>
          </div>
          <p className="text-[10px] text-slate-400">ジャンル・ムード分類済</p>
        </div>

      </div>

      {/* Row 1: Decades Distribution & Genre Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* CHART 1: Decades / Era BarChart */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-400" />
                <span>リリース年代別の分布</span>
              </h3>
              <p className="text-[11px] text-slate-400">年代・時代区分ごとの保有アルバム数</p>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">全 {totalCDs} 枚</span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={decadesData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis
                  dataKey="decade"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-xl shadow-xl text-xs space-y-1">
                          <p className="font-bold text-white">{label}</p>
                          <p className="text-indigo-300 font-mono font-bold">
                            {data.count} 枚 ({data.percentage}%)
                          </p>
                          <p className="text-[10px] text-slate-400">クリックで一覧を絞り込み</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#6366f1"
                  radius={[6, 6, 0, 0]}
                  onClick={(entry: any) => {
                    const dec = entry?.decade || entry?.payload?.decade;
                    if (dec) {
                      onNavigateToLibrary(dec.replace('年代', '').replace('〜', '').replace('以前', ''));
                    }
                  }}
                  cursor="pointer"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 2: Genre Distribution PieChart */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-purple-400" />
                <span>音楽ジャンル・スタイルの構成比</span>
              </h3>
              <p className="text-[11px] text-slate-400">J-POP, ロック, シティポップ, 歌謡曲等の比率</p>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">{genreData.length} ジャンル</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={genreData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    onClick={(entry) => {
                      if (entry && entry.name && entry.name !== 'その他') {
                        onNavigateToLibrary(entry.name);
                      }
                    }}
                    cursor="pointer"
                  >
                    {genreData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                        stroke="#1e293b"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        return (
                          <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-xl shadow-xl text-xs space-y-1">
                            <p className="font-bold text-white">{item.name}</p>
                            <p className="text-purple-300 font-mono font-bold">
                              {item.value} 枚 ({item.percentage}%)
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Custom Interactive Legend */}
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {genreData.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => item.name !== 'その他' && onNavigateToLibrary(item.name)}
                  className="flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-700/50 cursor-pointer transition-colors text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                    />
                    <span className="text-slate-200 truncate font-medium">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-slate-400 text-[11px] flex-shrink-0">
                    <span className="font-bold text-white">{item.value}枚</span>
                    <span className="text-slate-500 w-9 text-right">({item.percentage}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Row 2: Top Artists & Top Record Labels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* CHART 3: Top Artists BarChart (Horizontal) */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>保有枚数 TOP 10 アーティスト</span>
              </h3>
              <p className="text-[11px] text-slate-400">アルバム数および総収録曲数のランキング</p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={topArtistsData}
                margin={{ top: 10, right: 20, left: 35, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="artist"
                  tick={{ fill: '#cbd5e1', fontSize: 11 }}
                  width={110}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-xl shadow-xl text-xs space-y-1">
                          <p className="font-bold text-white">{data.artist}</p>
                          <p className="text-cyan-300 font-mono">アルバム: {data.albums} 枚</p>
                          <p className="text-slate-400 font-mono">収録曲: {data.tracks} 曲</p>
                          <p className="text-[10px] text-slate-500">クリックしてこのアーティストで検索</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey="albums"
                  name="アルバム数"
                  fill="#06b6d4"
                  radius={[0, 6, 6, 0]}
                  onClick={(entry: any) => {
                    const art = entry?.artist || entry?.payload?.artist;
                    if (art) onNavigateToLibrary(art);
                  }}
                  cursor="pointer"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 4: Top Record Labels */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Building className="w-4 h-4 text-emerald-400" />
                <span>主要レコードレーベル TOP 8</span>
              </h3>
              <p className="text-[11px] text-slate-400">発売元・レコード会社別の作品数</p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topLabelsData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-xl shadow-xl text-xs space-y-1">
                          <p className="font-bold text-white">{data.fullName}</p>
                          <p className="text-emerald-300 font-mono font-bold">{data.count} 枚</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#10b981"
                  radius={[6, 6, 0, 0]}
                  onClick={(entry: any) => {
                    const lab = entry?.fullName || entry?.payload?.fullName;
                    if (lab) onNavigateToLibrary(lab);
                  }}
                  cursor="pointer"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Row 3: AI Tag Cloud & Mood Keywords */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Tag className="w-4 h-4 text-purple-400" />
              <span>AIタグ・ムード・キーワード 分布</span>
            </h3>
            <p className="text-[11px] text-slate-400">Gemini AI が分析・付与したタグの上位一覧（クリックで絞り込み）</p>
          </div>

          <button
            onClick={() => onOpenAITagging([])}
            className="text-xs text-purple-300 hover:text-white flex items-center gap-1 font-medium underline"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI自動タグ付けを実行</span>
          </button>
        </div>

        {topTagsData.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap pt-2">
            {topTagsData.map((item, idx) => (
              <button
                key={idx}
                onClick={() => onNavigateToLibrary(item.tag)}
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-purple-950/60 border border-slate-700 hover:border-purple-500/50 text-xs transition-all shadow-sm"
              >
                <span className="text-purple-300 font-bold group-hover:text-purple-200">#{item.tag}</span>
                <span className="text-[10px] bg-slate-800 group-hover:bg-purple-900 text-slate-400 group-hover:text-purple-200 px-1.5 py-0.2 rounded-full font-mono">
                  {item.count}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-6 bg-slate-900/50 rounded-xl text-center text-xs text-slate-400 space-y-2">
            <p>タグが付与されたCDがまだありません。</p>
            <button
              onClick={() => onOpenAITagging([])}
              className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs"
            >
              Gemini AI で自動タグ付けを実行
            </button>
          </div>
        )}
      </div>

      </div>

      {/* Gemini AI Metadata Auto-Backfill Modal */}
      {isBackfillModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-purple-500/40 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-purple-950/80 via-slate-900 to-indigo-950/80 border-b border-purple-800/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-purple-600/30 border border-purple-400/40 text-purple-300">
                  <Sparkles className="w-5 h-5 text-purple-300" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Gemini AI オンライン公的情報からの未入力メタデータ自動補完
                  </h3>
                  <p className="text-xs text-slate-300">
                    対象: {incompleteAnalysis.allIncompleteCDs.length > 0 ? `${incompleteAnalysis.allIncompleteCDs.length} 件の未入力項目を含むCD` : `全 ${cds.length} 件のCD`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsBackfillModalOpen(false);
                  setBackfillResults(null);
                  setBackfillErrorMessage(null);
                }}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              
              {/* Progress State */}
              {isBackfilling && (
                <div className="bg-slate-800/80 border border-purple-500/30 rounded-xl p-8 text-center space-y-4">
                  <div className="relative w-16 h-16 mx-auto">
                    <div className="absolute inset-0 rounded-full border-4 border-purple-500/20 animate-ping" />
                    <div className="w-16 h-16 rounded-full border-4 border-purple-500 border-t-transparent animate-spin flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-purple-400" />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Gemini APIでオンライン公的情報を調査中...</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      国会図書館NDL、MusicBrainz、Discogs、iTunesなどの公式情報から正しいアーティスト名・発売日・規格品番を照合・補完しています
                    </p>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-700 max-w-md mx-auto">
                    <div
                      className="bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 h-full transition-all duration-300"
                      style={{ width: `${backfillProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error Alert */}
              {backfillErrorMessage && (
                <div className="p-4 bg-rose-950/60 border border-rose-700/60 rounded-xl text-rose-200 flex items-center gap-2.5">
                  <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                  <span>{backfillErrorMessage}</span>
                </div>
              )}

              {/* Results View */}
              {backfilledResults && backfilledResults.length > 0 && !isBackfilling && (
                <div className="space-y-4">
                  <div className="p-4 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-200 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                      <div>
                        <h4 className="font-bold text-sm text-white">
                          Gemini AIによる自動補完が正常に完了しました！
                        </h4>
                        <p className="text-xs text-emerald-300">
                          {backfilledResults.length} 件のCDアルバムでオンライン公的情報から未入力情報（アーティスト名、発売日、レーベル等）を補完しました。
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveBackfilledToLibrary}
                      className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0"
                    >
                      <Check className="w-4 h-4" />
                      <span>補完結果をライブラリに反映・保存</span>
                    </button>
                  </div>

                  {/* Table of Backfilled items */}
                  <div className="border border-slate-700/80 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-800/90 text-slate-300 font-bold sticky top-0 border-b border-slate-700 text-[11px]">
                        <tr>
                          <th className="p-3">CDタイトル</th>
                          <th className="p-3">補完後アーティスト</th>
                          <th className="p-3">補完後発売年月日</th>
                          <th className="p-3">補完後レーベル / 規格品番</th>
                          <th className="p-3">補完サマリー</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-900/60">
                        {backfilledResults.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                            <td className="p-3 font-bold text-white max-w-[150px] truncate" title={item.cd.title}>
                              {item.cd.title}
                            </td>
                            <td className="p-3 text-indigo-300 font-semibold max-w-[130px] truncate" title={item.cd.artist}>
                              {item.cd.artist || '-'}
                            </td>
                            <td className="p-3 font-mono text-emerald-300">
                              {item.cd.releaseDate || '-'}
                            </td>
                            <td className="p-3 text-slate-300 max-w-[140px] truncate">
                              <div>{item.cd.label || '-'}</div>
                              {item.cd.catalogNumber && (
                                <div className="text-[10px] font-mono text-indigo-400 font-bold">{item.cd.catalogNumber}</div>
                              )}
                            </td>
                            <td className="p-3 text-slate-300 text-[11px]">
                              <span className="text-purple-300 bg-purple-950/60 border border-purple-500/30 px-2 py-0.5 rounded block">
                                {item.summary}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Initial Preview before running */}
              {!backfilledResults && !isBackfilling && (
                <div className="space-y-4">
                  <div className="p-4 bg-purple-950/40 border border-purple-800/40 rounded-xl space-y-2">
                    <h4 className="font-bold text-purple-200 flex items-center gap-1.5 text-xs">
                      <Info className="w-4 h-4 text-purple-400" />
                      自動補完機能のしくみ
                    </h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      「CDタイトル」や「型番（規格品番）」、「既存の曲名」などの情報をキーとして、Gemini 3.8 Flashが国会図書館NDL、MusicBrainz、Discogs、iTunes Japan等の公的ディスコグラフィ情報をオンライン検索・照合し、空欄になっているアーティスト名や発売日、レーベル名、曲順を正確に自動補完します。
                    </p>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-bold text-slate-200 text-xs flex items-center justify-between">
                      <span>補完対象CDリスト ({incompleteAnalysis.allIncompleteCDs.length > 0 ? incompleteAnalysis.allIncompleteCDs.length : cds.length} 件)</span>
                      <span className="text-[10px] text-slate-400">※既存の正しい情報は保持され、空欄・未設定箇所のみが上書き・入力されます</span>
                    </h4>

                    <div className="border border-slate-700/80 rounded-xl max-h-60 overflow-y-auto divide-y divide-slate-800 bg-slate-900/60">
                      {(incompleteAnalysis.allIncompleteCDs.length > 0 ? incompleteAnalysis.allIncompleteCDs : cds).map((cd) => (
                        <div key={cd.id} className="p-3 flex items-center justify-between gap-3 hover:bg-slate-800/50">
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-white truncate">{cd.title}</p>
                            <p className="text-slate-400 text-[11px] truncate">
                              アーティスト: <span className="text-slate-200 font-semibold">{cd.artist || '未設定 (空欄)'}</span> |
                              型番: <span className="font-mono text-slate-300">{cd.catalogNumber || '未設定'}</span> |
                              発売日: <span className="text-slate-300">{cd.releaseDate || '未設定'}</span>
                            </p>
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                            {(!cd.artist || cd.artist === 'Unknown Artist' || cd.artist === 'アーティスト未登録') && (
                              <span className="text-[10px] bg-rose-950 text-rose-300 border border-rose-700/50 px-2 py-0.5 rounded font-bold">
                                🎤 歌手空欄
                              </span>
                            )}
                            {(!cd.releaseDate || cd.releaseDate === '未設定') && (
                              <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded font-bold">
                                📅 発売日空欄
                              </span>
                            )}
                            {(!cd.label || cd.label === '未設定') && (
                              <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-700/50 px-2 py-0.5 rounded">
                                🏷️ レーベル空欄
                              </span>
                            )}
                            {(!cd.tracks || cd.tracks.length === 0) && (
                              <span className="text-[10px] bg-pink-950 text-pink-300 border border-pink-700/50 px-2 py-0.5 rounded">
                                🎵 収録曲0
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsBackfillModalOpen(false);
                  setBackfillResults(null);
                  setBackfillErrorMessage(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                閉じる
              </button>

              {!backfilledResults && (
                <button
                  type="button"
                  disabled={isBackfilling}
                  onClick={handleRunBackfill}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 via-indigo-600 to-emerald-600 hover:from-purple-500 hover:to-emerald-500 text-white shadow-lg shadow-purple-900/40 disabled:opacity-50 transition-all flex items-center gap-2 cursor-pointer"
                >
                  {isBackfilling ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Gemini AIでオンライン調査・補完中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-purple-200" />
                      <span>Gemini AIでオンライン公的情報から補完を実行</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
