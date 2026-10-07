import * as XLSX from 'xlsx';
import { CDMetadata, TrackInfo } from '../types/cd';
import { normalizeCatalogNumber, normalizeReleaseDate } from './dateUtils';
import { parseSpreadsheetRowsToCDs } from './googleSheets';

/**
 * Escape a string field for standard RFC 4180 CSV
 */
function escapeCSV(val: any): string {
  if (val === undefined || val === null) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * 1. Export Album Master CSV (CDアルバム一覧)
 * Outputs 1 row per album with all main metadata.
 */
export function generateAlbumsCSVContent(cds: CDMetadata[]): string {
  const headers = [
    '型番',
    'CDタイトル',
    '歌手・アーティスト名',
    'レーベル・発売元',
    '発売年月日',
    '同タイトルLP/EP発売年月日',
    'アナログ盤種別(LP/EP)',
    'LP/EP規格品番',
    'JAN/EANバーコード',
    '収録曲数',
    'タグ',
    'ジャケット画像URL',
    'メモ・状態記録',
    'データ取得元',
    '登録日時',
  ];

  const rows = cds.map((cd) => [
    escapeCSV(cd.catalogNumber || ''),
    escapeCSV(cd.title || ''),
    escapeCSV(cd.artist || ''),
    escapeCSV(cd.label || ''),
    escapeCSV(cd.releaseDate || ''),
    escapeCSV(cd.vinylRecordReleaseDate || ''),
    escapeCSV(cd.vinylRecordFormat || ''),
    escapeCSV(cd.vinylRecordCatalogNumber || ''),
    escapeCSV(cd.barcode || ''),
    cd.tracks ? cd.tracks.length : 0,
    escapeCSV((cd.tags || []).join(', ')),
    escapeCSV(cd.coverUrl || ''),
    escapeCSV(cd.notes || ''),
    escapeCSV(cd.source || ''),
    escapeCSV(cd.createdAt || ''),
  ]);

  return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * 2. Export Tracklist Details CSV (収録曲詳細リスト)
 * Outputs 1 row per track with Catalog Number and Album Title for linking.
 */
export function generateTracksCSVContent(cds: CDMetadata[]): string {
  const headers = [
    '型番',
    'CDタイトル',
    'トラック番号',
    '曲名',
    '演奏時間',
    'アーティスト',
  ];

  const rows: string[][] = [];
  cds.forEach((cd) => {
    if (cd.tracks && cd.tracks.length > 0) {
      cd.tracks.forEach((tr) => {
        rows.push([
          escapeCSV(cd.catalogNumber || ''),
          escapeCSV(cd.title || ''),
          String(tr.trackNumber || 1),
          escapeCSV(tr.title || ''),
          escapeCSV(tr.duration || ''),
          escapeCSV(tr.artist || cd.artist || ''),
        ]);
      });
    }
  });

  return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * 3. Export Single Combined Detailed CSV (全収録曲統合一覧: 1行1曲・アルバム情報付帯)
 */
export function generateCombinedCSVContent(cds: CDMetadata[]): string {
  const headers = [
    '型番',
    'CDタイトル',
    '歌手・アーティスト名',
    'レーベル・発売元',
    '発売年月日',
    '同タイトルLP/EP発売年月日',
    'アナログ盤種別(LP/EP)',
    'LP/EP規格品番',
    'JAN/EANバーコード',
    'トラック番号',
    '曲名',
    '演奏時間',
    'タグ',
    'ジャケット画像URL',
    'メモ',
  ];

  const rows: string[][] = [];
  cds.forEach((cd) => {
    if (cd.tracks && cd.tracks.length > 0) {
      cd.tracks.forEach((tr) => {
        rows.push([
          escapeCSV(cd.catalogNumber || ''),
          escapeCSV(cd.title || ''),
          escapeCSV(cd.artist || ''),
          escapeCSV(cd.label || ''),
          escapeCSV(cd.releaseDate || ''),
          escapeCSV(cd.vinylRecordReleaseDate || ''),
          escapeCSV(cd.vinylRecordFormat || ''),
          escapeCSV(cd.vinylRecordCatalogNumber || ''),
          escapeCSV(cd.barcode || ''),
          String(tr.trackNumber || 1),
          escapeCSV(tr.title || ''),
          escapeCSV(tr.duration || ''),
          escapeCSV((cd.tags || []).join(', ')),
          escapeCSV(cd.coverUrl || ''),
          escapeCSV(cd.notes || ''),
        ]);
      });
    } else {
      rows.push([
        escapeCSV(cd.catalogNumber || ''),
        escapeCSV(cd.title || ''),
        escapeCSV(cd.artist || ''),
        escapeCSV(cd.label || ''),
        escapeCSV(cd.releaseDate || ''),
        escapeCSV(cd.vinylRecordReleaseDate || ''),
        escapeCSV(cd.vinylRecordFormat || ''),
        escapeCSV(cd.vinylRecordCatalogNumber || ''),
        escapeCSV(cd.barcode || ''),
        '1',
        escapeCSV(''),
        escapeCSV(''),
        escapeCSV((cd.tags || []).join(', ')),
        escapeCSV(cd.coverUrl || ''),
        escapeCSV(cd.notes || ''),
      ]);
    }
  });

  return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * Helper to trigger file download in browser
 */
export function triggerFileDownload(content: string, fileName: string, mimeType: string = 'text/csv;charset=utf-8;'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Download Album Master CSV
 */
export function exportCDAlbumsCSV(cds: CDMetadata[]): void {
  if (cds.length === 0) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const content = generateAlbumsCSVContent(cds);
  triggerFileDownload(content, `CDコレクション_アルバム一覧_${dateStr}.csv`);
}

/**
 * Download Tracklist Details CSV
 */
export function exportCDTracksCSV(cds: CDMetadata[]): void {
  if (cds.length === 0) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const content = generateTracksCSVContent(cds);
  triggerFileDownload(content, `CDコレクション_収録曲詳細_${dateStr}.csv`);
}

/**
 * Download Both CSV files (Albums Master + Tracks Details)
 */
export function exportBothCSVs(cds: CDMetadata[]): void {
  if (cds.length === 0) return;
  exportCDAlbumsCSV(cds);
  setTimeout(() => {
    exportCDTracksCSV(cds);
  }, 400);
}

/**
 * Download Combined Flat Detailed CSV
 */
export function exportCDCombinedDetailedCSV(cds: CDMetadata[]): void {
  if (cds.length === 0) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const content = generateCombinedCSVContent(cds);
  triggerFileDownload(content, `CDコレクション_全収録曲統合一覧_${dateStr}.csv`);
}

/**
 * Parse 2D raw array from File (CSV or Excel) with proper UTF-8 / Shift-JIS encoding detection
 */
export async function parseFileTo2DArray(file: File): Promise<{
  headers: string[];
  rows: any[][];
  fileName: string;
  sheetNames: string[];
  workbook?: XLSX.WorkBook;
}> {
  const arrayBuffer = await file.arrayBuffer();
  const isCSV = file.name.toLowerCase().endsWith('.csv');

  let wb: XLSX.WorkBook;
  if (isCSV) {
    // Decode CSV explicitly as UTF-8 (fallback to Shift_JIS if invalid UTF-8 sequences exist)
    let csvText = '';
    try {
      const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
      csvText = utf8Decoder.decode(arrayBuffer);
    } catch {
      const sjisDecoder = new TextDecoder('shift-jis');
      csvText = sjisDecoder.decode(arrayBuffer);
    }
    // Strip BOM if present
    if (csvText.charCodeAt(0) === 0xfeff) {
      csvText = csvText.slice(1);
    }
    wb = XLSX.read(csvText, { type: 'string', raw: true });
  } else {
    wb = XLSX.read(arrayBuffer, { type: 'array', raw: false });
  }

  const sheetNames = wb.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error(`ファイル「${file.name}」からシートを読み込めませんでした。`);
  }

  const firstSheetName = sheetNames[0];
  const ws = wb.Sheets[firstSheetName];
  const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

  if (!data || data.length === 0) {
    throw new Error(`ファイル「${file.name}」に有効な行データがありません。`);
  }

  const headers = (data[0] || []).map((h: any) => String(h || '').trim());
  const rows = data.slice(1);

  return {
    headers,
    rows,
    fileName: file.name,
    sheetNames,
    workbook: wb,
  };
}

/**
 * Checks whether header list represents a Tracklist file vs Album Master file
 */
function isTracklistHeader(headers: string[]): boolean {
  const normalized = headers.map((h) => h.toLowerCase());
  const hasTrackField = normalized.some((h) =>
    h.includes('曲名') || h.includes('トラック番号') || h.includes('曲順') || h.includes('演奏時間') || h.includes('track')
  );
  const hasAlbumExclusiveField = normalized.some((h) =>
    h.includes('レーベル') || h.includes('発売元') || h.includes('発売年月日') || h.includes('バーコード') || h.includes('jan')
  );

  return hasTrackField && !hasAlbumExclusiveField;
}

/**
 * Parse 1 or 2 (or more) CSV or Excel files into CDMetadata records
 */
export async function parseMultipleCSVFilesToCDs(files: File[]): Promise<{
  cds: CDMetadata[];
  totalAlbums: number;
  totalTracks: number;
  fileNames: string[];
  matchedTracksCount: number;
  albumFileName?: string;
  trackFileName?: string;
}> {
  if (files.length === 0) {
    throw new Error('読み込むファイルが選択されていません。');
  }

  // Case A: 1 Excel file with multiple sheets
  if (files.length === 1 && (files[0].name.toLowerCase().endsWith('.xlsx') || files[0].name.toLowerCase().endsWith('.xls'))) {
    const file = files[0];
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetNames = wb.SheetNames;

    const albumSheetName =
      sheetNames.find((n) => n.includes('アルバム') || n.includes('CD') || n === 'CDコレクション') || sheetNames[0];
    const trackSheetName = sheetNames.find(
      (n) => n !== albumSheetName && (n.includes('収録曲') || n.includes('トラック') || n.toLowerCase().includes('track'))
    );

    const wsAlbum = wb.Sheets[albumSheetName];
    const albumData: any[][] = XLSX.utils.sheet_to_json(wsAlbum, { header: 1, defval: '', raw: false });
    const albumHeaders = (albumData[0] || []).map((h: any) => String(h || '').trim());
    const albumRows = albumData.slice(1);

    let trackHeaders: string[] | undefined;
    let trackRows: any[][] | undefined;
    if (trackSheetName && wb.Sheets[trackSheetName]) {
      const wsTrack = wb.Sheets[trackSheetName];
      const trackData: any[][] = XLSX.utils.sheet_to_json(wsTrack, { header: 1, defval: '', raw: false });
      if (trackData && trackData.length > 0) {
        trackHeaders = (trackData[0] || []).map((h: any) => String(h || '').trim());
        trackRows = trackData.slice(1);
      }
    }

    const cds = parseSpreadsheetRowsToCDs(albumHeaders, albumRows, trackHeaders, trackRows);
    const totalTracks = cds.reduce((sum, cd) => sum + (cd.tracks?.length || 0), 0);
    return {
      cds,
      totalAlbums: cds.length,
      totalTracks,
      fileNames: [file.name],
      matchedTracksCount: totalTracks,
      albumFileName: `${file.name} [${albumSheetName}]`,
      trackFileName: trackSheetName ? `${file.name} [${trackSheetName}]` : undefined,
    };
  }

  // Case B: 1 or more CSV files
  const parsedFiles = await Promise.all(files.map((f) => parseFileTo2DArray(f)));

  let albumParsed = parsedFiles.find((p) => !isTracklistHeader(p.headers));
  let trackParsed = parsedFiles.find((p) => isTracklistHeader(p.headers));

  // If ONLY a Tracklist CSV was uploaded (1 file and it's a tracklist), parse it as a 1-row-per-track combined table
  // so it groups tracks into albums by catalogNumber / CDタイトル instead of creating 1 album per track!
  if (!albumParsed && trackParsed && parsedFiles.length === 1) {
    const cds = parseSpreadsheetRowsToCDs(trackParsed.headers, trackParsed.rows);
    const totalTracks = cds.reduce((sum, cd) => sum + (cd.tracks?.length || 0), 0);
    return {
      cds,
      totalAlbums: cds.length,
      totalTracks,
      fileNames: files.map((f) => f.name),
      matchedTracksCount: totalTracks,
      albumFileName: trackParsed.fileName,
    };
  }

  // Fallback if neither or both matched
  if (!albumParsed) {
    albumParsed = parsedFiles[0];
  }
  if (!trackParsed && parsedFiles.length > 1) {
    trackParsed = parsedFiles.find((p) => p !== albumParsed);
  }

  const cds = parseSpreadsheetRowsToCDs(
    albumParsed.headers,
    albumParsed.rows,
    trackParsed?.headers,
    trackParsed?.rows
  );

  const totalTracks = cds.reduce((sum, cd) => sum + (cd.tracks?.length || 0), 0);

  return {
    cds,
    totalAlbums: cds.length,
    totalTracks,
    fileNames: files.map((f) => f.name),
    matchedTracksCount: totalTracks,
    albumFileName: albumParsed.fileName,
    trackFileName: trackParsed?.fileName,
  };
}
