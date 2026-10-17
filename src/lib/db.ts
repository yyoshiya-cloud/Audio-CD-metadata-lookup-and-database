import Dexie, { type Table } from 'dexie';
import { CDMetadata, APICredentials, CustomSetlist } from '../types/cd';
import { normalizeCatalogNumber, normalizeReleaseDate } from './dateUtils';
import { ensureCDCoverBase64 } from '../utils/imageEnhancer';
import { normalizeCDTagsAndGenre } from './tagNormalizer';

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
const MIGRATION_FLAG_KEY = 'cd_dexie_migrated_v1';

/**
 * Automatically migrate any existing records from legacy IndexedDB ('CDCatalogDB') or localStorage ('cds')
 * into the new Dexie.js database on first run so user data is seamlessly preserved.
 */
async function ensureLegacyDataMigrated(): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'true') {
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
        console.warn('Legacy IndexedDB migration check skipped:', e);
      }
    }

    // 2. Check legacy localStorage fallback ('cds')
    try {
      const rawLocal = localStorage.getItem(LEGACY_STORE_NAME);
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
      const savedCreds = localStorage.getItem('cd_api_credentials');
      if (savedCreds) {
        const parsedCreds = JSON.parse(savedCreds);
        await db.settings.put({
          key: 'apiCredentials',
          value: parsedCreds,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {}

    localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
  } catch (err) {
    console.warn('Migration to Dexie warning:', err);
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
    console.error('Dexie getAllCDs error:', err);
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

/**
 * Mark specified CDs as synced to Google Sheets / Exported
 */
export async function markCDsAsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction('rw', db.cds, async () => {
    const existing = await db.cds.bulkGet(ids);
    const toUpdate: CDMetadata[] = [];
    for (const item of existing) {
      if (item && !item.syncedToSheets) {
        toUpdate.push({ ...item, syncedToSheets: true });
      }
    }
    if (toUpdate.length > 0) {
      await db.cds.bulkPut(toUpdate);
    }
  });
}

/**
 * Save API Credentials into Dexie IndexedDB settings table (and localStorage backup)
 */
export async function saveApiCredentialsDB(credentials: APICredentials): Promise<void> {
  const cleanData: APICredentials = JSON.parse(JSON.stringify(credentials || {}));
  try {
    await db.settings.put({
      key: 'apiCredentials',
      value: cleanData,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Failed to save API credentials to Dexie:', e);
  }
  try {
    localStorage.setItem('cd_api_credentials', JSON.stringify(cleanData));
  } catch {}
}

/**
 * Load API Credentials from Dexie IndexedDB settings table (or localStorage fallback)
 */
export async function loadApiCredentialsDB(): Promise<APICredentials> {
  await ensureLegacyDataMigrated();
  try {
    const record = await db.settings.get('apiCredentials');
    if (record && record.value) {
      return record.value as APICredentials;
    }
  } catch (e) {
    console.warn('Failed to load API credentials from Dexie:', e);
  }

  try {
    const saved = localStorage.getItem('cd_api_credentials');
    if (saved) return JSON.parse(saved);
  } catch {}

  return {};
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
    const saved = localStorage.getItem('cd_custom_tag_presets');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalizedList = normalizePresetTagsArray(parsed);
        if (JSON.stringify(normalizedList) !== JSON.stringify(parsed)) {
          await saveTagPresetsDB(normalizedList);
        }
        return normalizedList;
      }
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
  try {
    localStorage.setItem('cd_custom_tag_presets', JSON.stringify(cleaned));
  } catch {}
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
  try {
    const saved = localStorage.getItem('cd_custom_setlists');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
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
  try {
    localStorage.setItem('cd_custom_setlists', JSON.stringify(cleanData));
  } catch {}
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
  try {
    const saved = localStorage.getItem('cd_favorite_track_keys');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
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
  try {
    localStorage.setItem('cd_favorite_track_keys', JSON.stringify(cleaned));
  } catch {}
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
  try {
    const saved = localStorage.getItem('cd_app_info_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.version === 'string' && parsed.buildSignature === CURRENT_BUILD_SIGNATURE) {
        return {
          version: parsed.version || DEFAULT_APP_INFO_CONFIG.version,
          lastUpdated: parsed.lastUpdated || DEFAULT_APP_INFO_CONFIG.lastUpdated,
          buildSignature: CURRENT_BUILD_SIGNATURE,
        };
      }
    }
    localStorage.setItem('cd_app_info_config', JSON.stringify(DEFAULT_APP_INFO_CONFIG));
  } catch {}
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
  try {
    localStorage.setItem('cd_app_info_config', JSON.stringify(cleaned));
  } catch {}
  return cleaned;
}


