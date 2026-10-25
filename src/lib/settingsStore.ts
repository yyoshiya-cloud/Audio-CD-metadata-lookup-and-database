/**
 * localStorage の読み書きを一箇所にまとめた「設定ストア」。
 * - キーは STORAGE_KEYS に集約（文字列のベタ書きをなくす）
 * - 例外（容量超過・プライベートモード等）はここで吸収し、呼び出し側に try/catch を書かせない
 * - 型付き（文字列 / 真偽値 / JSON）で読み書きする
 * 注意: APIキーなどの機密情報は localStorage に置かない（secureCredentials.ts で暗号化して保存する）。
 */
import { SETTINGS_KEY as AUTO_BACKUP_SETTINGS_KEY, STATE_KEY as AUTO_BACKUP_STATE_KEY } from './autoBackupCore';

export const STORAGE_KEYS = {
  tableVisibleColumns: 'cd_table_visible_columns_v1',
  tableDensity: 'cd_table_density_v1',
  searchSelectedSources: 'cd_search_selected_sources',
  searchPanelCollapsed: 'cd_search_panel_collapsed',
  appTheme: 'cd_app_theme',
  headerCompact: 'cd_header_compact',
  customTagPresets: 'cd_custom_tag_presets',
  customSetlists: 'cd_custom_setlists',
  favoriteTrackKeys: 'cd_favorite_track_keys',
  appInfoConfig: 'cd_app_info_config',
  dexieMigrated: 'cd_dexie_migrated_v1',
  autoBackupSettings: AUTO_BACKUP_SETTINGS_KEY,
  autoBackupState: AUTO_BACKUP_STATE_KEY,
  logLevel: 'cd_log_level',
  /** 旧バージョンが APIキーを平文で保存していたキー。読み込み時に暗号化保存へ移行して削除する */
  legacyApiCredentials: 'cd_api_credentials',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let override: StorageLike | null | undefined;

/** テスト用: 保存先を差し替える（null で「保存先なし」、undefined で元に戻す） */
export function __setStorageForTests(storage: StorageLike | null | undefined): void {
  override = storage;
}

function storage(): StorageLike | null {
  if (override !== undefined) return override;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const settingsStore = {
  getString(key: string): string | null {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  setString(key: string, value: string): boolean {
    try {
      const s = storage();
      if (!s) return false;
      s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  getBool(key: string, fallback = false): boolean {
    const v = this.getString(key);
    return v === null ? fallback : v === 'true';
  },

  setBool(key: string, value: boolean): boolean {
    return this.setString(key, String(value));
  },

  /** JSON として読む。無い・壊れている場合は fallback を返す */
  getJSON<T>(key: string, fallback: T): T {
    const raw = this.getString(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  setJSON(key: string, value: unknown): boolean {
    try {
      return this.setString(key, JSON.stringify(value));
    } catch {
      return false;
    }
  },

  remove(key: string): void {
    try {
      storage()?.removeItem(key);
    } catch {
      // ignore
    }
  },
};
