import React, { useState } from 'react';
import { X, PlusCircle, RefreshCw, Check, Disc } from 'lucide-react';
import { CDMetadata } from '../types/cd';

interface BatchImportModalProps {
  onClose: () => void;
  onBatchFetchComplete: (cds: CDMetadata[]) => void;
}

export const BatchImportModal: React.FC<BatchImportModalProps> = ({
  onClose,
  onBatchFetchComplete,
}) => {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentCat: string } | null>(null);
  const [fetchedCDs, setFetchedCDs] = useState<CDMetadata[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const handleStartBatchProcess = async () => {
    const lines = inputText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    setIsProcessing(true);
    setFetchedCDs([]);
    setErrors([]);

    const results: CDMetadata[] = [];
    const errList: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const catno = lines[i];
      setProgress({ current: i + 1, total: lines.length, currentCat: catno });

      try {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ catalogNumber: catno }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.candidates && data.candidates.length > 0) {
            results.push(data.candidates[0].cd);
          } else {
            errList.push(`${catno}: 該当データなし`);
          }
        } else {
          errList.push(`${catno}: API通信エラー`);
        }
      } catch (err: any) {
        errList.push(`${catno}: ${err.message}`);
      }

      // Brief delay to be polite to APIs
      await new Promise((r) => setTimeout(r, 600));
    }

    setIsProcessing(false);
    setProgress(null);
    setFetchedCDs(results);
    setErrors(errList);

    if (results.length > 0) {
      onBatchFetchComplete(results);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center">
              <PlusCircle className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                型番（規格品番）一括連続自動取得
              </h2>
              <p className="text-xs text-slate-400">
                型番を改行区切りで複数入力して自動一括フェッチします
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              型番リスト (1行に1つの型番を入力):
            </label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isProcessing}
              rows={6}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono placeholder-slate-600 focus:border-indigo-500"
              placeholder={`VICL-60001\nSRCL-1234\nTOCT-24001`}
            />
          </div>

          {progress && (
            <div className="bg-slate-800 p-3.5 rounded-xl border border-slate-700 space-y-2">
              <div className="flex justify-between text-xs text-slate-300 font-bold">
                <span>自動取得中: {progress.currentCat}</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {fetchedCDs.length > 0 && (
            <div className="bg-emerald-950/60 border border-emerald-500/40 p-3.5 rounded-xl space-y-1 text-xs text-emerald-300">
              <p className="font-bold flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-400" />
                {fetchedCDs.length} 件のCDデータを取得・ライブラリに追加しました！
              </p>
            </div>
          )}

          {errors.length > 0 && (
            <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 max-h-32 overflow-y-auto space-y-1 text-xs text-slate-400">
              <p className="font-semibold text-rose-400 text-[11px]">未取得ログ:</p>
              {errors.map((e, idx) => (
                <p key={idx} className="font-mono text-[11px]">{e}</p>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700"
          >
            閉じる
          </button>

          <button
            onClick={handleStartBatchProcess}
            disabled={isProcessing || !inputText.trim()}
            className="flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 disabled:opacity-50 transition-all"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>一括取得処理中...</span>
              </>
            ) : (
              <>
                <Disc className="w-4 h-4" />
                <span>一括自動取得を開始</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
