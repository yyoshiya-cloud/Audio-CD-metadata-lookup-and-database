import * as XLSX from 'xlsx';
import { CDMetadata, ExportColumnConfig, TrackInfo } from '../types/cd';
import { 
  DEFAULT_COLUMN_CONFIG, 
  ALBUM_SHEET_NAME, 
  TRACKLIST_SHEET_NAME, 
  TRACKLIST_HEADERS,
  formatCDToRowValues,
  formatTrackToRowValues,
  parseSpreadsheetRowsToCDs
} from './googleSheets';
import { normalizeCatalogNumber } from './dateUtils';

/**
 * Export CD Collection to an Excel (.xlsx) file with 2 relational sheets:
 * 1. "CDアルバム一覧" (Albums Master)
 * 2. "収録曲リスト" (Tracks linked by Catalog Number)
 */
export function exportCDsToExcel(
  items: CDMetadata[],
  fileName?: string,
  columns: ExportColumnConfig[] = DEFAULT_COLUMN_CONFIG
): { fileName: string; count: number; totalTracks: number } {
  const activeCols = columns.filter((c) => c.enabled);
  const albumHeaders = activeCols.map((c) => c.label);

  // 1. Build Album Master rows
  const albumRows: any[][] = [albumHeaders];
  items.forEach((cd) => {
    albumRows.push(formatCDToRowValues(cd, columns));
  });

  // 2. Build Tracklist rows
  const trackRows: any[][] = [TRACKLIST_HEADERS];
  let totalTracks = 0;
  items.forEach((cd) => {
    if (cd.tracks && cd.tracks.length > 0) {
      cd.tracks.forEach((track) => {
        trackRows.push(formatTrackToRowValues(cd, track));
        totalTracks++;
      });
    }
  });

  // Create Workbook
  const wb = XLSX.utils.book_new();

  // Create Album Sheet
  const wsAlbums = XLSX.utils.aoa_to_sheet(albumRows);
  // Auto calculate column widths
  const albumColWidths = albumHeaders.map((h, colIdx) => {
    let maxLen = h.length * 2;
    albumRows.forEach((r) => {
      const cellVal = String(r[colIdx] || '');
      maxLen = Math.max(maxLen, Math.min(cellVal.length * 1.5, 40));
    });
    return { wch: Math.max(maxLen, 12) };
  });
  wsAlbums['!cols'] = albumColWidths;
  XLSX.utils.book_append_sheet(wb, wsAlbums, ALBUM_SHEET_NAME);

  // Create Tracklist Sheet
  const wsTracks = XLSX.utils.aoa_to_sheet(trackRows);
  const trackColWidths = TRACKLIST_HEADERS.map((h, colIdx) => {
    let maxLen = h.length * 2;
    trackRows.forEach((r) => {
      const cellVal = String(r[colIdx] || '');
      maxLen = Math.max(maxLen, Math.min(cellVal.length * 1.5, 35));
    });
    return { wch: Math.max(maxLen, 12) };
  });
  wsTracks['!cols'] = trackColWidths;
  XLSX.utils.book_append_sheet(wb, wsTracks, TRACKLIST_SHEET_NAME);

  // Default File Name
  const defaultDate = new Date().toISOString().slice(0, 10);
  const finalFileName = (fileName?.trim() || `CDコレクション_${defaultDate}`) + '.xlsx';

  // Write and trigger download in browser
  XLSX.writeFile(wb, finalFileName, { bookType: 'xlsx', type: 'binary' });

  return {
    fileName: finalFileName,
    count: items.length,
    totalTracks,
  };
}

/**
 * Read and parse an Excel (.xlsx / .xls / .csv) file into CDMetadata records
 */
export async function parseExcelFileToCDs(file: File): Promise<{
  cds: CDMetadata[];
  sheetNames: string[];
  totalAlbums: number;
  totalTracks: number;
  fileName: string;
}> {
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  const sheetNames = wb.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error('Excelファイル内に有効なシートが見つかりませんでした。');
  }

  // Find Album sheet
  const albumSheetName =
    sheetNames.find((n) => n === ALBUM_SHEET_NAME || n === 'CDデータベース' || n.includes('アルバム') || n.includes('CD')) ||
    sheetNames[0];

  const wsAlbum = wb.Sheets[albumSheetName];
  const albumData: any[][] = XLSX.utils.sheet_to_json(wsAlbum, { header: 1, defval: '', raw: false });

  if (!albumData || albumData.length === 0) {
    throw new Error(`シート「${albumSheetName}」にデータがありません。`);
  }

  const albumHeaders = (albumData[0] || []).map((h: any) => String(h || '').trim());
  const albumRows = albumData.slice(1);

  // Check Tracklist sheet
  const trackSheetName = sheetNames.find(
    (n) => n !== albumSheetName && (n === TRACKLIST_SHEET_NAME || n.includes('収録曲') || n.includes('トラック') || n.toLowerCase().includes('track'))
  );

  let trackHeaders: string[] | undefined = undefined;
  let trackRows: any[][] | undefined = undefined;

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
    sheetNames,
    totalAlbums: cds.length,
    totalTracks,
    fileName: file.name,
  };
}
