import React from 'react';
import { Loader2, Disc, Languages, FileImage, Sparkles, ShieldAlert } from 'lucide-react';

export interface BatchProcessingState {
  isOpen: boolean;
  type: 'vinyl' | 'reading' | 'base64' | 'tagging';
  title: string;
  subtitle?: string;
  current: number;
  total: number;
  currentTitle?: string;
  currentArtist?: string;
  detail?: string;
}

interface BatchProcessingModalProps {
  state: BatchProcessingState;
}

export const BatchProcessingModal: React.FC<BatchProcessingModalProps> = ({ state }) => {
  if (!state.isOpen) return null;

  const percent = state.total > 0 ? Math.min(100, Math.round((state.current / state.total) * 100)) : 0;

  const getIcon = () => {
    switch (state.type) {
      case 'vinyl':
        return <Disc className="w-6 h-6 text-amber-400 animate-spin" style={{ animationDuration: '3s' }} />;
      case 'reading':
        return <Languages className="w-6 h-6 text-sky-400" />;
      case 'base64':
        return <FileImage className="w-6 h-6 text-emerald-400" />;
      case 'tagging':
        return <Sparkles className="w-6 h-6 text-purple-400" />;
      default:
        return <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />;
    }
  };

  const getThemeColor = () => {
    switch (state.type) {
      case 'vinyl':
        return {
          badge: 'bg-amber-950/80 border-amber-500/40 text-amber-300',
          bar: 'from-amber-500 to-yellow-400',
          ring: 'border-amber-500/30',
        };
      case 'reading':
        return {
          badge: 'bg-sky-950/80 border-sky-500/40 text-sky-300',
          bar: 'from-sky-500 to-indigo-500',
          ring: 'border-sky-500/30',
        };
      case 'base64':
        return {
          badge: 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300',
          bar: 'from-emerald-500 to-teal-400',
          ring: 'border-emerald-500/30',
        };
      case 'tagging':
        return {
          badge: 'bg-purple-950/80 border-purple-500/40 text-purple-300',
          bar: 'from-purple-500 to-indigo-500',
          ring: 'border-purple-500/30',
        };
      default:
        return {
          badge: 'bg-indigo-950/80 border-indigo-500/40 text-indigo-300',
          bar: 'from-indigo-500 to-violet-500',
          ring: 'border-indigo-500/30',
        };
    }
  };

  const theme = getThemeColor();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-process-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 select-none pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-slate-900 border border-slate-700/90 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden p-6 text-white space-y-5 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center gap-3.5">
          <div className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${theme.badge}`}>
            {getIcon()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <h2 id="batch-process-title" className="text-base font-bold text-white tracking-tight">
                {state.title}
              </h2>
              <span className="text-xs font-semibold tabular-nums text-slate-400">
                {percent}%
              </span>
            </div>
            {state.subtitle && (
              <p className="text-xs text-slate-400 mt-0.5 truncate">{state.subtitle}</p>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-300 tabular-nums">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
              <span>処理中:</span>
            </span>
            <span className="font-bold text-white">
              {state.current} / {state.total} 件
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700/60">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${theme.bar} transition-all duration-300 ease-out`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Current item info */}
        {(state.currentTitle || state.currentArtist) && (
          <div className="bg-slate-800/70 border border-slate-700/60 rounded-xl p-3 text-xs space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              現在の処理対象
            </div>
            <div className="font-semibold text-slate-200 truncate">
              {state.currentTitle || 'アルバムタイトル未指定'}
            </div>
            {state.currentArtist && (
              <div className="text-[11px] text-slate-400 truncate">
                アーティスト: {state.currentArtist}
              </div>
            )}
          </div>
        )}

        {state.detail && (
          <p className="text-xs text-slate-400 italic truncate text-center">
            {state.detail}
          </p>
        )}

        {/* Warning / Protective Notice */}
        <div className="p-3 bg-indigo-950/40 border border-indigo-500/20 rounded-xl flex items-start gap-2.5 text-xs text-indigo-200/90 leading-relaxed">
          <ShieldAlert className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            一括処理を実行中です。データの整合性を保つため、完了するまでブラウザの再読み込みや画面操作を行わずにお待ちください（他の入力・ボタンは一時的に無効化されています）。
          </div>
        </div>
      </div>
    </div>
  );
};
