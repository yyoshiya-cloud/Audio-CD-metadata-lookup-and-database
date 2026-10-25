import React, { useState, useEffect } from 'react';
import { X, ShieldAlert, Save, RotateCcw, Calendar, Tag, CheckCircle2, Sparkles, AlertCircle } from 'lucide-react';
import { AppInfoConfig, DEFAULT_APP_INFO_CONFIG } from '../lib/db';
import { validateDateInput } from '../lib/dateUtils';

interface AdminModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAppInfo?: () => void;
}

export const AdminModeModal: React.FC<AdminModeModalProps> = ({
  isOpen,
  onClose,
  onOpenAppInfo,
}) => {
  const config = DEFAULT_APP_INFO_CONFIG;

  if (!isOpen) return null;

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
                アプリ情報 (読み取り専用)
              </h2>
              <p className="text-[11px] text-slate-400">
                現在のビルド情報です。デブロイ時に自動的に更新されます。
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
        <div className="p-5 space-y-4">
          <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-400">Version:</span>
              <span className="text-sm font-mono font-bold text-white">{config.version}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-400">最終更新日:</span>
              <span className="text-sm font-mono font-bold text-emerald-400">{config.lastUpdated}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { onClose(); if (onOpenAppInfo) onOpenAppInfo(); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer"
          >
            アプリ詳細情報を見る
          </button>
        </div>
      </div>
    </div>
  );
};

