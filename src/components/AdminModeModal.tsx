import React, { useState, useEffect } from 'react';
import { X, ShieldAlert, Save, RotateCcw, Calendar, Tag, CheckCircle2, Sparkles } from 'lucide-react';
import { AppInfoConfig, DEFAULT_APP_INFO_CONFIG } from '../lib/db';

interface AdminModeModalProps {
  isOpen: boolean;
  config: AppInfoConfig;
  onSaveConfig: (newConfig: AppInfoConfig) => Promise<void>;
  onClose: () => void;
  onOpenAppInfo?: () => void;
}

export const AdminModeModal: React.FC<AdminModeModalProps> = ({
  isOpen,
  config,
  onSaveConfig,
  onClose,
  onOpenAppInfo,
}) => {
  const [versionInput, setVersionInput] = useState(config.version);
  const [lastUpdatedInput, setLastUpdatedInput] = useState(config.lastUpdated);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setVersionInput(config.version);
      setLastUpdatedInput(config.lastUpdated);
      setSavedNotice(null);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const setTodayJapaneseDate = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    setLastUpdatedInput(`${y}年${m}月${d}日`);
  };

  const handleResetToDefault = () => {
    setVersionInput(DEFAULT_APP_INFO_CONFIG.version);
    setLastUpdatedInput(DEFAULT_APP_INFO_CONFIG.lastUpdated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const cleanedVersion = versionInput.trim().replace(/^Version\s+/i, '') || DEFAULT_APP_INFO_CONFIG.version;
      const cleanedLastUpdated = lastUpdatedInput.trim().replace(/^最終更新日[:：]\s*/, '') || DEFAULT_APP_INFO_CONFIG.lastUpdated;

      await onSaveConfig({
        version: cleanedVersion,
        lastUpdated: cleanedLastUpdated,
      });
      setVersionInput(cleanedVersion);
      setLastUpdatedInput(cleanedLastUpdated);
      setSavedNotice('アプリ情報（Version・最終更新日）を更新・保存しました！');
      setTimeout(() => setSavedNotice(null), 3500);
    } finally {
      setIsSaving(false);
    }
  };

  const previewVersion = versionInput.trim().replace(/^Version\s+/i, '') || DEFAULT_APP_INFO_CONFIG.version;
  const previewLastUpdated = lastUpdatedInput.trim().replace(/^最終更新日[:：]\s*/, '') || DEFAULT_APP_INFO_CONFIG.lastUpdated;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-slate-900 border border-amber-500/50 rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-gradient-to-r from-amber-950/60 via-slate-900 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-lg">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                  管理者モード (システム設定)
                </h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  ADMIN
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                アプリ情報に表示される「Version」と「最終更新日」を編集できます
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            title="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Live Preview of AppInfo Badges (Single line) */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              アプリ情報画面での表示プレビュー
            </span>
            <div className="flex items-center gap-2 flex-nowrap overflow-x-auto pt-0.5 scrollbar-none">
              <span className="text-xs font-extrabold text-white whitespace-nowrap">
                CDメタデータ検索＆データベース
              </span>
              <span className="text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 whitespace-nowrap flex-shrink-0">
                Version {previewVersion}
              </span>
              <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1 whitespace-nowrap flex-shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                最終更新日: {previewLastUpdated}
              </span>
            </div>
          </div>

          {/* Version & Last Updated Date Side-by-Side on the Same Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            {/* Version Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between min-h-[24px]">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Version（バージョン番号）</span>
                </label>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2 text-xs font-mono text-slate-400 select-none">
                  Version
                </span>
                <input
                  type="text"
                  value={versionInput}
                  onChange={(e) => setVersionInput(e.target.value)}
                  placeholder="例: 1.1.0"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 pl-18 pr-3 text-xs font-mono font-bold text-white focus:border-amber-500 focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">
                ※ 例: <code className="text-indigo-300 font-mono">1.2.0</code>
              </p>
            </div>

            {/* Last Updated Date Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-1.5 min-h-[24px]">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  <span>最終更新日</span>
                </label>
                <button
                  type="button"
                  onClick={setTodayJapaneseDate}
                  className="text-[10px] font-bold text-emerald-300 hover:text-emerald-200 bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-500/40 px-2 py-0.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>今日の日付をセット</span>
                </button>
              </div>
              <input
                type="text"
                value={lastUpdatedInput}
                onChange={(e) => setLastUpdatedInput(e.target.value)}
                placeholder="例: 2026年10月10日"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs font-medium text-white focus:border-amber-500 focus:outline-none"
              />
              <p className="text-[10px] text-slate-400 leading-snug">
                ※ 例: <code className="text-emerald-300 font-mono">2026年10月10日</code>
              </p>
            </div>
          </div>

          {savedNotice && (
            <div className="bg-emerald-950/80 border border-emerald-500/50 rounded-xl px-3.5 py-2.5 text-xs font-bold text-emerald-200 flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>{savedNotice}</span>
              </div>
              {onOpenAppInfo && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAppInfo();
                  }}
                  className="text-[11px] underline text-emerald-300 hover:text-white whitespace-nowrap cursor-pointer"
                >
                  アプリ情報で確認 →
                </button>
              )}
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
              title="初期値に戻す"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>初期値に戻す</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
              >
                閉じる
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30 border border-amber-400/40 transition-all cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>変更を保存して反映</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
