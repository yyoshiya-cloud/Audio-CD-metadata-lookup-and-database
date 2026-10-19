/**
 * JSON自動バックアップ（入出力の部分）。
 *
 * 保存先は2通り:
 *  - folder   : File System Access API で、ユーザーが選んだフォルダにJSONを書き込む（Chrome / Edge など）。
 *               世代管理（古いファイルの削除）ができる。ブラウザ再起動後は、フォルダへのアクセス許可を
 *               もう一度求められることがある（セキュリティ上、ユーザー操作が必要）。
 *  - download : ブラウザのダウンロードとして保存する（Firefox / Safari など API 非対応でも使える）。
 *
 * 判定ロジックは autoBackupCore.ts（テスト可能な純粋関数）にある。
 */
import type { CDMetadata } from '../types/cd';
import { db } from './db';
import { buildCDsJSONString } from './jsonExportImport';
import {
  BackupResult,
  BackupSettings,
  BackupState,
  backupFileName,
  decideBackup,
  fingerprintCDs,
  isBackupFileName,
  loadBackupSettings,
  loadBackupState,
  saveBackupSettings,
  saveBackupState,
  selectFilesToDelete,
} from './autoBackupCore';

const HANDLE_KEY = 'autoBackupDirHandle';

// File System Access API の型は環境によって未定義のため any で扱う
type DirHandle = any;

export const isFolderBackupSupported = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';

export const getBackupSettings = (): BackupSettings => loadBackupSettings(window.localStorage);
export const getBackupState = (): BackupState => loadBackupState(window.localStorage);
export const updateBackupSettings = (s: BackupSettings): void => saveBackupSettings(window.localStorage, s);

// ---------------------------------------------------------------------------
// 保存先フォルダのハンドル（IndexedDB に保存）
// ---------------------------------------------------------------------------

export async function loadDirHandle(): Promise<DirHandle | null> {
  try {
    const rec = await db.settings.get(HANDLE_KEY);
    return rec?.value ?? null;
  } catch {
    return null;
  }
}

export async function clearDirHandle(): Promise<void> {
  try {
    await db.settings.delete(HANDLE_KEY);
  } catch {
    // ignore
  }
}

/**
 * フォルダ選択ダイアログを開き、選んだフォルダを保存先として記憶する（ユーザー操作から呼ぶこと）。
 *
 * 注意: Chrome / Edge は、ドキュメント・ダウンロード・デスクトップなどの標準フォルダ「そのもの」や
 * システムファイルを含むフォルダを選ばせない（「このフォルダを開けません」と表示される）。
 * その中に作った専用フォルダ（例: ドキュメント\CD-Backup）を選ぶ必要がある。
 */
export async function pickBackupFolder(): Promise<DirHandle> {
  const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'cd-backup', startIn: 'documents' });
  try {
    await db.settings.put({ key: HANDLE_KEY, value: handle, updatedAt: new Date().toISOString() });
    // 記憶できたことを読み戻して確認する（失敗に気づけず「未選択」のままになるのを防ぐ）
    const saved = await db.settings.get(HANDLE_KEY);
    if (!saved?.value) throw new Error('保存した内容を読み戻せませんでした');
  } catch (err: any) {
    throw new Error(`フォルダ「${handle?.name ?? ''}」は選べましたが、ブラウザに記憶できませんでした（${err?.message || err}）。`);
  }
  return handle;
}

/**
 * フォルダへの書き込み許可を確認する。
 * interactive = true のときは許可ダイアログを出す（ユーザー操作の中でのみ成功する）。
 */
export async function ensureFolderPermission(handle: DirHandle, interactive: boolean): Promise<boolean> {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  try {
    if (typeof handle.queryPermission === 'function') {
      if ((await handle.queryPermission(opts)) === 'granted') return true;
    }
    if (interactive && typeof handle.requestPermission === 'function') {
      return (await handle.requestPermission(opts)) === 'granted';
    }
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// フォルダ内のバックアップ一覧・読み出し（復元用）
// ---------------------------------------------------------------------------

export interface BackupFileInfo {
  name: string;
  size: number;
  lastModified: number;
}

export async function listBackupFiles(dir: DirHandle): Promise<BackupFileInfo[]> {
  const out: BackupFileInfo[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !isBackupFileName(entry.name)) continue;
    const file = await entry.getFile();
    out.push({ name: entry.name, size: file.size, lastModified: file.lastModified });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1)); // 新しい順
}

export async function readBackupFile(dir: DirHandle, name: string): Promise<string> {
  const fh = await dir.getFileHandle(name);
  const file = await fh.getFile();
  return await file.text();
}

// ---------------------------------------------------------------------------
// バックアップの実行
// ---------------------------------------------------------------------------

function downloadJSON(fileName: string, jsonString: string): void {
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let running = false;

function record(result: BackupResult, fingerprint: string): BackupResult {
  const state = getBackupState();
  const next: BackupState = { ...state, lastResult: result };
  if (result.ok) {
    next.lastBackupAt = result.at;
    next.lastFingerprint = fingerprint;
  }
  saveBackupState(window.localStorage, next);
  return result;
}

/**
 * 今すぐバックアップする（設定の有効/無効や間隔に関係なく実行）。
 * interactive = true: ボタン操作などの中で呼ぶ場合。フォルダの許可ダイアログを出せる。
 */
export async function runBackupNow(cds: CDMetadata[], opts: { interactive?: boolean } = {}): Promise<BackupResult> {
  const settings = getBackupSettings();
  const destination = settings.destination === 'folder' && isFolderBackupSupported() ? 'folder' : 'download';
  const at = new Date().toISOString();
  const fingerprint = fingerprintCDs(cds);
  const fail = (message: string) => record({ ok: false, message, count: cds.length, destination, at }, fingerprint);

  if (cds.length === 0) return fail('ライブラリが空のため、バックアップしませんでした。');
  if (running) return fail('別のバックアップを実行中です。');

  running = true;
  try {
    const jsonString = buildCDsJSONString(cds, false);
    const fileName = backupFileName(new Date());

    if (destination === 'download') {
      downloadJSON(fileName, jsonString);
      return record({ ok: true, message: 'ダウンロードとして保存しました。', count: cds.length, fileName, destination, at }, fingerprint);
    }

    const dir = await loadDirHandle();
    if (!dir) return fail('バックアップ先のフォルダが選択されていません。');
    if (!(await ensureFolderPermission(dir, opts.interactive === true))) {
      return fail('バックアップ先のフォルダへのアクセス許可が必要です。「許可する」を押してください。');
    }

    const bytes = new TextEncoder().encode(jsonString);
    const fh = await dir.getFileHandle(fileName, { create: true });
    const writable = await fh.createWritable();
    await writable.write(bytes);
    await writable.close();

    // 書き込めたことを確認（サイズ照合）
    const written = await (await dir.getFileHandle(fileName)).getFile();
    if (written.size !== bytes.byteLength) {
      return fail(`書き込み結果のサイズが一致しません（${written.size} / ${bytes.byteLength} バイト）。`);
    }

    // 古い世代を削除（このアプリが作った名前のファイルだけが対象）
    let pruned = 0;
    if (settings.keepCount > 0) {
      const names: string[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === 'file') names.push(entry.name);
      }
      for (const old of selectFilesToDelete(names, settings.keepCount)) {
        try {
          await dir.removeEntry(old);
          pruned++;
        } catch {
          // 削除に失敗してもバックアップ自体は成功
        }
      }
    }

    return record(
      {
        ok: true,
        message: `フォルダに保存しました${pruned > 0 ? `（古いバックアップ${pruned}件を整理）` : ''}。`,
        count: cds.length,
        fileName,
        destination,
        at,
      },
      fingerprint
    );
  } catch (err: any) {
    if (err?.name === 'AbortError') return fail('バックアップを中断しました。');
    console.error('Backup error:', err);
    return fail(`バックアップに失敗しました: ${err?.message || err}`);
  } finally {
    running = false;
  }
}

export type AutoBackupOutcome =
  | { status: 'skipped'; reason: 'disabled' | 'empty' | 'unchanged' | 'not-due' }
  | { status: 'needs-permission'; message: string }
  | { status: 'ran'; result: BackupResult };

/**
 * 条件を満たしていれば自動でバックアップする（設定が有効で、前回から間隔が過ぎ、データに変更がある場合）。
 * ユーザー操作なしで呼ばれるため、フォルダの許可ダイアログは出さない。許可が無い場合は 'needs-permission'。
 */
export async function maybeRunAutoBackup(cds: CDMetadata[]): Promise<AutoBackupOutcome> {
  const settings = getBackupSettings();
  const state = getBackupState();
  const decision = decideBackup({
    settings,
    state,
    fingerprint: fingerprintCDs(cds),
    count: cds.length,
    now: Date.now(),
  });
  if (!decision.run) return { status: 'skipped', reason: decision.reason };

  if (settings.destination === 'folder' && isFolderBackupSupported()) {
    const dir = await loadDirHandle();
    if (!dir || !(await ensureFolderPermission(dir, false))) {
      const message = !dir
        ? 'バックアップ先のフォルダが選択されていません。'
        : 'バックアップ先のフォルダへのアクセス許可が必要です。';
      record({ ok: false, message, count: cds.length, destination: 'folder', at: new Date().toISOString() }, fingerprintCDs(cds));
      return { status: 'needs-permission', message };
    }
  }

  return { status: 'ran', result: await runBackupNow(cds) };
}
