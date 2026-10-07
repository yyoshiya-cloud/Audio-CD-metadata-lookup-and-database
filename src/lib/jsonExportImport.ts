import { CDMetadata } from '../types/cd';
import { normalizeCatalogNumber } from './dateUtils';

export interface JSONExportData {
  app: string;
  version: string;
  exportedAt: string;
  count: number;
  cds: CDMetadata[];
}

/**
 * Export CD Metadata collection to formatted JSON file download
 */
export function exportCDsToJSON(
  items: CDMetadata[],
  fileName?: string,
  prettyPrint: boolean = true
): { fileName: string; count: number; jsonString: string } {
  const exportPayload: JSONExportData = {
    app: 'CDCollectionManager',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    count: items.length,
    cds: items,
  };

  const jsonString = prettyPrint
    ? JSON.stringify(exportPayload, null, 2)
    : JSON.stringify(exportPayload);

  const defaultDate = new Date().toISOString().slice(0, 10);
  const finalFileName = (fileName?.trim() || `CDコレクション_backup_${defaultDate}`) + '.json';

  // Trigger browser download
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', finalFileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return {
    fileName: finalFileName,
    count: items.length,
    jsonString,
  };
}

/**
 * Parse JSON string or JSON file content into normalized CDMetadata array
 */
export function parseJSONToCDs(jsonText: string): {
  cds: CDMetadata[];
  totalAlbums: number;
  totalTracks: number;
  exportedAt?: string;
  appVersion?: string;
} {
  let parsedRaw: any;
  try {
    parsedRaw = JSON.parse(jsonText);
  } catch (err: any) {
    throw new Error(`JSON構文エラー: 形式が正しくありません (${err.message})`);
  }

  let cdListRaw: any[] = [];
  let exportedAt: string | undefined;
  let appVersion: string | undefined;

  if (Array.isArray(parsedRaw)) {
    cdListRaw = parsedRaw;
  } else if (parsedRaw && typeof parsedRaw === 'object') {
    if (Array.isArray(parsedRaw.cds)) {
      cdListRaw = parsedRaw.cds;
    } else if (Array.isArray(parsedRaw.items)) {
      cdListRaw = parsedRaw.items;
    } else if (Array.isArray(parsedRaw.records)) {
      cdListRaw = parsedRaw.records;
    } else if (Array.isArray(parsedRaw.data)) {
      cdListRaw = parsedRaw.data;
    } else {
      // Single object
      cdListRaw = [parsedRaw];
    }
    exportedAt = parsedRaw.exportedAt;
    appVersion = parsedRaw.version;
  }

  if (cdListRaw.length === 0) {
    throw new Error('JSONデータ内に有効なCDレコードが見つかりませんでした。');
  }

  let totalTracks = 0;
  const cds: CDMetadata[] = cdListRaw
    .filter((item) => item && (item.title || item.artist || item.catalogNumber))
    .map((item, idx) => {
      const cleanCat = normalizeCatalogNumber(item.catalogNumber || item.catNo || item.catalog_number || '');
      const tracks = Array.isArray(item.tracks)
        ? item.tracks.map((t: any, tIdx: number) => ({
            trackNumber: t.trackNumber || t.track_number || tIdx + 1,
            title: String(t.title || t.name || '').trim(),
            duration: t.duration || t.length || '',
            artist: t.artist || '',
            previewUrl: t.previewUrl || t.preview_url || '',
          }))
        : [];

      totalTracks += tracks.length;

      return {
        id: item.id || `json_import_${Date.now()}_${idx}`,
        title: String(item.title || item.album || '無題').trim(),
        artist: String(item.artist || item.performer || '不明なアーティスト').trim(),
        catalogNumber: cleanCat,
        label: item.label || '',
        releaseDate: item.releaseDate || item.release_date || '',
        barcode: item.barcode || item.jan || item.ean || '',
        country: item.country || '',
        format: item.format || 'CD',
        coverUrl: item.coverUrl || item.cover_url || item.image || item.jacketUrl || '',
        source: item.source || 'import',
        notes: item.notes || '',
        tracks,
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
      };
    });

  return {
    cds,
    totalAlbums: cds.length,
    totalTracks,
    exportedAt,
    appVersion,
  };
}
