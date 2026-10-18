import React, { useCallback, useEffect, useState } from 'react';
import { X, ShieldCheck, FolderOpen, Download, RefreshCw, AlertTriangle, CheckCircle2, History, Info } from 'lucide-react';
import type { CDMetadata } from '../types/cd';
import {
  BackupFileInfo,
  clearDirHandle,
  ensureFolderPermission,
  getBackupSettings,
  getBackupState,
  isFolderBackupSupported,
  listBackupFiles,
  loadDirHandle,
  pickBackupFolder,
  readBackupFile,
  runBackupNow,
  updateBackupSettings,
} from '../lib/autoBackup';
import { BackupSettings, BackupState, INTERVAL_OPTIONS, KEEP_OPTIONS, formatBytes } from '../lib/autoBackupCore';
import { parseJSONToCDs } from '../lib/jsonExportImport';

interface BackupSettingsModalProps {
  cds: CDMetadata[];
  onClose: () => void;
  /** バックアップからの復元（既存データに統合して反映する） */
  onRestoreCDs: (cds: CDMetadata[]) => Promise<void>;
}

const formatDateTime = (iso?: string | number) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const BackupSettingsModal: React.FC<BackupSettingsModalProps> = ({ cds, onClose, onRestoreCDs }) => {
  const folderSupported = isFolderBackupSupported();
  const [settings, setSettings] = useState<BackupSettings>(() => {
    const s = getBackupSettings();
    // フォルダ保存に非対応のブラウザでは、ダウンロード保存に固定する
    return folderSupported ? s : { ...s, destination: 'download' };
  });
  const [state, setState] = useState<BackupState>(() => getBackupState());
  const [folderName, setFolderName] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [files, setFiles] = useState<BackupFileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const useFolder = settings.destination === 'folder' && folderSupported;

  const refresh = useCallback(async () => {
    setState(getBackupState());
    if (!useFolder) {
      setFolderName(null);
      setPermissionGranted(false);
      setFiles([]);
      return;
    }
    const dir = await loadDirHandle();
    setFolderName(dir?.name ?? null);
    const granted = dir ? await ensureFolderPermission(dir, false) : false;
    setPermissionGranted(granted);
    if (dir && granted) {
      try {
        setFiles(await listBackupFiles(dir));
      } catch {
        setFiles([]);
      }
    } else {
      setFiles([]);
    }
  }, [useFolder]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const changeSettings = (patch: Partial<BackupSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    updateBackupSettings(next);
  };

  const handlePickFolder = async () => {
    setMessage(null);
    try {
      await pickBackupFolder();
      await refresh();
    } catch (err: any) {
      if (err?.name !== 'AbortError') setMessage({ type: 'error', text: `フォルダを選択できませんでした: ${err?.message || err}` });
    }
  };

  const handleGrant = async () => {
    setMessage(null);
    const dir = await loadDirHandle();
    const ok = dir ? await ensureFolderPermission(dir, true) : false;
    if (!ok) setMessage({ type: 'error', text: 'フォルダへのアクセスが許可されませんでした。' });
    await refresh();
  };

  const handleClearFolder = async () => {
    await clearDirHandle();
    changeSettings({ enabled: false });
    await refresh();
  };

  const handleBackupNow = async () => {
    setBusy(true);
    setMessage(null);
    const result = await runBackupNow(cds, { interactive: true });
    setMessage({ type: result.ok ? 'ok' : 'error', text: result.message });
    await refresh();
    setBusy(false);
  };

  const handleRestore = async (name: string) => {
    if (!window.confirm(`「${name}」から復元します。\n同じCDは上書きして統合し、ないCDは追加します（現在のデータは削除されません）。よろしいですか？`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const dir = await loadDirHandle();
      if (!dir) throw new Error('バックアップ先のフォルダが選択されていません。');
      const text = await readBackupFile(dir, name);
      const parsed = parseJSONToCDs(text);
      await onRestoreCDs(parsed.cds);
      setMessage({ type: 'ok', text: `${parsed.cds.length}件のCDを復元しました（${name}）。` });
    } catch (err: any) {
      setMessage({ type: 'error', text: `復元に失敗しました: ${err?.message || err}` });
    }
    setBusy(false);
  };

  const last = state.lastResult;
  const needsFolder = useFolder && !folderName;
  const needsPermission = useFolder && !!folderName && !permissionGranted;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">JSON自動バックアップ</h2>
              <p className="text-xs text-slate-400">ライブラリ（{cds.length}件）をJSONファイルに自動で保存します</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer" aria-label="閉じる">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {/* 有効/無効 */}
          <label className="flex items-center justify-between gap-3 p-3 bg-slate-950/70 border border-slate-800 rounded-xl cursor-pointer">
            <div>
              <p className="text-sm font-bold text-white">自動バックアップを有効にする</p>
              <p className="text-[11px] text-slate-400">データに変更があり、前回から設定した間隔が過ぎていると、アプリを開いている間に自動で保存します。</p>
            </div>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => changeSettings({ enabled: e.target.checked })}
              className="w-5 h-5 accent-emerald-500 flex-shrink-0"
            />
          </label>

          {/* 保存先 */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-300">保存先</p>
            {folderSupported ? (
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['folder', '選んだフォルダに保存（推奨）', '古い世代の自動整理ができます'],
                  ['download', 'ダウンロードとして保存', 'ブラウザのダウンロード先に保存'],
                ] as const).map(([value, title, sub]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeSettings({ destination: value })}
                    className={`text-left p-2.5 rounded-xl border cursor-pointer transition-all ${
                      settings.destination === value
                        ? 'bg-emerald-950/50 border-emerald-500 ring-1 ring-emerald-500/50'
                        : 'bg-slate-950/60 border-slate-800 hover:bg-slate-800/50'
                    }`}
                  >
                    <p className="text-xs font-bold text-white">{title}</p>
                    <p className="text-[10px] text-slate-400">{sub}</p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-start gap-2 p-2.5 bg-amber-950/30 border border-amber-800/50 rounded-xl text-[11px] text-amber-200">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>このブラウザはフォルダへの保存に対応していないため、ダウンロードとして保存します（フォルダ保存はChrome・Edgeで利用できます）。ダウンロードの場合、古い世代の自動整理はできません。</span>
              </div>
            )}

            {useFolder && (
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400">保存先フォルダ</p>
                    <p className="text-sm font-bold text-white truncate">{folderName ?? '未選択'}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button type="button" onClick={handlePickFolder} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer">
                      <FolderOpen className="w-3.5 h-3.5" />
                      {folderName ? '変更' : 'フォルダを選択'}
                    </button>
                    {folderName && (
                      <button type="button" onClick={handleClearFolder} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer">
                        解除
                      </button>
                    )}
                  </div>
                </div>
                {needsPermission && (
                  <div className="flex items-center justify-between gap-2 p-2 bg-amber-950/30 border border-amber-800/50 rounded-lg text-[11px] text-amber-200">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      フォルダへのアクセス許可が必要です（ブラウザを再起動すると必要になることがあります）。
                    </span>
                    <button type="button" onClick={handleGrant} className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer flex-shrink-0">
                      許可する
                    </button>
                  </div>
                )}
                {needsFolder && <p className="text-[11px] text-slate-400">バックアップを保存するフォルダを選んでください（クラウド同期フォルダを選ぶと、別の場所にも自動で複製されます）。</p>}
              </div>
            )}
          </div>

          {/* 間隔・世代 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-bold text-slate-300">バックアップの間隔</span>
              <select
                value={settings.intervalHours}
                onChange={(e) => changeSettings({ intervalHours: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.hours} value={o.hours}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold text-slate-300">残す世代数{useFolder ? '' : '（フォルダ保存のみ）'}</span>
              <select
                value={settings.keepCount}
                disabled={!useFolder}
                onChange={(e) => changeSettings({ keepCount: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white disabled:opacity-50"
              >
                {KEEP_OPTIONS.map((o) => (
                  <option key={o.count} value={o.count}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* 状態と今すぐ実行 */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400">最終バックアップ</p>
                <p className="text-sm font-bold text-white">{formatDateTime(state.lastBackupAt)}</p>
                {last && (
                  <p className={`text-[11px] mt-0.5 flex items-center gap-1 ${last.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {last.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    <span className="break-words">{formatDateTime(last.at)}: {last.message}{last.fileName ? `（${last.fileName}）` : ''}</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleBackupNow}
                disabled={busy || cds.length === 0 || needsFolder}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow disabled:opacity-50 cursor-pointer flex-shrink-0"
              >
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                今すぐバックアップ
              </button>
            </div>
          </div>

          {message && (
            <div className={`p-3 rounded-xl text-xs border ${message.type === 'ok' ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-200' : 'bg-rose-950/60 border-rose-700/50 text-rose-200'}`}>
              {message.text}
            </div>
          )}

          {/* 復元 */}
          {useFolder && permissionGranted && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> フォルダ内のバックアップ（{files.length}件）から復元
              </p>
              {files.length === 0 ? (
                <p className="text-[11px] text-slate-500">まだバックアップファイルがありません。</p>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800">
                  {files.map((f) => (
                    <div key={f.name} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="text-slate-200 font-mono truncate">{f.name}</p>
                        <p className="text-[10px] text-slate-500">{formatDateTime(f.lastModified)} ・ {formatBytes(f.size)}</p>
                      </div>
                      <button type="button" disabled={busy} onClick={() => handleRestore(f.name)} className="px-3 py-1 rounded-lg font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50 cursor-pointer flex-shrink-0">
                        復元
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-500">復元は、同じCDを上書きして統合し、ないCDを追加します。現在のデータは削除されません。別のファイルから復元するときは「書き出し・読み込み」の「読み込み」→ JSON を使えます。</p>
            </div>
          )}

          <p className="text-[10px] text-slate-500 leading-relaxed">
            バックアップにはCDの情報（タグ・評価・メモ・収録曲・ジャケット画像を含む）が入ります。カスタムセットリスト・タグのプリセット・APIキーは含まれません。
            ライブラリが空のときはバックアップしません。
          </p>
        </div>
      </div>
    </div>
  );
};
