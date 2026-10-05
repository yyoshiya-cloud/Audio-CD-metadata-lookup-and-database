import React from 'react';
import { X, Disc, Sparkles, Database, ShieldCheck, ExternalLink, Calendar, Code2, FileSpreadsheet } from 'lucide-react';

interface AppInfoModalProps {
  onClose: () => void;
}

export const AppInfoModal: React.FC<AppInfoModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-800/80 relative">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-600/30 ring-1 ring-white/20 flex-shrink-0">
              <Disc className="w-6 h-6 text-white animate-spin-slow" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                  CDメタデータ検索＆データベース
                </h2>
                <span className="text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  Version 1.0.1
                </span>
                <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  最終更新日: 2026年10月5日
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                MusicBrainz · Discogs · NDL · iTunes · Spotify · Rakuten 複数API横断・AI検証アプリ
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            title="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto max-h-[72vh]">
          
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>主な実装機能・アーキテクチャ</span>
          </div>

          {/* Feature Grid (Matching user screenshot style) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            
            {/* Feature 1 */}
            <div className="bg-slate-800/60 border border-slate-700/80 p-3.5 rounded-xl space-y-1.5 hover:border-indigo-500/50 transition-all">
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <div className="w-6 h-6 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <span>同時・横断API検索 & AI高精度突合</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                MusicBrainz・Discogs・NDL・iTunes・Spotify・楽天ブックスの並列横断検索。Gemini AIが候補データを高精度に突合・重複排除し、高画質ジャケット＆試聴付き収録曲を自動取得。
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-slate-800/60 border border-slate-700/80 p-3.5 rounded-xl space-y-1.5 hover:border-indigo-500/50 transition-all">
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <div className="w-6 h-6 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Disc className="w-3.5 h-3.5" />
                </div>
                <span>JAN/型番優先探索 & AI背表紙OCR</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                JAN/EANコード・規格品番による完全一致照合（JAN優先探索フロー）。カメラや画像からのAI OCRによるCD背表紙・ジャケット自動文字認識にも対応。
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-slate-800/60 border border-slate-700/80 p-3.5 rounded-xl space-y-1.5 hover:border-indigo-500/50 transition-all">
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <div className="w-6 h-6 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                </div>
                <span>スプレッドシート形式エディタ</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Excel風の直接セル入力、各項目正順/逆順ソート、列幅ドラッグ調整、未登録項目の完全空白化、Excel/SheetsからのTSV一括貼り付け、チェックボックス一括削除。
              </p>
            </div>

            {/* Feature 4 */}
            <div className="bg-slate-800/60 border border-slate-700/80 p-3.5 rounded-xl space-y-1.5 hover:border-indigo-500/50 transition-all">
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <div className="w-6 h-6 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Database className="w-3.5 h-3.5" />
                </div>
                <span>クラウド同期 & 2ファイル一括連携</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Firebase Firestoreによる永続保存。Google Sheets / Excel(.xlsx) / CSVへの「アルバム情報」＋「収録曲リスト」の2ファイル一括双方向連携に対応。
              </p>
            </div>

          </div>

          {/* Render / External Deploy Google Login Help Section */}
          <div className="bg-indigo-950/70 border border-indigo-500/40 p-4 rounded-xl space-y-2.5 shadow-inner">
            <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>【ヘルプ】Googleログインエラー (auth/unauthorized-domain) 解決手順</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Googleログイン時に「<code className="bg-slate-800 text-rose-300 px-1 py-0.5 rounded font-mono">Firebase: Error (auth/unauthorized-domain)</code>」が発生する場合は、Firebase Console側で該当ドメインのアクセス承認が必要です
            </p>
            <ol className="list-decimal list-inside text-[11px] text-slate-300 space-y-1 pl-1">
              <li>
                <a
                  href="https://console.firebase.google.com/project/jumping-impact-cjf39/authentication/settings"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 underline hover:text-indigo-300 inline-flex items-center gap-1 font-semibold"
                >
                  <span>Firebase Console 認証設定</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                を開きます。
              </li>
              <li>
                <strong>「Settings (設定)」</strong> タブ ➔ 下部の <strong>「Authorized domains (承認済みドメイン)」</strong> を開きます。
              </li>
              <li>
                <strong>「Add domain (ドメインを追加)」</strong> を押し、<code className="bg-slate-800 text-emerald-300 px-1 py-0.5 rounded font-mono select-all">audio-cd-metadata-lookup-and-database.onrender.com</code> を追加・保存します。
              </li>
            </ol>
            <p className="text-[10px] text-slate-400 italic">
              ※ <code className="font-mono">https://</code> や末尾の <code className="font-mono">/</code> は含めずホスト名のみ入力して保存すると、数秒～1分ほどで反映されログイン可能になります。
            </p>
          </div>

          <div className="bg-indigo-950/50 border border-indigo-500/30 p-3 rounded-xl text-xs text-indigo-200 flex items-center justify-between flex-wrap gap-2">
            <span className="flex items-center gap-1.5 font-medium">
              <Code2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <span>React SPA · Vite · TypeScript · Tailwind CSS · Express Server · Gemini 3.8 Flash</span>
            </span>
            <span className="text-[10px] font-mono bg-indigo-900/60 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30">
              セキュア通信対応
            </span>
          </div>

        </div>

        {/* Footer / Author & Social Links (Matching user screenshot style) */}
        <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-800/60 gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
            <span className="font-bold text-white">Author:</span>
            <a
              href="https://bsky.app/profile/yoshiya.bsky.social"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-950/80 text-sky-300 border border-sky-500/40 hover:bg-sky-900/80 transition-colors text-xs font-semibold cursor-pointer"
            >
              <span>Bluesky @yoshiya.bsky.social</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://www.threads.net/@yutakayoshiya"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-950/80 text-purple-300 border border-purple-500/40 hover:bg-purple-900/80 transition-colors text-xs font-semibold cursor-pointer"
            >
              <span>Threads @yutakayoshiya</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer shadow-md"
          >
            閉じる
          </button>
        </div>

      </div>
    </div>
  );
};
