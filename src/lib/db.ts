import { CDMetadata, APICredentials } from '../types/cd';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, firestoreDb } from './firebase';
import { normalizeCatalogNumber, normalizeReleaseDate } from './dateUtils';

export function normalizeCDRecord(cd: CDMetadata): CDMetadata {
  return {
    ...cd,
    catalogNumber: normalizeCatalogNumber(cd.catalogNumber),
    releaseDate: cd.releaseDate ? normalizeReleaseDate(cd.releaseDate) : undefined,
  };
}

const DB_NAME = 'CDCatalogDB';
const STORE_NAME = 'cds';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('catalogNumber', 'catalogNumber', { unique: false });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('artist', 'artist', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all CDs locally from IndexedDB / localStorage
 */
async function getLocalCDs(): Promise<CDMetadata[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const rawItems = (request.result as CDMetadata[]) || [];
        const items = rawItems.map(normalizeCDRecord);
        items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('Fallback to localStorage for CD storage:', err);
    const raw = localStorage.getItem(STORE_NAME);
    const parsed = raw ? JSON.parse(raw) : [];
    return (parsed as CDMetadata[]).map(normalizeCDRecord);
  }
}

/**
 * Save single CD to local storage
 */
async function saveLocalCD(cd: CDMetadata): Promise<void> {
  const normalized = normalizeCDRecord(cd);
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(normalized);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    const items = await getLocalCDs();
    const index = items.findIndex((i) => i.id === normalized.id);
    if (index >= 0) items[index] = normalized;
    else items.unshift(normalized);
    localStorage.setItem(STORE_NAME, JSON.stringify(items));
  }
}

/**
 * Delete single CD from local storage
 */
async function deleteLocalCD(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    const items = await getLocalCDs();
    const filtered = items.filter((i) => i.id !== id);
    localStorage.setItem(STORE_NAME, JSON.stringify(filtered));
  }
}

/**
 * Clear all CDs from local storage
 */
export async function clearLocalDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {}
  try {
    localStorage.removeItem(STORE_NAME);
  } catch {}
}

/**
 * Get all CDs - merges local IndexedDB with Firestore when authenticated and cloud sync is enabled
 */
export async function getAllCDs(): Promise<CDMetadata[]> {
  const localItems = await getLocalCDs();

  // If user is authenticated and cloud sync is enabled, sync with Firestore
  const user = auth.currentUser;
  if (user && getCloudSyncEnabled()) {
    try {
      const colRef = collection(firestoreDb, 'users', user.uid, 'cds');
      const snapshot = await getDocs(colRef);
      const firestoreItems: CDMetadata[] = [];
      snapshot.forEach((docSnap) => {
        firestoreItems.push(docSnap.data() as CDMetadata);
      });

      if (firestoreItems.length > 0) {
        const itemMap = new Map<string, CDMetadata>();
        // Add firestore items first
        firestoreItems.forEach((item) => itemMap.set(item.id, item));

        // Merge local items: if local is newer or has updated coverUrl, prefer localItem fields
        for (const localItem of localItems) {
          const existing = itemMap.get(localItem.id);
          if (!existing) {
            itemMap.set(localItem.id, localItem);
            saveFirestoreCD(localItem).catch((e) => console.warn('Sync to firestore error:', e));
          } else {
            const localTime = new Date(localItem.updatedAt || 0).getTime();
            const firestoreTime = new Date(existing.updatedAt || 0).getTime();

            // If local item is newer or equal, or if localItem has a coverUrl update, prefer localItem
            if (localTime >= firestoreTime || (localItem.coverUrl && localItem.coverUrl !== existing.coverUrl)) {
              const mergedItem: CDMetadata = {
                ...existing,
                ...localItem,
                coverUrl: localItem.coverUrl || existing.coverUrl,
              };
              itemMap.set(localItem.id, mergedItem);
              if (localTime > firestoreTime || localItem.coverUrl !== existing.coverUrl) {
                saveFirestoreCD(mergedItem).catch(() => {});
              }
            }
          }
        }

        const merged = Array.from(itemMap.values());
        merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        // Cache to local DB
        for (const item of merged) {
          saveLocalCD(item).catch(() => {});
        }
        return merged;
      } else if (localItems.length > 0) {
        // Upload local items to firestore so they exist on cloud
        for (const localItem of localItems) {
          saveFirestoreCD(localItem).catch((e) => console.warn('Sync to firestore error:', e));
        }
      }
    } catch (e) {
      console.warn('Failed to sync with Firestore, using local DB:', e);
    }
  }

  return localItems;
}

/**
 * Helper to recursively remove all undefined values from an object/array
 * to prevent Firestore setDoc errors on undefined fields
 */
export function removeUndefinedFields<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return null as any;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefinedFields(item)) as any;
  }
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      const val = (obj as any)[key];
      if (val !== undefined) {
        cleaned[key] = removeUndefinedFields(val);
      }
    }
    return cleaned as T;
  }
  return obj;
}

async function saveFirestoreCD(cd: CDMetadata): Promise<void> {
  const user = auth.currentUser;
  if (!user || !getCloudSyncEnabled()) return;
  try {
    const normalized = normalizeCDRecord(cd);
    const docRef = doc(firestoreDb, 'users', user.uid, 'cds', normalized.id);
    // Clean undefined fields thoroughly for Firestore
    const cleanData = removeUndefinedFields(normalized);
    await setDoc(docRef, cleanData, { merge: true });
  } catch (err) {
    console.warn('Failed to save document to Firestore:', err);
  }
}

async function deleteFirestoreCD(id: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !getCloudSyncEnabled()) return;
  const docRef = doc(firestoreDb, 'users', user.uid, 'cds', id);
  await deleteDoc(docRef);
}

/**
 * Save single CD to both local and Firestore
 */
export async function saveCD(cd: CDMetadata): Promise<void> {
  await saveLocalCD(cd);
  if (auth.currentUser && getCloudSyncEnabled()) {
    await saveFirestoreCD(cd);
  }
}

export async function saveMultipleCDs(
  cds: CDMetadata[],
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  let count = 0;
  for (const cd of cds) {
    await saveCD(cd);
    count++;
    if (onProgress) {
      onProgress(count, cds.length);
    }
  }
}

/**
 * Import CDs: saves locally, and if cloud sync is enabled, clears cloud data first then uploads imported CDs to cloud
 */
export async function importCDs(cds: CDMetadata[]): Promise<void> {
  await saveMultipleCDs(cds);
  const user = auth.currentUser;
  if (user && getCloudSyncEnabled()) {
    try {
      const colRef = collection(firestoreDb, 'users', user.uid, 'cds');
      const snapshot = await getDocs(colRef);
      const deletePromises: Promise<void>[] = [];
      snapshot.forEach((docSnap) => {
        deletePromises.push(deleteDoc(docSnap.ref));
      });
      await Promise.all(deletePromises);

      for (const cd of cds) {
        await saveFirestoreCD(cd);
      }
    } catch (e) {
      console.warn('Import cloud clear and save error:', e);
    }
  }
}

export async function deleteCD(id: string): Promise<void> {
  await deleteLocalCD(id);
  if (auth.currentUser && getCloudSyncEnabled()) {
    deleteFirestoreCD(id).catch((e) => console.warn('Firestore delete error:', e));
  }
}

export async function deleteMultipleCDs(ids: string[]): Promise<void> {
  for (const id of ids) {
    await deleteCD(id);
  }
}

export function getCloudSyncEnabled(): boolean {
  try {
    const val = localStorage.getItem('cd_cloud_sync_enabled');
    return val !== null ? JSON.parse(val) : true;
  } catch {
    return true;
  }
}

export function setCloudSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem('cd_cloud_sync_enabled', JSON.stringify(enabled));
  } catch {}
}

export function clearApiCredentialsLocal(): void {
  try {
    localStorage.removeItem('cd_api_credentials');
  } catch (e) {
    console.warn('Failed to clear API credentials from localStorage:', e);
  }
}

/**
 * Save API Credentials to both local storage and Firestore (when user is authenticated)
 */
export async function saveApiCredentialsDB(credentials: APICredentials): Promise<void> {
  try {
    localStorage.setItem('cd_api_credentials', JSON.stringify(credentials));
  } catch (e) {
    console.warn('Failed to save API credentials to localStorage:', e);
  }

  const user = auth.currentUser;
  if (user) {
    try {
      const docRef = doc(firestoreDb, 'users', user.uid, 'settings', 'apiCredentials');
      const cleanData = JSON.parse(JSON.stringify(credentials));
      await setDoc(docRef, cleanData, { merge: true });
    } catch (e) {
      console.warn('Failed to save API credentials to Firestore:', e);
    }
  }
}

/**
 * Load API Credentials from Firestore (if user is authenticated) or localStorage
 */
export async function loadApiCredentialsDB(): Promise<APICredentials> {
  let localCreds: APICredentials = {};
  try {
    const saved = localStorage.getItem('cd_api_credentials');
    if (saved) localCreds = JSON.parse(saved);
  } catch {}

  const user = auth.currentUser;
  if (user) {
    try {
      const docRef = doc(firestoreDb, 'users', user.uid, 'settings', 'apiCredentials');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const cloudCreds = docSnap.data() as APICredentials;
        const merged: APICredentials = {
          ...localCreds,
          ...cloudCreds,
        };
        localStorage.setItem('cd_api_credentials', JSON.stringify(merged));
        return merged;
      } else if (Object.keys(localCreds).length > 0) {
        await saveApiCredentialsDB(localCreds);
      }
    } catch (e) {
      console.warn('Failed to load API credentials from Firestore:', e);
    }
  }

  return localCreds;
}

export async function markCDsAsSynced(ids: string[]): Promise<void> {
  const cds = await getAllCDs();
  for (const cd of cds) {
    if (ids.includes(cd.id)) {
      cd.syncedToSheets = true;
      await saveCD(cd);
    }
  }
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
