import Dexie, { type Table } from 'dexie';
import { CDMetadata, APICredentials } from '../types/cd';
import { normalizeCatalogNumber, normalizeReleaseDate } from './dateUtils';
import { ensureCDCoverBase64 } from '../utils/imageEnhancer';

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
      cds: 'id, catalogNumber, title, artist, label, releaseDate, barcode, updatedAt, createdAt, syncedToSheets, *tags',
      settings: 'key, updatedAt',
    });
  }
}

export const db = new CDCatalogDexieDB();

export function normalizeCDRecord(cd: CDMetadata): CDMetadata {
  return {
    ...cd,
    catalogNumber: normalizeCatalogNumber(cd.catalogNumber),
    releaseDate: cd.releaseDate ? normalizeReleaseDate(cd.releaseDate) : undefined,
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
    const normalized = items.map(normalizeCDRecord);
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
export async function saveCD(cd: CDMetadata): Promise<void> {
  const withBase64 = await ensureCDCoverBase64(cd);
  const normalized = normalizeCDRecord(withBase64);
  await db.cds.put(normalized);
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
  const normalizedList = convertedList.map(normalizeCDRecord);

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
  const normalizedList = convertedList.map(normalizeCDRecord);
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

