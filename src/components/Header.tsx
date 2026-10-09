import React from 'react';
import { LogIn, LogOut, Database, Sparkles, Key, BarChart3, Copy, Info, LayoutGrid, ListMusic } from 'lucide-react';
import { User } from 'firebase/auth';

interface HeaderProps {
  user: User | null;
  totalCDsCount: number;
  configuredApiKeysCount: number;
  duplicateCount?: number;
  onOpenAPISettings: () => void;
  onOpenAppInfo: () => void;
  onLogin: () => void;
  onLogout: () => void;
  activeTab: 'search' | 'database' | 'gallery' | 'tracks' | 'dashboard' | 'duplicates';
  setActiveTab: (tab: 'search' | 'database' | 'gallery' | 'tracks' | 'dashboard' | 'duplicates') => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  totalCDsCount,
  configuredApiKeysCount,
  duplicateCount,
  onOpenAPISettings,
  onOpenAppInfo,
  onLogin,
  onLogout,
  activeTab,
  setActiveTab,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-lg border-b border-slate-800/80 px-3 sm:px-5 py-2.5 shadow-md">
      <div className="w-full flex flex-row items-center justify-between gap-3 flex-nowrap overflow-x-auto scrollbar-none">
        
        {/* App Brand (Far Left Corner) */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl overflow-hidden shadow-lg shadow-indigo-600/30 ring-1 ring-white/20 flex-shrink-0 bg-slate-900">
            <img src="/app-icon.svg" alt="App Icon" className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <h1 className="text-sm font-extrabold text-white tracking-tight">
                CD メタデータ DB
              </h1>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                6-API 統合検索
              </span>
            </div>
            <p className="text-[10px] text-slate-400 whitespace-nowrap hidden md:block">
              MusicBrainz · Discogs · iTunes · NDL · Spotify · 楽天ブックス
            </p>
          </div>
        </div>

        {/* Navigation Tabs (Centered / Prominent) */}
        <nav className="flex items-center p-1 bg-slate-900/90 rounded-xl border border-slate-800 shadow-inner flex-shrink-0">
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'search'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
            <span>Web検索・メタデータ取得</span>
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'database'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-indigo-300" />
            <span>登録ライブラリ</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
              activeTab === 'database'
                ? 'bg-indigo-900/80 text-white'
                : 'bg-slate-800 text-slate-300 border border-slate-700'
            }`}>
              {totalCDsCount}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('gallery')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'gallery'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-indigo-300" />
            <span>ジャケットギャラリー</span>
          </button>
          <button
            onClick={() => setActiveTab('tracks')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'tracks'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <ListMusic className="w-3.5 h-3.5 text-emerald-300" />
            <span>収録曲検索・セットリスト</span>
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-purple-300" />
            <span>コレクション分析</span>
          </button>
          <button
            onClick={() => setActiveTab('duplicates')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'duplicates'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-950'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Copy className="w-3.5 h-3.5 text-amber-300" />
            <span>重複チェック</span>
            {!!duplicateCount && duplicateCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold bg-amber-950 text-amber-200 border border-amber-500/40 animate-pulse">
                {duplicateCount}
              </span>
            )}
          </button>
        </nav>

        {/* Action Buttons & Profile */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 shadow-sm whitespace-nowrap select-none"
            title="Dexie.js (IndexedDB) ローカルデータベース稼働中：容量・書き込み制限なし・オフライン高速対応"
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">IndexedDB (Dexie) 高速保存</span>
          </div>

          <button
            onClick={onOpenAppInfo}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-slate-700 whitespace-nowrap transition-all cursor-pointer shadow-sm"
            title="アプリ情報・機能一覧"
          >
            <Info className="w-3.5 h-3.5 text-indigo-400" />
            <span className="whitespace-nowrap hidden sm:inline">アプリ情報</span>
          </button>

          <button
            onClick={onOpenAPISettings}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-slate-700 whitespace-nowrap transition-all cursor-pointer shadow-sm"
            title="API利用登録・APIキー設定"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span className="whitespace-nowrap hidden sm:inline">API利用登録</span>
            {configuredApiKeysCount > 0 && (
              <span className="text-[10px] bg-amber-950/80 text-amber-300 px-1.5 py-0.2 rounded-full border border-amber-500/30 font-mono font-bold">
                {configuredApiKeysCount}キー
              </span>
            )}
          </button>

          {/* Auth Button */}
          {user ? (
            <div className="flex items-center gap-2 bg-slate-900/90 pl-1.5 pr-2 py-1 rounded-xl border border-slate-800 whitespace-nowrap shadow-sm">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || 'User'} className="w-5 h-5 rounded-full border border-slate-700 object-cover" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold">
                  {user.displayName ? user.displayName[0] : 'G'}
                </div>
              )}
              <span className="text-xs font-medium text-slate-200 max-w-[100px] truncate">
                {user.displayName || user.email?.split('@')[0]}
              </span>
              <button
                onClick={onLogout}
                className="p-1 text-slate-400 hover:text-rose-400 transition-colors rounded hover:bg-slate-800 cursor-pointer"
                title="ログアウト"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600/90 hover:bg-indigo-600 text-white shadow-md shadow-indigo-900/30 whitespace-nowrap transition-all cursor-pointer border border-indigo-500/40"
              title="Googleアカウントでサインイン"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span className="whitespace-nowrap">Google ログイン</span>
            </button>
          )}
        </div>

      </div>
    </header>
  );
};
