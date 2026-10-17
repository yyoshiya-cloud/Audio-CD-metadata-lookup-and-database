import React from 'react';
import {
  LogIn,
  LogOut,
  Database,
  Sparkles,
  Key,
  BarChart3,
  Copy,
  Info,
  LayoutGrid,
  ListMusic,
  Sun,
  Moon,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { User } from 'firebase/auth';

interface HeaderProps {
  user: User | null;
  totalCDsCount: number;
  configuredApiKeysCount: number;
  duplicateCount?: number;
  onOpenAPISettings: () => void;
  onOpenAppInfo: () => void;
  onOpenAdminMode?: () => void;
  onLogin: () => void;
  onLogout: () => void;
  activeTab: 'search' | 'database' | 'gallery' | 'tracks' | 'dashboard' | 'duplicates';
  setActiveTab: (tab: 'search' | 'database' | 'gallery' | 'tracks' | 'dashboard' | 'duplicates') => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  isCompactHeader?: boolean;
  onToggleCompactHeader?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  totalCDsCount,
  configuredApiKeysCount,
  duplicateCount,
  onOpenAPISettings,
  onOpenAppInfo,
  onOpenAdminMode,
  onLogin,
  onLogout,
  activeTab,
  setActiveTab,
  isDarkMode = true,
  onToggleTheme,
  isCompactHeader = false,
  onToggleCompactHeader,
}) => {
  const clickTimestampsRef = React.useRef<number[]>([]);

  const handleTitleTripleClick = () => {
    if (!onOpenAdminMode) return;
    const now = Date.now();
    const recentClicks = clickTimestampsRef.current.filter((t) => now - t < 900);
    recentClicks.push(now);
    clickTimestampsRef.current = recentClicks;

    if (recentClicks.length >= 3) {
      clickTimestampsRef.current = [];
      onOpenAdminMode();
    }
  };

  return (
    <header className={`sticky top-0 z-40 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800 transition-all duration-200 shadow-xl shadow-black/40 ${
      isCompactHeader ? 'px-3 py-1.5 shadow-md' : 'px-3 sm:px-4 py-2.5'
    }`}>
      <div className="w-full flex flex-row items-center justify-between gap-2 sm:gap-2.5 flex-nowrap overflow-x-auto scrollbar-none">
        
        {/* App Brand (Far Left Corner) */}
        <div 
          onClick={handleTitleTripleClick}
          className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0 cursor-pointer select-none group"
          title="3回クリックで管理者モード"
        >
          <div className={`rounded-xl overflow-hidden shadow-lg shadow-indigo-600/40 ring-1 ring-white/20 flex-shrink-0 bg-slate-900 group-hover:ring-indigo-400/60 transition-all ${
            isCompactHeader ? 'w-7 h-7' : 'w-8 h-8 sm:w-9 sm:h-9'
          }`}>
            <img src="/app-icon.svg" alt="App Icon" className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 whitespace-nowrap leading-tight">
              <h1
                className={`font-black text-white tracking-tight group-hover:text-indigo-200 transition-colors ${
                  isCompactHeader ? 'text-xs' : 'text-sm'
                }`}
              >
                CD メタデータ DB
              </h1>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-xs">
                6-API
              </span>
            </div>
            {!isCompactHeader && (
              <p className="text-[9px] text-slate-400 whitespace-nowrap hidden xl:block leading-tight mt-0.5">
                MusicBrainz · Discogs · iTunes · NDL · Spotify · 楽天ブックス
              </p>
            )}
          </div>
        </div>

        {/* Navigation Tabs (Centered / Prominent) */}
        <nav className={`flex items-center bg-slate-900/95 rounded-2xl border border-slate-800 shadow-inner shadow-black/40 flex-shrink-0 gap-0.5 sm:gap-1 ${
          isCompactHeader ? 'p-0.5' : 'p-1'
        }`}>
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-1.5 rounded-xl font-bold whitespace-nowrap transition-all duration-150 cursor-pointer ${
              isCompactHeader ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs'
            } ${
              activeTab === 'search'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-lg shadow-indigo-950/80 border border-indigo-400/40 scale-[1.01]'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" />
            <span>Web検索・取得</span>
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`flex items-center gap-1.5 rounded-xl font-bold whitespace-nowrap transition-all duration-150 cursor-pointer ${
              isCompactHeader ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs'
            } ${
              activeTab === 'database'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-lg shadow-indigo-950/80 border border-indigo-400/40 scale-[1.01]'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" />
            <span>登録ライブラリ</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black ${
              activeTab === 'database'
                ? 'bg-indigo-950/90 text-white border border-indigo-300/40 shadow-xs'
                : 'bg-slate-800 text-indigo-300 border border-slate-700'
            }`}>
              {totalCDsCount}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('gallery')}
            className={`flex items-center gap-1.5 rounded-xl font-bold whitespace-nowrap transition-all duration-150 cursor-pointer ${
              isCompactHeader ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs'
            } ${
              activeTab === 'gallery'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-lg shadow-indigo-950/80 border border-indigo-400/40 scale-[1.01]'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" />
            <span>ギャラリー</span>
          </button>
          <button
            onClick={() => setActiveTab('tracks')}
            className={`flex items-center gap-1.5 rounded-xl font-bold whitespace-nowrap transition-all duration-150 cursor-pointer ${
              isCompactHeader ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs'
            } ${
              activeTab === 'tracks'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-950/80 border border-emerald-400/40 scale-[1.01]'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <ListMusic className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />
            <span>収録曲・セットリスト</span>
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-1.5 rounded-xl font-bold whitespace-nowrap transition-all duration-150 cursor-pointer ${
              isCompactHeader ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs'
            } ${
              activeTab === 'dashboard'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-950/80 border border-purple-400/40 scale-[1.01]'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-purple-300 flex-shrink-0" />
            <span>分析</span>
          </button>
          <button
            onClick={() => setActiveTab('duplicates')}
            className={`flex items-center gap-1.5 rounded-xl font-bold whitespace-nowrap transition-all duration-150 cursor-pointer ${
              isCompactHeader ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs'
            } ${
              activeTab === 'duplicates'
                ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg shadow-amber-950/80 border border-amber-400/40 scale-[1.01]'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <Copy className="w-3.5 h-3.5 text-amber-300 flex-shrink-0" />
            <span>重複チェック</span>
            {!!duplicateCount && duplicateCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black animate-pulse ${
                activeTab === 'duplicates'
                  ? 'bg-white/20 text-white border border-white/40'
                  : 'bg-amber-950 text-amber-200 border border-amber-500/50'
              }`}>
                {duplicateCount}
              </span>
            )}
          </button>
        </nav>

        {/* Action Buttons, Visual Toggles & Profile */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Header Compact / Expanded Toggle Button */}
          {onToggleCompactHeader && (
            <button
              type="button"
              onClick={onToggleCompactHeader}
              className="p-1.5 sm:p-2 rounded-xl text-slate-300 hover:text-white bg-slate-850 hover:bg-slate-800 border border-slate-700/90 transition-all cursor-pointer shadow-md shadow-black/20"
              title={isCompactHeader ? 'ヘッダーを標準サイズに戻す' : 'ヘッダーをコンパクトにして作業領域を拡大'}
            >
              {isCompactHeader ? (
                <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
              ) : (
                <Minimize2 className="w-3.5 h-3.5 text-slate-300" />
              )}
            </button>
          )}

          {/* Dark / Light Theme Toggle Button */}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="p-1.5 sm:p-2 rounded-xl text-slate-300 hover:text-white bg-slate-850 hover:bg-slate-800 border border-slate-700/90 transition-all cursor-pointer shadow-md shadow-black/20"
              title={isDarkMode ? 'おとなしいライトモードに切り替え（目に優しい低刺激トーン）' : 'ダークモードに切り替え'}
            >
              {isDarkMode ? (
                <Sun className="w-3.5 h-3.5 text-amber-400 hover:rotate-45 transition-transform" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-indigo-400 hover:-rotate-12 transition-transform" />
              )}
            </button>
          )}

          <button
            onClick={onOpenAppInfo}
            className={`flex items-center gap-1.5 rounded-xl font-bold bg-slate-850 hover:bg-slate-800 text-slate-100 hover:text-white border border-slate-700/95 hover:border-indigo-500/50 whitespace-nowrap transition-all duration-150 cursor-pointer shadow-md shadow-black/20 ${
              isCompactHeader ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs'
            }`}
            title="アプリ情報・機能一覧"
          >
            <Info className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
            <span className="whitespace-nowrap hidden xl:inline">アプリ情報</span>
          </button>

          <button
            onClick={onOpenAPISettings}
            className={`flex items-center gap-1.5 rounded-xl font-bold bg-slate-850 hover:bg-slate-800 text-slate-100 hover:text-white border border-slate-700/95 hover:border-amber-500/50 whitespace-nowrap transition-all duration-150 cursor-pointer shadow-md shadow-black/20 ${
              isCompactHeader ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs'
            }`}
            title="API利用登録・APIキー設定"
          >
            <Key className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="whitespace-nowrap hidden xl:inline">API利用登録</span>
            {configuredApiKeysCount > 0 && (
              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded-full border border-amber-500/40 font-mono font-bold">
                {configuredApiKeysCount}キー
              </span>
            )}
          </button>

          {/* Auth Button */}
          {user ? (
            <div className={`flex items-center gap-2 bg-slate-850 rounded-xl border border-slate-700/95 whitespace-nowrap shadow-md shadow-black/20 ${
              isCompactHeader ? 'pl-1.5 pr-2 py-1' : 'pl-2 pr-2.5 py-1.5'
            }`}>
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || 'User'} className="w-5 h-5 rounded-full border border-slate-600 object-cover flex-shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold flex-shrink-0">
                  {user.displayName ? user.displayName[0] : 'G'}
                </div>
              )}
              <span className="text-xs font-semibold text-slate-100 max-w-[85px] truncate">
                {user.displayName || user.email?.split('@')[0]}
              </span>
              <button
                onClick={onLogout}
                className="p-1 text-slate-400 hover:text-rose-400 transition-colors rounded-lg hover:bg-slate-750 cursor-pointer ml-0.5"
                title="ログアウト"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onLogin}
              className={`flex items-center gap-1.5 rounded-xl font-bold bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-lg shadow-indigo-600/30 whitespace-nowrap transition-all duration-150 cursor-pointer border border-indigo-400/50 ${
                isCompactHeader ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 sm:py-2 text-xs'
              }`}
              title="Googleアカウントでサインイン"
            >
              <LogIn className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="whitespace-nowrap">Google ログイン</span>
            </button>
          )}
        </div>

      </div>
    </header>
  );
};
