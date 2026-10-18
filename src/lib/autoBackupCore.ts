/**
 * JSON自動バックアップの判定ロジック（ブラウザ API・Dexie に依存しない純粋な部分）。
 * 保存先への書き込みなどの入出力は autoBackup.ts にある。
 */

export interface BackupSettings {
  enabled: boolean;
  /** 前回のバックアップからこの時間（時間）が過ぎ、かつデータに変更があるときに実行する */
  intervalHours: number;
  /** 保存先フォルダに残す世代数（0 = 無制限）。フォルダ保存のときだけ有効 */
  keepCount: number;
  /** folder = 選んだフォルダに書き込む（Chrome / Edge） / download = ブラウザのダウンロードとして保存 */
  destination: 'folder' | 'download';
}

export interface BackupResult {
  ok: boolean;
  message: string;
  count: number;
  fileName?: string;
  destination: 'folder' | 'download';
  at: string; // ISO
}

export interface BackupState {
  lastBackupAt?: string; // ISO（成功したときだけ更新）
  lastFingerprint?: string; // 成功したバックアップ時点のデータの指紋
  lastResult?: BackupResult;
}

export const INTERVAL_OPTIONS: { hours: number; label: string }[] = [
  { hours: 1, label: '1時間ごと（変更があれば）' },
  { hours: 6, label: '6時間ごと（変更があれば）' },
  { hours: 24, label: '1日ごと（変更があれば）' },
  { hours: 168, label: '1週間ごと（変更があれば）' },
];

export const KEEP_OPTIONS: { count: number; label: string }[] = [
  { count: 5, label: '最新5件' },
  { count: 10, label: '最新10件' },
  { count: 30, label: '最新30件' },
  { count: 0, label: 'すべて残す' },
];

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: false,
  intervalHours: 24,
  keepCount: 10,
  destination: 'folder',
};

export const SETTINGS_KEY = 'cd_auto_backup_settings_v1';
export const STATE_KEY = 'cd_auto_backup_state_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function readJSON<T>(storage: StorageLike, key: string): Partial<T> | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function loadBackupSettings(storage: StorageLike): BackupSettings {
  const s = readJSON<BackupSettings>(storage, SETTINGS_KEY) || {};
  const validInterval = INTERVAL_OPTIONS.some((o) => o.hours === s.intervalHours);
  const validKeep = KEEP_OPTIONS.some((o) => o.count === s.keepCount);
  return {
    enabled: s.enabled === true,
    intervalHours: validInterval ? (s.intervalHours as number) : DEFAULT_BACKUP_SETTINGS.intervalHours,
    keepCount: validKeep ? (s.keepCount as number) : DEFAULT_BACKUP_SETTINGS.keepCount,
    destination: s.destination === 'download' ? 'download' : 'folder',
  };
}

export function saveBackupSettings(storage: StorageLike, settings: BackupSettings): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 保存できない環境では何もしない
  }
}

export function loadBackupState(storage: StorageLike): BackupState {
  return (readJSON<BackupState>(storage, STATE_KEY) as BackupState) || {};
}

export function saveBackupState(storage: StorageLike, state: BackupState): void {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // 保存できない環境では何もしない
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 例: cd-backup_20261018-142530.json（端末のローカル時刻） */
export function backupFileName(date: Date): string {
  return (
    `cd-backup_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`
  );
}

const BACKUP_FILE_RE = /^cd-backup_\d{8}-\d{6}\.json$/;

/** このアプリが作ったバックアップファイルか（フォルダ内の他のファイルを消さないための判定） */
export function isBackupFileName(name: string): boolean {
  return BACKUP_FILE_RE.test(name);
}

/** 保存世代数を超えた古いバックアップのファイル名。名前は時刻順に並ぶので名前で新旧を判断する。 */
export function selectFilesToDelete(names: string[], keepCount: number): string[] {
  if (keepCount <= 0) return [];
  const own = names.filter(isBackupFileName).sort().reverse(); // 新しい順
  return own.slice(keepCount);
}

/** 指紋の計算に使うCDのフィールド（CDMetadata の一部。画像などの巨大データは長さだけを見る） */
export interface FingerprintCD {
  id: string;
  updatedAt?: string;
  title?: string;
  artist?: string;
  catalogNumber?: string;
  rating?: number;
  tags?: string[];
  notes?: string;
  tracks?: unknown[];
  coverUrl?: string;
  subImages?: unknown[];
}

/**
 * データの指紋。追加・削除・編集があれば変わる。
 * 編集の経路によって updatedAt が更新されない場合に備え、主な項目も含める。
 */
export function fingerprintCDs(cds: FingerprintCD[]): string {
  let h = 5381;
  for (const cd of cds) {
    const part =
      [
        cd.id,
        cd.updatedAt || '',
        cd.title || '',
        cd.artist || '',
        cd.catalogNumber || '',
        cd.rating ?? '',
        (cd.tags || []).join(','),
        (cd.notes || '').length,
        cd.tracks?.length ?? 0,
        cd.coverUrl?.length ?? 0,
        cd.subImages?.length ?? 0,
      ].join('|') + ';';
    for (let i = 0; i < part.length; i++) {
      h = ((h << 5) + h + part.charCodeAt(i)) | 0;
    }
  }
  return `${cds.length}:${(h >>> 0).toString(36)}`;
}

export type BackupDecision =
  | { run: true; reason: 'due' }
  | { run: false; reason: 'disabled' | 'empty' | 'unchanged' | 'not-due' };

export function decideBackup(input: {
  settings: BackupSettings;
  state: BackupState;
  fingerprint: string;
  count: number;
  now: number; // epoch ms
}): BackupDecision {
  const { settings, state, fingerprint, count, now } = input;
  if (!settings.enabled) return { run: false, reason: 'disabled' };
  // 空のライブラリはバックアップしない（誤って全削除した直後に、残す世代が空のバックアップで押し出されるのを防ぐ）
  if (count === 0) return { run: false, reason: 'empty' };
  if (state.lastFingerprint && state.lastFingerprint === fingerprint) return { run: false, reason: 'unchanged' };
  if (state.lastBackupAt) {
    const last = Date.parse(state.lastBackupAt);
    if (Number.isFinite(last) && now - last < settings.intervalHours * 3600 * 1000) {
      return { run: false, reason: 'not-due' };
    }
  }
  return { run: true, reason: 'due' };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
