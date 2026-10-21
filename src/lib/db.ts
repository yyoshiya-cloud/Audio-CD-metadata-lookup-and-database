import Dexie, { type Table } from 'dexie';
import { CDMetadata, APICredentials, CustomSetlist } from '../types/cd';
import { normalizeCatalogNumber, normalizeReleaseDate } from './dateUtils';
import { ensureCDCoverBase64 } from '../utils/imageEnhancer';
import { normalizeCDTagsAndGenre } from './tagNormalizer';
import { settingsStore, STORAGE_KEYS } from './settingsStore';
import { createLogger } from './logger';
import { decryptJSON, encryptJSON, generateCredentialsKey, isEncryptedPayload } from './secureCredentials';
import { setCachedApiCredentials } from './credentialsCache';

const log = createLogger('db');

export interface SettingRecord {
  key: string;
  value: any;
  updatedAt: string;
}

/**
 * Dexie.js Powered Local IndexedDB Database
 * Completely offline-capable, zero-quota-limit, high-speed local database layer.
 */
export class CDCatalogDexieDB extends Dexie {
  cds!: Table<CDMetadata, string>;
  settings!: Table<SettingRecord, string>;

  constructor() {
    super('CDCatalogDexieDB');

    this.version(1).stores({
      // Primary key 'id', indexed fields for fast lookup and filtering
      cds: 'id, catalogNumber, title, artist, label, releaseDate, vinylRecordReleaseDate, barcode, updatedAt, createdAt, syncedToSheets, *tags',
      settings: 'key, updatedAt',
    });

    // v2: Googleスプレッドシート連携の廃止に伴い、不要になった syncedToSheets の索引を削除し、各レコードの値も消す
    this.version(2)
      .stores({
        cds: 'id, catalogNumber, title, artist, label, releaseDate, vinylRecordReleaseDate, barcode, updatedAt, createdAt, *tags',
        settings: 'key, updatedAt',
      })
      .upgrade((tx) =>
        tx
          .table('cds')
          .toCollection()
          .modify((cd: Record<string, unknown>) => {
            delete cd.syncedToSheets;
          })
      );
  }
}

export const db = new CDCatalogDexieDB();

export function normalizeCDRecord(
  cd: CDMetadata,
  options?: { preserveUserTags?: boolean }
): CDMetadata {
  const withUnifiedTags = normalizeCDTagsAndGenre(cd, options);
  return {
    ...withUnifiedTags,
    catalogNumber: normalizeCatalogNumber(withUnifiedTags.catalogNumber),
    releaseDate: withUnifiedTags.releaseDate ? normalizeReleaseDate(withUnifiedTags.releaseDate) : undefined,
    vinylRecordReleaseDate: withUnifiedTags.vinylRecordReleaseDate
      ? normalizeReleaseDate(withUnifiedTags.vinylRecordReleaseDate)
      : undefined,
  };
}

const LEGACY_DB_NAME = 'CDCatalogDB';
const LEGACY_STORE_NAME = 'cds';
const MIGRATION_FLAG_KEY = STORAGE_KEYS.dexieMigrated;

/**
 * Automatically migrate any existing records from legacy IndexedDB ('CDCatalogDB') or localStorage ('cds')
 * into the new Dexie.js database on first run so user data is seamlessly preserved.
 */
async function ensureLegacyDataMigrated(): Promise<void> {
  try {
    if (settingsStore.getString(MIGRATION_FLAG_KEY) === 'true') {
      return;
    }

    const migratedItems: CDMetadata[] = [];

    // 1. Check legacy raw IndexedDB ('CDCatalogDB')
    if (typeof window !== 'undefined' && window.indexedDB) {
      try {
        const legacyItems = await new Promise<CDMetadata[]>((resolve) => {
          const req = window.indexedDB.open(LEGACY_DB_NAME, 1);
          req.onsuccess = () => {
            const legacyDb = req.result;
            if (!legacyDb.objectStoreNames.contains(LEGACY_STORE_NAME)) {
              legacyDb.close();
              resolve([]);
              return;
            }
            try {
              const tx = legacyDb.transaction(LEGACY_STORE_NAME, 'readonly');
              const store = tx.objectStore(LEGACY_STORE_NAME);
              const getAllReq = store.getAll();
              getAllReq.onsuccess = () => {
                const res = (getAllReq.result as CDMetadata[]) || [];
                legacyDb.close();
                resolve(res);
              };
              getAllReq.onerror = () => {
                legacyDb.close();
                resolve([]);
              };
            } catch {
              legacyDb.close();
              resolve([]);
            }
          };
          req.onerror = () => resolve([]);
        });

        if (legacyItems.length > 0) {
          migratedItems.push(...legacyItems);
        }
      } catch (e) {
        log.warn('Legacy IndexedDB migration check skipped:', e);
      }
    }

    // 2. Check legacy localStorage fallback ('cds')
    try {
      const rawLocal = settingsStore.getString(LEGACY_STORE_NAME);
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal);
        if (Array.isArray(parsed) && parsed.length > 0) {
          migratedItems.push(...parsed);
        }
      }
    } catch {}

    if (migratedItems.length > 0) {
      const uniqueMap = new Map<string, CDMetadata>();
      for (const item of migratedItems) {
        if (item && item.id) {
          uniqueMap.set(item.id, normalizeCDRecord(item));
        }
      }
      const toInsert = Array.from(uniqueMap.values());
      if (toInsert.length > 0) {
        await db.cds.bulkPut(toInsert);
      }
    }

    // 3. Migrate API credentials from localStorage into Dexie settings table
    try {
      // （旧版の平文コピーは、loadApiCredentialsDB が暗号化保存へ移行して削除する）
      const savedCreds = settingsStore.getJSON<Record<string, unknown> | null>(STORAGE_KEYS.legacyApiCredentials, null);
      if (savedCreds) {
        await db.settings.put({
          key: 'apiCredentials',
          value: savedCreds,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {}

    settingsStore.setString(MIGRATION_FLAG_KEY, 'true');
  } catch (err) {
    log.warn('Migration to Dexie warning:', err);
  }
}

/**
 * Request persistent storage permission from the browser so IndexedDB is never evicted
 */
export async function initPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persisted();
      if (isPersisted) return true;
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}

/**
 * Get all CDs from Dexie IndexedDB sorted by updatedAt descending
 */
export async function getAllCDs(): Promise<CDMetadata[]> {
  await ensureLegacyDataMigrated();
  try {
    const items = await db.cds.toArray();
    const toUpdateInDB: CDMetadata[] = [];
    const normalized = items.map((item) => {
      const norm = normalizeCDRecord(item);
      if (
        norm.genre !== item.genre ||
        JSON.stringify(norm.tags || []) !== JSON.stringify(item.tags || []) ||
        JSON.stringify(norm.aiTagAnalysis || null) !== JSON.stringify(item.aiTagAnalysis || null)
      ) {
        toUpdateInDB.push(norm);
      }
      return norm;
    });
    if (toUpdateInDB.length > 0) {
      await db.cds.bulkPut(toUpdateInDB).catch(() => {});
    }
    normalized.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    return normalized;
  } catch (err) {
    log.error('Dexie getAllCDs error:', err);
    return [];
  }
}

/**
 * Save single CD to Dexie IndexedDB (automatically converts external image URL to Base64)
 */
export async function saveCD(cd: CDMetadata): Promise<CDMetadata> {
  const withBase64 = await ensureCDCoverBase64(cd);
  const normalized = normalizeCDRecord(withBase64, { preserveUserTags: true });
  await db.cds.put(normalized);
  return normalized;
}

/**
 * Helper to convert external coverUrl links to Base64 in parallel batches
 */
async function convertCDListCoversToBase64(cds: CDMetadata[]): Promise<CDMetadata[]> {
  if (cds.length === 0) return [];
  const CONCURRENCY = 5;
  const result: CDMetadata[] = new Array(cds.length);
  for (let i = 0; i < cds.length; i += CONCURRENCY) {
    const chunk = cds.slice(i, i + CONCURRENCY);
    const convertedChunk = await Promise.all(chunk.map((item) => ensureCDCoverBase64(item)));
    for (let j = 0; j < convertedChunk.length; j++) {
      result[i + j] = convertedChunk[j];
    }
  }
  return result;
}

/**
 * Save multiple CDs in a single atomic high-speed Dexie bulkPut transaction
 */
export async function saveMultipleCDs(
  cds: CDMetadata[],
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  if (cds.length === 0) return;
  const convertedList = await convertCDListCoversToBase64(cds);
  const normalizedList = convertedList.map((item) => normalizeCDRecord(item, { preserveUserTags: true }));

  // Process in chunks of 200 for responsive progress reporting on huge collections
  const CHUNK_SIZE = 200;
  let completed = 0;

  await db.transaction('rw', db.cds, async () => {
    for (let i = 0; i < normalizedList.length; i += CHUNK_SIZE) {
      const chunk = normalizedList.slice(i, i + CHUNK_SIZE);
      await db.cds.bulkPut(chunk);
      completed += chunk.length;
      if (onProgress) {
        onProgress(completed, normalizedList.length);
      }
    }
  });
}

/**
 * Import CDs into Dexie IndexedDB using bulkPut (non-destructive merge/upsert)
 */
export async function importCDs(cds: CDMetadata[]): Promise<void> {
  if (cds.length === 0) return;
  const convertedList = await convertCDListCoversToBase64(cds);
  const normalizedList = convertedList.map((item) => normalizeCDRecord(item));
  await db.transaction('rw', db.cds, async () => {
    await db.cds.bulkPut(normalizedList);
  });
}

/**
 * Delete single CD from Dexie IndexedDB
 */
export async function deleteCD(id: string): Promise<void> {
  await db.cds.delete(id);
}

/**
 * Delete multiple CDs in a single atomic Dexie bulkDelete transaction
 */
export async function deleteMultipleCDs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.cds.bulkDelete(ids);
}

const CREDENTIALS_KEY_RECORD = 'apiCredentialsKey';

/**
 * APIキーの暗号化に使う鍵を取得する（IndexedDB に「取り出せない鍵」として保存）。
 * create = true のとき、無ければ新しく作る。
 */
async function getCredentialsKey(create: boolean): Promise<CryptoKey | null> {
  const record = await db.settings.get(CREDENTIALS_KEY_RECORD);
  if (record?.value) return record.value as CryptoKey;
  if (!create) return null;
  const key = await generateCredentialsKey();
  await db.settings.put({ key: CREDENTIALS_KEY_RECORD, value: key, updatedAt: new Date().toISOString() });
  return key;
}

/**
 * Save API Credentials to Dexie IndexedDB settings table.
 * AES-GCM で暗号化して保存する。暗号化できない環境（HTTPS でない等）では、平文で保存せず false を返す。
 */
export async function saveApiCredentialsDB(credentials: APICredentials): Promise<boolean> {
  const cleanData: APICredentials = JSON.parse(JSON.stringify(credentials || {}));
  setCachedApiCredentials(cleanData);
  try {
    const key = await getCredentialsKey(true);
    if (!key) return false;
    const payload = await encryptJSON(key, cleanData);
    await db.settings.put({
      key: 'apiCredentials',
      value: payload,
      updatedAt: new Date().toISOString(),
    });
    // 旧版が残した平文のコピーを削除する
    settingsStore.remove(STORAGE_KEYS.legacyApiCredentials);
    return true;
  } catch (e) {
    log.error('APIキーを暗号化して保存できませんでした（平文での保存は行いません）', e);
    return false;
  }
}

/**
 * Load API Credentials from Dexie IndexedDB settings table.
 * 旧版の平文データ（IndexedDB・localStorage）が残っていれば、暗号化保存へ移行して平文を削除する。
 */
export async function loadApiCredentialsDB(): Promise<APICredentials> {
  await ensureLegacyDataMigrated();
  let creds: APICredentials = {};
  try {
    const record = await db.settings.get('apiCredentials');
    const value = record?.value;
    if (isEncryptedPayload(value)) {
      const key = await getCredentialsKey(false);
      if (key) {
        creds = await decryptJSON<APICredentials>(key, value);
      } else {
        log.warn('APIキーの暗号鍵が見つかりません。APIキーを入力し直してください。');
      }
    } else if (value && typeof value === 'object') {
      creds = value as APICredentials;
      await saveApiCredentialsDB(creds); // 平文 → 暗号化へ移行
    }
  } catch (e) {
    log.warn('APIキーを読み込めませんでした（復号に失敗）。APIキーを入力し直してください。', e);
  }

  const legacy = settingsStore.getJSON<APICredentials | null>(STORAGE_KEYS.legacyApiCredentials, null);
  if (legacy && typeof legacy === 'object') {
    if (Object.keys(creds).length === 0) {
      creds = legacy;
      // 暗号化して保存できたときだけ、平文のコピーを削除する（保存できない環境でキーを失わないため）
      await saveApiCredentialsDB(creds);
    } else {
      settingsStore.remove(STORAGE_KEYS.legacyApiCredentials);
    }
  }

  setCachedApiCredentials(creds);
  return creds;
}

export const DEFAULT_TAG_PRESETS: string[] = [
  'J-Pop',
  'アイドル',
  'シティポップ',
  '昭和歌謡',
  'ニューミュージック',
  'ロック',
  'フォーク',
  'アニソン',
  'シンガーソングライター',
  'バラード',
  'ベスト盤',
  'ライブ盤',
  'AOR',
  'テクノポップ',
  'ジャズ',
  'フュージョン',
  'R&B',
  'CMSong',
  'SoundTrack',
  'CMソング',
  'サウンドトラック',
  'クラシック',
  '演歌',
  'お笑い・バラエティ',
  '1970年代',
  '1980年代',
  '1990年代',
  '2000年代',
  '邦楽',
];

function normalizePresetTagsArray(rawPresets: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawPresets) {
    if (!raw) continue;
    const trimmed = String(raw).trim().replace(/^#+/, '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');
    let normalized = trimmed;
    if (lower === 'sound track' || lower === 'sound-track' || lower === 'soundtrack') {
      normalized = 'SoundTrack';
    } else if (lower === 'cm song' || lower === 'cm-song' || lower === 'cmsong') {
      normalized = 'CMSong';
    } else if (lower === 'j-pop' || lower === 'jpop' || lower === 'j pop') {
      normalized = 'J-Pop';
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Load user-defined Tag Master List from Dexie settings table (or localStorage fallback)
 */
export async function loadTagPresetsDB(): Promise<string[]> {
  try {
    const record = await db.settings.get('customTagPresets');
    if (record && Array.isArray(record.value) && record.value.length > 0) {
      const rawList = record.value as string[];
      const normalizedList = normalizePresetTagsArray(rawList);
      if (JSON.stringify(normalizedList) !== JSON.stringify(rawList)) {
        await saveTagPresetsDB(normalizedList);
      }
      return normalizedList;
    }
  } catch {}
  try {
    const parsed = settingsStore.getJSON<unknown>(STORAGE_KEYS.customTagPresets, null);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const normalizedList = normalizePresetTagsArray(parsed);
      if (JSON.stringify(normalizedList) !== JSON.stringify(parsed)) {
        await saveTagPresetsDB(normalizedList);
      }
      return normalizedList;
    }
  } catch {}
  return DEFAULT_TAG_PRESETS;
}

/**
 * Save user-defined Tag Master List to Dexie settings table and localStorage
 */
export async function saveTagPresetsDB(presets: string[]): Promise<void> {
  const cleaned = normalizePresetTagsArray(presets);
  try {
    await db.settings.put({
      key: 'customTagPresets',
      value: cleaned,
      updatedAt: new Date().toISOString(),
    });
  } catch {}
  settingsStore.setJSON(STORAGE_KEYS.customTagPresets, cleaned);
}

/**
 * Load user-created Custom Setlists / Playlists from Dexie settings table
 */
export async function loadCustomSetlistsDB(): Promise<CustomSetlist[]> {
  try {
    const record = await db.settings.get('customSetlists');
    if (record && Array.isArray(record.value)) {
      return record.value as CustomSetlist[];
    }
  } catch {}
  const savedSetlists = settingsStore.getJSON<unknown>(STORAGE_KEYS.customSetlists, null);
  if (Array.isArray(savedSetlists)) return savedSetlists as CustomSetlist[];
  return [];
}

/**
 * Save user-created Custom Setlists / Playlists to Dexie settings table
 */
export async function saveCustomSetlistsDB(setlists: CustomSetlist[]): Promise<void> {
  const cleanData: CustomSetlist[] = JSON.parse(JSON.stringify(setlists || []));
  try {
    await db.settings.put({
      key: 'customSetlists',
      value: cleanData,
      updatedAt: new Date().toISOString(),
    });
  } catch {}
  settingsStore.setJSON(STORAGE_KEYS.customSetlists, cleanData);
}

/**
 * Load favorite track keys (`${cdId}::${trackNumber}`) from Dexie settings table
 */
export async function loadFavoriteTrackKeysDB(): Promise<string[]> {
  try {
    const record = await db.settings.get('favoriteTrackKeys');
    if (record && Array.isArray(record.value)) {
      return record.value as string[];
    }
  } catch {}
  const savedKeys = settingsStore.getJSON<unknown>(STORAGE_KEYS.favoriteTrackKeys, null);
  if (Array.isArray(savedKeys)) return savedKeys as string[];
  return [];
}

/**
 * Save favorite track keys (`${cdId}::${trackNumber}`) to Dexie settings table
 */
export async function saveFavoriteTrackKeysDB(keys: string[]): Promise<void> {
  const cleaned = Array.from(new Set(keys.filter(Boolean)));
  try {
    await db.settings.put({
      key: 'favoriteTrackKeys',
      value: cleaned,
      updatedAt: new Date().toISOString(),
    });
  } catch {}
  settingsStore.setJSON(STORAGE_KEYS.favoriteTrackKeys, cleaned);
}

declare const __APP_VERSION__: string | undefined;
declare const __BUILD_DATE_JST__: string | undefined;

export interface AppInfoConfig {
  version: string;
  lastUpdated: string;
  buildSignature?: string;
}

const INJECTED_APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '1.1.2';

const INJECTED_BUILD_DATE =
  typeof __BUILD_DATE_JST__ !== 'undefined' && __BUILD_DATE_JST__
    ? __BUILD_DATE_JST__
    : new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const CURRENT_BUILD_SIGNATURE = `${INJECTED_APP_VERSION}::${INJECTED_BUILD_DATE}`;

export const DEFAULT_APP_INFO_CONFIG: AppInfoConfig = {
  version: INJECTED_APP_VERSION,
  lastUpdated: INJECTED_BUILD_DATE,
  buildSignature: CURRENT_BUILD_SIGNATURE,
};

/**
 * Load App Info (Version & Last Updated Date).
 * Automatically reflects newly deployed build version & build date whenever the build signature changes,
 * while still allowing manual overrides in Admin Mode for the current build.
 */
export async function loadAppInfoConfigDB(): Promise<AppInfoConfig> {
  try {
    const record = await db.settings.get('appInfoConfig');
    if (record && record.value && typeof record.value.version === 'string') {
      // If a manual override was saved on the exact current build, respect it;
      // otherwise automatically update to the latest deployed build version & build date.
      if (record.value.buildSignature === CURRENT_BUILD_SIGNATURE) {
        return {
          version: record.value.version || DEFAULT_APP_INFO_CONFIG.version,
          lastUpdated: record.value.lastUpdated || DEFAULT_APP_INFO_CONFIG.lastUpdated,
          buildSignature: CURRENT_BUILD_SIGNATURE,
        };
      }
      await db.settings.put({
        key: 'appInfoConfig',
        value: DEFAULT_APP_INFO_CONFIG,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch {}
  const savedInfo = settingsStore.getJSON<Partial<AppInfoConfig> | null>(STORAGE_KEYS.appInfoConfig, null);
  if (savedInfo && typeof savedInfo.version === 'string' && savedInfo.buildSignature === CURRENT_BUILD_SIGNATURE) {
    return {
      version: savedInfo.version || DEFAULT_APP_INFO_CONFIG.version,
      lastUpdated: savedInfo.lastUpdated || DEFAULT_APP_INFO_CONFIG.lastUpdated,
      buildSignature: CURRENT_BUILD_SIGNATURE,
    };
  }
  settingsStore.setJSON(STORAGE_KEYS.appInfoConfig, DEFAULT_APP_INFO_CONFIG);
  return DEFAULT_APP_INFO_CONFIG;
}

/**
 * Save custom App Info (Version & Last Updated Date) to Dexie settings table and localStorage
 */
export async function saveAppInfoConfigDB(config: AppInfoConfig): Promise<AppInfoConfig> {
  const cleaned: AppInfoConfig = {
    version: (config.version || '').trim().replace(/^Version\s+/i, '') || DEFAULT_APP_INFO_CONFIG.version,
    lastUpdated: (config.lastUpdated || '').trim().replace(/^最終更新日[:：]\s*/, '') || DEFAULT_APP_INFO_CONFIG.lastUpdated,
    buildSignature: CURRENT_BUILD_SIGNATURE,
  };
  try {
    await db.settings.put({
      key: 'appInfoConfig',
      value: cleaned,
      updatedAt: new Date().toISOString(),
    });
  } catch {}
  settingsStore.setJSON(STORAGE_KEYS.appInfoConfig, cleaned);
  return cleaned;
}


