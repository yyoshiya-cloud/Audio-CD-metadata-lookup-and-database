import React, { useState, useEffect } from 'react';
import { X, ShieldAlert, Save, RotateCcw, Calendar, Tag, CheckCircle2, Sparkles, AlertCircle } from 'lucide-react';
import { AppInfoConfig, DEFAULT_APP_INFO_CONFIG } from '../lib/db';
import { validateDateInput } from '../lib/dateUtils';

interface AdminModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  appInfoConfig: AppInfoConfig;
  onSaveAppInfoConfig: (config: AppInfoConfig) => Promise<void>;
  onOpenAppInfo?: () => void;
}

export const AdminModeModal: React.FC<AdminModeModalProps> = ({
  isOpen,
  onClose,
  appInfoConfig,
  onSaveAppInfoConfig,
  onOpenAppInfo,
}) => {
  const [version, setVersion] = useState(appInfoConfig.version);
  const [lastUpdated, setLastUpdated] = useState(appInfoConfig.lastUpdated);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setVersion(appInfoConfig.version);
      setLastUpdated(appInfoConfig.lastUpdated);
      setSaveSuccess(false);
      setError(null);
    }
  }, [isOpen, appInfoConfig]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!version.trim()) {
      setError('バージョン情報を入力してください');
      return;
    }
    if (!lastUpdated.trim() || !validateDateInput(lastUpdated)) {
      setError('有効な日付（YYYY-MM-DD）を入力してください');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSaveAppInfoConfig({
        ...appInfoConfig,
        version: version.trim(),
        lastUpdated: lastUpdated.trim(),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setVersion(DEFAULT_APP_INFO_CONFIG.version);
    setLastUpdated(DEFAULT_APP_INFO_CONFIG.lastUpdated);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-lg">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                管理者モード: アプリ情報編集
              </h2>
              <p className="text-[11px] text-slate-400">
                表示されるバージョン情報と最終更新日を任意に変更・保持できます。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 ml-1">
                <Tag className="w-3 h-3" />
                <span>バージョン情報 (Version)</span>
              </label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0.0"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3.5 text-sm text-white font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 ml-1">
                <Calendar className="w-3 h-3" />
                <span>最終更新日 (Last Updated)</span>
              </label>
              <input
                type="text"
                value={lastUpdated}
                onChange={(e) => setLastUpdated(e.target.value)}
                placeholder="YYYY-MM-DD"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3.5 text-sm text-emerald-400 font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
              />
              <p className="text-[10px] text-slate-500 ml-1">
                ※ 形式: YYYY-MM-DD (例: 2024-05-20)
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {saveSuccess && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs animate-in fade-in slide-in-from-top-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>設定をFirestoreに保存・更新しました！</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all border border-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>ビルド時の既定値に戻す</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex-[1.5] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/50 transition-all cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? '保存中...' : 'この内容で保存・反映'}</span>
            </button>
          </div>

          <div className="pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => { onClose(); if (onOpenAppInfo) onOpenAppInfo(); }}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>実際のアプリ情報モーダルでの見え方を確認</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
