import Dexie, { type Table } from 'dexie';
import { CDMetadata, APICredentials } from '../types/cd';
import { normalizeCatalogNumber, normalizeReleaseDate } from './dateUtils';

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
 * Save single CD to Dexie IndexedDB
 */
export async function saveCD(cd: CDMetadata): Promise<void> {
  const normalized = normalizeCDRecord(cd);
  await db.cds.put(normalized);
}

/**
 * Save multiple CDs in a single atomic high-speed Dexie bulkPut transaction
 */
export async function saveMultipleCDs(
  cds: CDMetadata[],
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  if (cds.length === 0) return;
  const normalizedList = cds.map(normalizeCDRecord);

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
  const normalizedList = cds.map(normalizeCDRecord);
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
 * Clear all CDs from Dexie IndexedDB
 */
export async function clearLocalDB(): Promise<void> {
  try {
    await db.cds.clear();
  } catch (e) {
    console.warn('Failed to clear Dexie DB:', e);
  }
  try {
    localStorage.removeItem(LEGACY_STORE_NAME);
  } catch {}
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

export function clearApiCredentialsLocal(): void {
  try {
    db.settings.delete('apiCredentials').catch(() => {});
    localStorage.removeItem('cd_api_credentials');
  } catch {}
}

export function getCloudSyncEnabled(): boolean {
  return false;
}

export function setCloudSyncEnabled(_enabled: boolean): void {
  // Deprecated: Storage is now 100% local IndexedDB via Dexie.js
}

export function exportToCSV(cds: CDMetadata[]): void {
  if (cds.length === 0) return;

  const headers = ['型番', 'タイトル', 'アーティスト', 'レーベル', '発売日', 'バーコード(JAN)', 'ジャケット画像URL', '取得元', 'トラック数'];
  const rows = cds.map((cd) => [
    `"${(cd.catalogNumber || '').replace(/"/g, '""')}"`,
    `"${(cd.title || '').replace(/"/g, '""')}"`,
    `"${(cd.artist || '').replace(/"/g, '""')}"`,
    `"${(cd.label || '').replace(/"/g, '""')}"`,
    `"${(cd.releaseDate || '').replace(/"/g, '""')}"`,
    `"${(cd.barcode || '').replace(/"/g, '""')}"`,
    `"${(cd.coverUrl || '').replace(/"/g, '""')}"`,
    `"${cd.source}"`,
    cd.tracks ? cd.tracks.length : 0,
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `cd_catalog_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
