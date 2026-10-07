import { CDMetadata, APISource } from '../types/cd';
import { normalizeCatalogNumber, normalizeReleaseDate, formatJSTTimestampCompact, getJSTISOString } from './dateUtils';

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
  const normalizedCds: CDMetadata[] = items.map((cd) => ({
    ...cd,
    vinylRecordReleaseDate: cd.vinylRecordReleaseDate ? normalizeReleaseDate(cd.vinylRecordReleaseDate) : '',
    vinylRecordFormat: cd.vinylRecordFormat || '',
    vinylRecordCatalogNumber: cd.vinylRecordCatalogNumber ? normalizeCatalogNumber(cd.vinylRecordCatalogNumber) : '',
  }));

  const exportPayload: JSONExportData = {
    app: 'CDCollectionManager',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    count: normalizedCds.length,
    cds: normalizedCds,
  };

  const jsonString = prettyPrint
    ? JSON.stringify(exportPayload, null, 2)
    : JSON.stringify(exportPayload);

  const defaultTimestamp = formatJSTTimestampCompact();
  const baseName = (fileName?.trim() || `CDコレクション_backup_${defaultTimestamp}`).replace(/\.json$/i, '');
  const finalFileName = `${baseName}.json`;

  // Trigger browser download
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', finalFileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);

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
  let cleanText = jsonText.trim();
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  let parsedRaw: any;
  try {
    parsedRaw = JSON.parse(cleanText);
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

  const validSources: APISource[] = ['musicbrainz', 'discogs', 'itunes', 'ndl', 'spotify', 'rakuten', 'vgmdb', 'yahoo', 'gemini'];

  let totalTracks = 0;
  const cds: CDMetadata[] = cdListRaw
    .filter((item) => item && (item.title || item.album || item.artist || item.performer || item.catalogNumber || item.catNo || item.catalog_number))
    .map((item, idx) => {
      const cleanCat = normalizeCatalogNumber(item.catalogNumber || item.catNo || item.catalog_number || '');
      const cleanReleaseDate = normalizeReleaseDate(item.releaseDate || item.release_date || '');
      const cleanVinylReleaseDate = normalizeReleaseDate(
        item.vinylRecordReleaseDate || item.vinyl_record_release_date || item.lpReleaseDate || item.vinylReleaseDate || ''
      );
      const cleanVinylFormat = String(
        item.vinylRecordFormat || item.vinyl_record_format || item.vinylFormat || ''
      ).trim();
      const cleanVinylCatalogNumber = normalizeCatalogNumber(
        item.vinylRecordCatalogNumber || item.vinyl_record_catalog_number || item.vinylCatalogNumber || ''
      );

      const tracks = Array.isArray(item.tracks)
        ? item.tracks.map((t: any, tIdx: number) => ({
            trackNumber: Number(t.trackNumber || t.track_number) || tIdx + 1,
            title: String(t.title || t.name || `Track ${tIdx + 1}`).trim(),
            duration: t.duration || t.length ? String(t.duration || t.length).trim() : undefined,
            artist: t.artist ? String(t.artist).trim() : undefined,
            previewUrl: t.previewUrl || t.preview_url ? String(t.previewUrl || t.preview_url).trim() : undefined,
          }))
        : [];

      totalTracks += tracks.length;

      let tags: string[] | undefined = undefined;
      if (Array.isArray(item.tags)) {
        tags = item.tags.map((tg: any) => String(tg).trim()).filter(Boolean);
      } else if (typeof item.tags === 'string' && item.tags.trim()) {
        tags = item.tags.split(/[,、，]/).map((tg: string) => tg.trim()).filter(Boolean);
      }

      const rawSource = String(item.source || '').toLowerCase() as APISource;
      const source: APISource = validSources.includes(rawSource) ? rawSource : 'gemini';

      return {
        id: item.id || `json_import_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        title: String(item.title || item.album || '無題').trim(),
        artist: String(item.artist || item.performer || '不明なアーティスト').trim(),
        catalogNumber: cleanCat,
        label: item.label ? String(item.label).trim() : undefined,
        releaseDate: cleanReleaseDate || undefined,
        vinylRecordReleaseDate: cleanVinylReleaseDate || undefined,
        vinylRecordFormat: cleanVinylFormat || undefined,
        vinylRecordCatalogNumber: cleanVinylCatalogNumber || undefined,
        barcode: item.barcode || item.jan || item.ean ? String(item.barcode || item.jan || item.ean).trim() : undefined,
        country: item.country ? String(item.country).trim() : undefined,
        format: item.format ? String(item.format).trim() : 'CD',
        genre: item.genre ? String(item.genre).trim() : undefined,
        coverUrl: item.coverUrl || item.cover_url || item.image || item.jacketUrl || undefined,
        source,
        sourceDetails: item.sourceDetails || undefined,
        rawSources: item.rawSources || undefined,
        confidenceScore: typeof item.confidenceScore === 'number' ? item.confidenceScore : undefined,
        tags,
        tagBasis: item.tagBasis || undefined,
        notes: item.notes ? String(item.notes) : undefined,
        verifiedByAI: Boolean(item.verifiedByAI),
        aiVerificationSummary: item.aiVerificationSummary || undefined,
        isExactMatch: Boolean(item.isExactMatch),
        exactMatchTypes: Array.isArray(item.exactMatchTypes) ? item.exactMatchTypes : undefined,
        tracks,
        createdAt: item.createdAt || getJSTISOString(),
        updatedAt: item.updatedAt || getJSTISOString(),
        syncedToSheets: Boolean(item.syncedToSheets ?? true),
      };
    });

  if (cds.length === 0) {
    throw new Error('JSONデータ内に有効なCDレコード（タイトル・アーティスト・型番）が見つかりませんでした。');
  }

  return {
    cds,
    totalAlbums: cds.length,
    totalTracks,
    exportedAt,
    appVersion,
  };
}
