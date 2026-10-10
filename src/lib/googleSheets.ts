import { CDMetadata, ExportColumnConfig, SpreadsheetInfo, APISource, TrackInfo, CDSubImage, SubImageType } from '../types/cd';
import { formatJSTDateTime, getJSTISOString, normalizeReleaseDate, normalizeCatalogNumber } from './dateUtils';

export const DEFAULT_COLUMN_CONFIG: ExportColumnConfig[] = [
  { key: 'catalogNumber', label: '型番（規格品番）', enabled: true },
  { key: 'title', label: 'アルバム/CDタイトル', enabled: true },
  { key: 'artist', label: '歌手/アーティスト', enabled: true },
  { key: 'label', label: 'レーベル/発売元', enabled: true },
  { key: 'releaseDate', label: '発売年月日', enabled: true },
  { key: 'vinylRecordReleaseDate', label: '同タイトルLP/EP発売年月日', enabled: true },
  { key: 'vinylRecordFormat', label: 'アナログ盤種別(LP/EP)', enabled: true },
  { key: 'vinylRecordCatalogNumber', label: 'LP/EP規格品番', enabled: true },
  { key: 'barcode', label: 'JAN/EANバーコード', enabled: true },
  { key: 'country', label: '発売国/仕様', enabled: true },
  { key: 'format', label: 'フォーマット', enabled: true },
  { key: 'tags', label: 'タグ', enabled: true },
  { key: 'coverUrl', label: 'ジャケット画像URL', enabled: true },
  { key: 'backCoverUrl', label: '裏ジャケット', enabled: true },
  { key: 'obiUrl', label: '帯', enabled: true },
  { key: 'discUrl', label: '盤面', enabled: true },
  { key: 'bookletUrl', label: '歌詞カード・ブックレット', enabled: true },
  { key: 'otherSubImagesUrl', label: 'その他付属画像', enabled: true },
  { key: 'source', label: '取得データ元', enabled: true },
  { key: 'notes', label: 'メモ', enabled: true },
  { key: 'createdAt', label: '登録日時', enabled: true },
];

export const TRACKLIST_SHEET_NAME = '収録曲リスト';
export const ALBUM_SHEET_NAME = 'CDアルバム一覧';

export const TRACKLIST_HEADERS = [
  '型番（規格品番）',
  '曲順（トラック番号）',
  '曲名（トラックタイトル）',
  '演奏時間（分:秒）',
  'アルバム名',
  'アーティスト名',
  'トラックアーティスト/演奏者',
  '試聴URL',
];

const KNOWN_SPREADSHEETS_KEY = 'cd_catalog_known_spreadsheets_v1';
const PRIMARY_SPREADSHEET_KEY = 'cd_catalog_primary_spreadsheet_v1';

export function getPrimarySpreadsheet(): SpreadsheetInfo | null {
  try {
    const raw = localStorage.getItem(PRIMARY_SPREADSHEET_KEY);
    if (raw) return JSON.parse(raw);
    const known = getKnownSpreadsheets();
    return known.length > 0 ? known[0] : null;
  } catch {
    return null;
  }
}

export function savePrimarySpreadsheet(sheet: SpreadsheetInfo): void {
  try {
    localStorage.setItem(PRIMARY_SPREADSHEET_KEY, JSON.stringify(sheet));
    saveKnownSpreadsheet(sheet);
  } catch (e) {
    console.warn('Failed to save primary spreadsheet:', e);
  }
}

export function clearPrimarySpreadsheet(): void {
  try {
    localStorage.removeItem(PRIMARY_SPREADSHEET_KEY);
  } catch (e) {
    console.warn('Failed to clear primary spreadsheet:', e);
  }
}

export function getKnownSpreadsheets(): SpreadsheetInfo[] {
  try {
    const raw = localStorage.getItem(KNOWN_SPREADSHEETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveKnownSpreadsheet(sheet: SpreadsheetInfo): void {
  try {
    const list = getKnownSpreadsheets();
    const filtered = list.filter((s) => s.spreadsheetId !== sheet.spreadsheetId);
    filtered.unshift(sheet);
    localStorage.setItem(KNOWN_SPREADSHEETS_KEY, JSON.stringify(filtered.slice(0, 30)));
  } catch (e) {
    console.warn('Failed to save known spreadsheet:', e);
  }
}

export function removeKnownSpreadsheet(spreadsheetId: string): void {
  try {
    const list = getKnownSpreadsheets();
    const filtered = list.filter((s) => s.spreadsheetId !== spreadsheetId);
    localStorage.setItem(KNOWN_SPREADSHEETS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('Failed to remove known spreadsheet:', e);
  }
}

/**
 * Delete a spreadsheet from Google Drive (trash or permanent)
 */
export async function deleteSpreadsheetFromDrive(accessToken: string, spreadsheetId: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const errText = await response.text();
    throw new Error(`Driveファイル削除エラー (${response.status}): ${errText}`);
  }

  removeKnownSpreadsheet(spreadsheetId);
}

/**
 * List spreadsheets created by the user or in Google Drive
 */
export async function listUserSpreadsheets(accessToken: string): Promise<SpreadsheetInfo[]> {
  const localSheets = getKnownSpreadsheets();
  const map = new Map<string, SpreadsheetInfo>();
  localSheets.forEach((s) => map.set(s.spreadsheetId, s));

  try {
    const query = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink,modifiedTime,createdTime)&pageSize=50&orderBy=modifiedTime desc`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      (data.files || []).forEach((file: any) => {
        const item: SpreadsheetInfo = {
          spreadsheetId: file.id,
          title: file.name,
          spreadsheetUrl: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
          sheets: [
            { sheetId: 0, title: ALBUM_SHEET_NAME },
            { sheetId: 1, title: TRACKLIST_SHEET_NAME },
          ],
          modifiedTime: file.modifiedTime,
          createdTime: file.createdTime,
        };
        map.set(file.id, item);
        saveKnownSpreadsheet(item);
      });
    } else {
      console.warn(`Drive API query returned status ${response.status}`);
    }
  } catch (err) {
    console.warn('Google Drive API listing fallback to known spreadsheets:', err);
  }

  const allSheets = Array.from(map.values());
  allSheets.sort((a, b) => {
    const timeA = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
    const timeB = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
    return timeB - timeA;
  });

  return allSheets;
}

/**
 * Create a brand new Google Spreadsheet with 2 relational sheets:
 * Sheet 1: "CDアルバム一覧" (Album Master)
 * Sheet 2: "収録曲リスト" (Tracklist with Catalog Number Key)
 */
export async function createNewSpreadsheet(
  accessToken: string,
  title: string = `CDコレクションデータベース_${new Date().toISOString().slice(0, 10)}`
): Promise<SpreadsheetInfo> {
  try {
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title,
        },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: ALBUM_SHEET_NAME,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
          },
          {
            properties: {
              sheetId: 1,
              title: TRACKLIST_SHEET_NAME,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Sheets作成エラー (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const albumSheetId = data.sheets?.[0]?.properties?.sheetId || 0;
    const trackSheetId = data.sheets?.[1]?.properties?.sheetId || 1;

    // Format Header Row on both sheets
    await formatSpreadsheetHeader(accessToken, data.spreadsheetId, albumSheetId, { red: 0.16, green: 0.20, blue: 0.35 });
    await formatSpreadsheetHeader(accessToken, data.spreadsheetId, trackSheetId, { red: 0.10, green: 0.28, blue: 0.22 });

    const createdInfo: SpreadsheetInfo = {
      spreadsheetId: data.spreadsheetId,
      title: data.properties.title,
      spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
      sheets: [
        { sheetId: albumSheetId, title: ALBUM_SHEET_NAME },
        { sheetId: trackSheetId, title: TRACKLIST_SHEET_NAME },
      ],
    };

    saveKnownSpreadsheet(createdInfo);
    return createdInfo;
  } catch (err) {
    console.error('Error creating spreadsheet:', err);
    throw err;
  }
}

/**
 * Add header styling to spreadsheet
 */
async function formatSpreadsheetHeader(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  bgColor: { red: number; green: number; blue: number } = { red: 0.18, green: 0.22, blue: 0.35 }
) {
  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: bgColor,
                  textFormat: {
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    bold: true,
                    fontSize: 11,
                  },
                  horizontalAlignment: 'CENTER',
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
          },
          {
            setBasicFilter: {
              filter: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                },
              },
            },
          },
        ],
      }),
    });
  } catch (err) {
    console.warn('Could not apply header formatting styling:', err);
  }
}

const MAX_CELL_CHARACTERS = 45000;

/**
 * Sanitizes cell values for Google Sheets and Excel (.xlsx) exports:
 * 1. Prevents Formula Injection (cells starting with =, +, -, @, \t, \r are prefixed with ')
 *    unless allowTrustedFormula is explicitly true.
 * 2. Enforces the 45,000-character cell limit.
 */
function sanitizeCellValue(val: any, allowTrustedFormula: boolean = false): any {
  if (typeof val === 'string') {
    let processed = val;
    if (!allowTrustedFormula && /^[\s]*[=+\-@\t\r]/.test(processed)) {
      processed = `'${processed}`;
    }
    if (processed.length > MAX_CELL_CHARACTERS) {
      return processed.slice(0, MAX_CELL_CHARACTERS) + '... (※セル文字数制限50,000字のため省略)';
    }
    return processed;
  }
  return val;
}

/**
 * Upload a base64 data: URL image to Google Drive and return a viewable thumbnail URL
 */
export async function uploadBase64ImageToDrive(
  accessToken: string,
  dataUrl: string,
  fileName: string
): Promise<string> {
  const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!matches) throw new Error('Invalid data URL');
  const mimeType = matches[1];
  const base64Data = matches[2];

  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  const metadata = {
    name: fileName,
    mimeType: mimeType,
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive image upload failed (${response.status}): ${errText}`);
  }

  const file = await response.json();

  // Make file publicly viewable so Google Sheets =IMAGE formula can load it
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    });
  } catch (e) {
    console.warn('Failed to set public permission on Drive image:', e);
  }

  return `https://drive.google.com/thumbnail?id=${file.id}&sz=w800`;
}

const SUB_IMAGE_TYPE_MAP: Record<
  'backCoverUrl' | 'obiUrl' | 'discUrl' | 'bookletUrl' | 'otherSubImagesUrl',
  SubImageType
> = {
  backCoverUrl: 'back',
  obiUrl: 'obi',
  discUrl: 'disc',
  bookletUrl: 'booklet',
  otherSubImagesUrl: 'other',
};

const SUB_IMAGE_DEFAULT_LABELS: Record<SubImageType, string> = {
  back: '裏ジャケット (バックインレイ)',
  obi: '帯 (オビ)',
  disc: '盤面 (ディスク・レーベル面)',
  booklet: '歌詞カード・ブックレット',
  other: 'その他付属画像',
};

export function getSerializedSubImagesByType(
  cd: CDMetadata,
  type: SubImageType,
  mode: 'raw' | 'sheets' = 'raw'
): string {
  const subs = (cd.subImages || []).filter((s) => s && s.type === type && s.imageUrl && s.imageUrl.trim());
  if (subs.length === 0) return '';

  if (mode === 'sheets') {
    // If single HTTP/HTTPS URL, we can use =IFERROR(IMAGE(...)) just like coverUrl
    if (subs.length === 1 && !subs[0].imageUrl.startsWith('data:')) {
      const safeUrl = subs[0].imageUrl.trim().replace(/"/g, '%22');
      return `=IFERROR(IMAGE("${safeUrl}"), "${safeUrl}")`;
    }
    return subs
      .map((s) => {
        const u = s.imageUrl.trim();
        if (u.startsWith('data:') && u.length > MAX_CELL_CHARACTERS) {
          return '[添付画像あり(端末ローカル)]';
        }
        return u;
      })
      .join(' || ');
  }

  return subs.map((s) => s.imageUrl.trim()).join(' || ');
}

/**
 * Format CD metadata item into export row based on column config for Album Master Sheet
 */
export function formatCDToRowValues(
  cd: CDMetadata,
  columns: ExportColumnConfig[],
  options?: { forGoogleSheetsFormula?: boolean }
): any[] {
  const activeCols = columns.filter((c) => c.enabled);
  const forSheetsFormula = options?.forGoogleSheetsFormula ?? true;

  return activeCols.map((col) => {
    let cellValue: any = '';

    if (col.key === 'trackListText') {
      if (!cd.tracks || cd.tracks.length === 0) {
        cellValue = '0曲';
      } else {
        cellValue = `${cd.tracks.length}曲（詳細は「収録曲リスト」シート参照）`;
      }
    } else if (col.key === 'source') {
      const sourceNames: Record<string, string> = {
        musicbrainz: 'MusicBrainz',
        discogs: 'Discogs',
        itunes: 'iTunes Search',
        ndl: '国立国会図書館(NDL)',
        spotify: 'Spotify',
        rakuten: '楽天ブックス',
        gemini: 'AI OCR (Gemini)',
      };
      cellValue = sourceNames[cd.source] || cd.source;
    } else if (col.key === 'coverUrl') {
      if (!cd.coverUrl) {
        cellValue = '';
      } else if (cd.coverUrl.startsWith('data:')) {
        if (!forSheetsFormula || cd.coverUrl.length <= MAX_CELL_CHARACTERS) {
          cellValue = cd.coverUrl;
        } else {
          cellValue = '[添付画像あり(端末ローカル)]';
        }
      } else if (forSheetsFormula) {
        // Safely escape any double quotes in URL before embedding into =IFERROR(IMAGE(...))
        const safeUrl = cd.coverUrl.replace(/"/g, '%22');
        cellValue = `=IFERROR(IMAGE("${safeUrl}"), "${safeUrl}")`;
        return sanitizeCellValue(cellValue, true);
      } else {
        cellValue = cd.coverUrl;
      }
    } else if (
      col.key === 'backCoverUrl' ||
      col.key === 'obiUrl' ||
      col.key === 'discUrl' ||
      col.key === 'bookletUrl' ||
      col.key === 'otherSubImagesUrl'
    ) {
      const subType = SUB_IMAGE_TYPE_MAP[col.key];
      const serialized = getSerializedSubImagesByType(
        cd,
        subType,
        forSheetsFormula ? 'sheets' : 'raw'
      );
      if (serialized.startsWith('=IFERROR(IMAGE(')) {
        return sanitizeCellValue(serialized, true);
      }
      cellValue = serialized;
    } else if (col.key === 'createdAt' || col.key === 'updatedAt') {
      const val = cd[col.key as 'createdAt' | 'updatedAt'];
      cellValue = val ? formatJSTDateTime(val) : '';
    } else if (col.key === 'catalogNumber') {
      cellValue = normalizeCatalogNumber(cd.catalogNumber);
    } else if (col.key === 'releaseDate') {
      cellValue = normalizeReleaseDate(cd.releaseDate);
    } else if (col.key === 'vinylRecordReleaseDate') {
      cellValue = normalizeReleaseDate(cd.vinylRecordReleaseDate);
    } else if (col.key === 'vinylRecordCatalogNumber') {
      cellValue = normalizeCatalogNumber(cd.vinylRecordCatalogNumber);
    } else {
      const val = cd[col.key as keyof CDMetadata];
      if (Array.isArray(val)) {
        cellValue = val.join(', ');
      } else {
        cellValue = val !== undefined && val !== null ? String(val) : '';
      }
    }

    return sanitizeCellValue(cellValue);
  });
}

/**
 * Format Track item into row values for the separate "収録曲リスト" sheet
 * Columns: [型番, 曲順, 曲名, 演奏時間, アルバム名, アーティスト名, トラックアーティスト, 試聴URL]
 */
export function formatTrackToRowValues(cd: CDMetadata, track: TrackInfo): any[] {
  const catalogKey = normalizeCatalogNumber(cd.catalogNumber) || cd.title;
  return [
    sanitizeCellValue(catalogKey),
    track.trackNumber,
    sanitizeCellValue(track.title || ''),
    sanitizeCellValue(track.duration || ''),
    sanitizeCellValue(cd.title || ''),
    sanitizeCellValue(cd.artist || ''),
    sanitizeCellValue(track.artist || ''),
    sanitizeCellValue(track.previewUrl || ''),
  ];
}

/**
 * Format a sheet name and cell range into a safe Google Sheets A1 range string
 */
export function formatA1Range(sheetName: string, cellRange: string): string {
  const cleanSheetName = (sheetName || '').trim() || ALBUM_SHEET_NAME;
  const escaped = cleanSheetName.replace(/'/g, "''");
  return `'${escaped}'!${cellRange}`;
}

/**
 * Ensure a sheet tab with given title exists in the target spreadsheet.
 * If it doesn't exist, create it with addSheet batchUpdate or resolve to a valid existing sheet tab.
 * Returns the resolved exact sheet title.
 */
export async function ensureSheetExists(
  accessToken: string,
  spreadsheetId: string,
  preferredSheetName: string,
  isMasterAlbumSheet: boolean = false
): Promise<string> {
  const cleanPreferred = (preferredSheetName || '').trim() || (isMasterAlbumSheet ? ALBUM_SHEET_NAME : TRACKLIST_SHEET_NAME);

  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!metaRes.ok) {
      console.warn(`Could not fetch spreadsheet metadata (${metaRes.status})`);
      return cleanPreferred;
    }

    const meta = await metaRes.json();
    const sheets = meta.sheets || [];
    const titles: string[] = sheets.map((s: any) => s.properties?.title).filter(Boolean);

    // 1. Exact match
    const exact = titles.find((t) => t === cleanPreferred);
    if (exact) return exact;

    // 2. Case-insensitive or trimmed match
    const close = titles.find((t) => t.toLowerCase() === cleanPreferred.toLowerCase());
    if (close) return close;

    // 3. If master album sheet, check common aliases or standard first sheet
    if (isMasterAlbumSheet) {
      const albumMatch = titles.find((t) =>
        ['cdアルバム一覧', 'cdデータベース', 'アルバム一覧', 'cdカタログ', 'アルバム', 'sheet1', 'シート1'].includes(t.toLowerCase())
      );
      if (albumMatch) return albumMatch;

      // If there's only 1 sheet in the spreadsheet (e.g. newly created blank Google Sheet), use its name
      if (titles.length === 1) {
        return titles[0];
      }
    } else {
      // If tracklist sheet, check track-related titles
      const trackMatch = titles.find((t) =>
        ['収録曲リスト', '収録曲一覧', 'トラック一覧', 'tracklist', 'tracks'].includes(t.toLowerCase())
      );
      if (trackMatch) return trackMatch;
    }

    // 4. If sheet really doesn't exist, create it via batchUpdate addSheet
    const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: cleanPreferred,
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
            },
          },
        ],
      }),
    });

    if (addRes.ok) {
      const addData = await addRes.json();
      const newSheetId = addData.replies?.[0]?.addSheet?.properties?.sheetId;
      if (typeof newSheetId === 'number') {
        const headerBg = isMasterAlbumSheet
          ? { red: 0.16, green: 0.20, blue: 0.35 }
          : { red: 0.10, green: 0.28, blue: 0.22 };
        await formatSpreadsheetHeader(accessToken, spreadsheetId, newSheetId, headerBg);
      }
      return cleanPreferred;
    } else {
      console.warn('addSheet request failed, falling back to existing sheet');
      if (titles.length > 0) return titles[0];
    }
  } catch (err) {
    console.warn('Error in ensureSheetExists:', err);
  }

  return cleanPreferred;
}

/**
 * Export, Update or Append CD records to a Google Spreadsheet with 2 Relational Sheets:
 * - Sheet 1: CDアルバム一覧 (Albums Master)
 * - Sheet 2: 収録曲リスト (Tracks linked by Catalog Number)
 */
export async function exportCDsToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string = ALBUM_SHEET_NAME,
  items: CDMetadata[],
  columns: ExportColumnConfig[] = DEFAULT_COLUMN_CONFIG,
  writeMode: 'overwrite' | 'append' = 'overwrite'
): Promise<{ addedCount: number; totalTracksAdded: number; spreadsheetUrl: string }> {
  if (items.length === 0) {
    return { addedCount: 0, totalTracksAdded: 0, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
  }

  const activeCols = columns.filter((c) => c.enabled);
  const headerRow = activeCols.map((c) => c.label);

  // Pre-process items: if any has a base64 coverUrl or subImages, upload it to Google Drive to obtain a real image URL
  const processedItems: CDMetadata[] = [];
  for (const cd of items) {
    let nextCoverUrl = cd.coverUrl;
    if (cd.coverUrl && cd.coverUrl.startsWith('data:image/')) {
      try {
        nextCoverUrl = await uploadBase64ImageToDrive(
          accessToken,
          cd.coverUrl,
          `CD_Cover_${normalizeCatalogNumber(cd.catalogNumber) || cd.id || Date.now()}.jpg`
        );
      } catch (err) {
        console.warn('Could not upload base64 cover to Drive, using fallback:', err);
      }
    }

    let nextSubImages = cd.subImages;
    if (Array.isArray(cd.subImages) && cd.subImages.length > 0) {
      const uploadedSubs: CDSubImage[] = [];
      for (let sIdx = 0; sIdx < cd.subImages.length; sIdx++) {
        const sub = cd.subImages[sIdx];
        if (sub && sub.imageUrl && sub.imageUrl.startsWith('data:image/')) {
          try {
            const subDriveUrl = await uploadBase64ImageToDrive(
              accessToken,
              sub.imageUrl,
              `CD_${sub.type}_${normalizeCatalogNumber(cd.catalogNumber) || cd.id || Date.now()}_${sIdx + 1}.jpg`
            );
            uploadedSubs.push({ ...sub, imageUrl: subDriveUrl });
          } catch (err) {
            console.warn(`Could not upload base64 subImage (${sub.type}) to Drive:`, err);
            uploadedSubs.push(sub);
          }
        } else if (sub) {
          uploadedSubs.push(sub);
        }
      }
      nextSubImages = uploadedSubs;
    }

    processedItems.push({
      ...cd,
      coverUrl: nextCoverUrl,
      subImages: nextSubImages,
    });
  }

  // 1. EXPORT SHEET 1: ALBUM MASTER
  const resolvedAlbumSheet = await ensureSheetExists(accessToken, spreadsheetId, sheetName, true);

  if (writeMode === 'overwrite') {
    // Clear existing values in Album Sheet
    try {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(resolvedAlbumSheet)}:clear`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
    } catch (clearErr) {
      console.warn('Could not clear album sheet:', clearErr);
    }

    const albumRows: any[][] = [headerRow];
    processedItems.forEach((cd) => {
      albumRows.push(formatCDToRowValues(cd, columns));
    });

    const albumTargetRange = formatA1Range(resolvedAlbumSheet, 'A1');
    const updateAlbumRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(albumTargetRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: albumRows,
        }),
      }
    );

    if (!updateAlbumRes.ok) {
      const errText = await updateAlbumRes.text();
      throw new Error(`アルバムシート更新エラー (${updateAlbumRes.status}): ${errText}`);
    }
  } else {
    // Append Mode
    const checkAlbumRangeStr = formatA1Range(resolvedAlbumSheet, 'A1:Z1');
    const checkRangeResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(checkAlbumRangeStr)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    let needAlbumHeader = true;
    if (checkRangeResponse.ok) {
      const checkData = await checkRangeResponse.json();
      if (checkData.values && checkData.values.length > 0 && checkData.values[0].length > 0) {
        needAlbumHeader = false;
      }
    }

    const albumRowsToAppend: any[][] = [];
    if (needAlbumHeader) albumRowsToAppend.push(headerRow);
    processedItems.forEach((cd) => {
      albumRowsToAppend.push(formatCDToRowValues(cd, columns));
    });

    const albumTargetRange = formatA1Range(resolvedAlbumSheet, 'A1');
    const appendAlbumRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(albumTargetRange)}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: albumRowsToAppend }),
      }
    );

    if (!appendAlbumRes.ok) {
      const errText = await appendAlbumRes.text();
      throw new Error(`アルバムシート追記エラー (${appendAlbumRes.status}): ${errText}`);
    }
  }

  // 2. EXPORT SHEET 2: TRACKLIST (収録曲リスト)
  let totalTracksAdded = 0;
  try {
    const resolvedTrackSheet = await ensureSheetExists(accessToken, spreadsheetId, TRACKLIST_SHEET_NAME, false);

    if (writeMode === 'overwrite') {
      // Clear existing values in Tracklist Sheet
      try {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(resolvedTrackSheet)}:clear`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
      } catch (clearErr) {
        console.warn('Could not clear tracklist sheet:', clearErr);
      }

      const trackRows: any[][] = [TRACKLIST_HEADERS];
      for (const cd of processedItems) {
        if (cd.tracks && cd.tracks.length > 0) {
          for (const tr of cd.tracks) {
            trackRows.push(formatTrackToRowValues(cd, tr));
            totalTracksAdded++;
          }
        }
      }

      const trackTargetRange = formatA1Range(resolvedTrackSheet, 'A1');
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(trackTargetRange)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: trackRows }),
        }
      );
    } else {
      // Append Mode
      const checkTrackRangeStr = formatA1Range(resolvedTrackSheet, 'A1:Z1');
      const checkTrackRangeRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(checkTrackRangeStr)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      let needTrackHeader = true;
      if (checkTrackRangeRes.ok) {
        const trackData = await checkTrackRangeRes.json();
        if (trackData.values && trackData.values.length > 0 && trackData.values[0].length > 0) {
          needTrackHeader = false;
        }
      }

      const trackRowsToAppend: any[][] = [];
      if (needTrackHeader) trackRowsToAppend.push(TRACKLIST_HEADERS);

      for (const cd of processedItems) {
        if (cd.tracks && cd.tracks.length > 0) {
          for (const tr of cd.tracks) {
            trackRowsToAppend.push(formatTrackToRowValues(cd, tr));
            totalTracksAdded++;
          }
        }
      }

      if (trackRowsToAppend.length > 0) {
        const trackTargetRange = formatA1Range(resolvedTrackSheet, 'A1');
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(trackTargetRange)}:append?valueInputOption=USER_ENTERED`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: trackRowsToAppend }),
          }
        );
      }
    }
  } catch (trackErr) {
    console.warn('Warning exporting tracks to separate sheet:', trackErr);
  }

  return {
    addedCount: items.length,
    totalTracksAdded,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

/**
 * Extract spreadsheet ID from full URL or return ID as-is
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return trimmed;
}

/**
 * Read raw values from a Google Spreadsheet (reads both Album Master and Tracklist sheets if present)
 */
export async function readSpreadsheetValues(
  accessToken: string,
  spreadsheetIdOrUrl: string,
  sheetName?: string
): Promise<{
  headers: string[];
  rows: any[][];
  trackHeaders?: string[];
  trackRows?: any[][];
  spreadsheetTitle: string;
  sheetTitle: string;
  hasTracklistSheet: boolean;
}> {
  const spreadsheetId = extractSpreadsheetId(spreadsheetIdOrUrl);
  if (!spreadsheetId) {
    throw new Error('スプレッドシートIDまたはURLを入力してください。');
  }

  // Inspect spreadsheet metadata to get sheet names
  let targetSheetName = sheetName?.trim();
  let spreadsheetTitle = 'スプレッドシート';
  let availableSheets: string[] = [];

  try {
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (metaRes.ok) {
      const meta = await metaRes.json();
      spreadsheetTitle = meta.properties?.title || 'スプレッドシート';
      availableSheets = (meta.sheets || []).map((s: any) => s.properties?.title || '');
      if (!targetSheetName) {
        // Look for ALBUM_SHEET_NAME, "CDデータベース", or default first sheet
        targetSheetName =
          availableSheets.find((name) => name === ALBUM_SHEET_NAME || name === 'CDデータベース' || name.includes('アルバム')) ||
          availableSheets[0] ||
          'Sheet1';
      }
    }
  } catch (e) {
    console.warn('Failed to fetch spreadsheet metadata:', e);
  }

  // 1. Read Album Master Sheet (both FORMATTED_VALUE for dates/text and FORMULA for =IMAGE("...") URLs)
  const range = targetSheetName ? formatA1Range(targetSheetName, 'A1:Z5000') : 'A1:Z5000';
  const [response, formulaRes] = await Promise.all([
    fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    ),
    fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    ).catch(() => null),
  ]);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`スプレッドシート読み込みエラー (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const values: any[][] = data.values || [];

  // Merge any =IMAGE("...") formula strings into empty formatted cells so coverUrl is never lost
  if (formulaRes && formulaRes.ok) {
    try {
      const formulaData = await formulaRes.json();
      const fValues: any[][] = formulaData.values || [];
      for (let r = 1; r < values.length; r++) {
        const fRow = fValues[r] || [];
        const vRow = values[r] || [];
        const maxCols = Math.max(vRow.length, fRow.length);
        for (let c = 0; c < maxCols; c++) {
          const fCell = String(fRow[c] ?? '');
          if (fCell.startsWith('=') && fCell.toUpperCase().includes('IMAGE')) {
            vRow[c] = fCell;
          }
        }
        values[r] = vRow;
      }
    } catch {}
  }

  const headers = (values[0] || []).map((h: any) => String(h || '').trim());
  const rows = values.slice(1);

  // 2. Read "収録曲リスト" Sheet if present
  let trackHeaders: string[] | undefined = undefined;
  let trackRows: any[][] | undefined = undefined;
  const trackSheetName = availableSheets.find((n) => n === TRACKLIST_SHEET_NAME || n.includes('収録曲') || n.includes('トラック'));

  if (trackSheetName && trackSheetName !== targetSheetName) {
    try {
      const trackRange = formatA1Range(trackSheetName, 'A1:Z10000');
      const trackRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(trackRange)}?valueRenderOption=FORMATTED_VALUE`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (trackRes.ok) {
        const trackData = await trackRes.json();
        const tValues = trackData.values || [];
        if (tValues.length > 0) {
          trackHeaders = (tValues[0] || []).map((h: any) => String(h || '').trim());
          trackRows = tValues.slice(1);
        }
      }
    } catch (e) {
      console.warn('Could not read tracklist sheet:', e);
    }
  }

  saveKnownSpreadsheet({
    spreadsheetId,
    title: spreadsheetTitle,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheets: [
      { sheetId: 0, title: targetSheetName || 'CDアルバム一覧' },
      { sheetId: 1, title: TRACKLIST_SHEET_NAME },
    ],
  });

  return {
    headers,
    rows,
    trackHeaders,
    trackRows,
    spreadsheetTitle,
    sheetTitle: targetSheetName || 'CDアルバム一覧',
    hasTracklistSheet: Boolean(trackRows && trackRows.length > 0),
  };
}

/**
 * Parse rows into CDMetadata objects based on detected headers,
 * joining tracks from the relational "収録曲リスト" sheet by Catalog Number
 * or grouping combined 1-row-per-track tables automatically.
 */
export function parseSpreadsheetRowsToCDs(
  headers: string[],
  rows: any[][],
  trackHeaders?: string[],
  trackRows?: any[][]
): CDMetadata[] {
  const headerMap: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const clean = String(h || '').trim().toLowerCase();
    if (clean && headerMap[clean] === undefined) {
      headerMap[clean] = idx;
    }
  });

  const findColIndex = (...candidates: string[]): number => {
    // Pass 1: Exact match
    for (const c of candidates) {
      const lower = c.toLowerCase();
      if (headerMap[lower] !== undefined) {
        return headerMap[lower];
      }
    }
    // Pass 2: Header contains candidate
    for (const c of candidates) {
      const lower = c.toLowerCase();
      for (const [h, idx] of Object.entries(headerMap)) {
        if (h.includes(lower)) {
          return idx;
        }
      }
    }
    // Pass 3: Candidate contains header (only for meaningful headers >= 2 chars)
    for (const c of candidates) {
      const lower = c.toLowerCase();
      for (const [h, idx] of Object.entries(headerMap)) {
        if (h.length >= 2 && lower.includes(h)) {
          return idx;
        }
      }
    }
    return -1;
  };

  const catIdx = findColIndex('型番（規格品番）', '型番', '規格品番', 'catalognumber', 'catalog', 'catno');
  const titleIdx = findColIndex('アルバム/cdタイトル', 'cdタイトル', 'アルバムタイトル', 'アルバム名', 'アルバム', 'タイトル', 'title', 'album');
  const artistIdx = findColIndex('歌手/アーティスト', '歌手・アーティスト名', 'アーティスト名', '歌手', 'アーティスト', 'artist', 'creator');
  const labelIdx = findColIndex('レーベル/発売元', 'レーベル・発売元', 'レーベル', '発売元', 'label', 'publisher');
  const releaseIdx = findColIndex('cd発売年月日', '発売年月日', '発売日', 'releasedate', 'release');
  const vinylReleaseIdx = findColIndex('同タイトルlp/ep発売年月日', 'lp/ep発売年月日', 'lp/ep発売日', 'レコード発売年月日', 'レコード発売日', 'vinylrecordreleasedate');
  const vinylFormatIdx = findColIndex('アナログ盤種別(lp/ep)', 'アナログ盤種別', 'lp/ep種別', 'vinylrecordformat');
  const vinylCatIdx = findColIndex('lp/ep規格品番', 'レコード規格品番', 'vinylrecordcatalognumber');
  const barcodeIdx = findColIndex('jan/eanバーコード', 'バーコード(jan)', 'バーコード', 'jan', 'ean', 'barcode');
  const countryIdx = findColIndex('発売国/仕様', '発売国', '仕様', 'country');
  const formatIdx = findColIndex('フォーマット', 'format');
  const tagsIdx = findColIndex('タグ', 'ジャンル', 'tags', 'tag', 'genre');
  const trackIdx = findColIndex('トラックリスト（収録曲）', 'トラックリスト', '収録曲リスト', '曲目');
  const singleTrackNumIdx = findColIndex('トラック番号', '曲順（トラック番号）', '曲順', 'tracknumber');
  const singleTrackTitleIdx = findColIndex('曲名（トラックタイトル）', '曲名', 'トラックタイトル', 'tracktitle');
  const singleTrackDurationIdx = findColIndex('演奏時間（分:秒）', '演奏時間', '再生時間', 'duration');
  const coverIdx = findColIndex('ジャケット画像url', '表ジャケット画像url', '表ジャケット', 'ジャケット画像', 'ジャケット', '画像url', 'coverurl', 'cover', 'image');
  const backCoverIdx = findColIndex('裏ジャケット画像url', '裏ジャケット', '裏ジャケ', 'バックインレイ', 'backcoverurl', 'backcover');
  const obiIdx = findColIndex('帯画像url', '帯 (オビ)', '帯(オビ)', '帯', 'オビ', 'obiurl', 'obi');
  const discIdx = findColIndex('盤面画像url', '盤面 (ディスク・レーベル面)', '盤面', 'ディスク面', 'レーベル面', 'discurl', 'disc');
  const bookletIdx = findColIndex('歌詞カード・ブックレット画像url', '歌詞カード・ブックレット', '歌詞カード', 'ブックレット', '歌詞冊子', 'bookleturl', 'booklet');
  const otherSubImagesIdx = findColIndex('その他付属画像url', 'その他付属画像', '付属画像', 'サブ画像', 'othersubimagesurl', 'subimages');
  const sourceIdx = findColIndex('取得データ元', 'データ取得元', 'データ元', '取得元', 'source');
  const notesIdx = findColIndex('メモ・状態記録', 'メモ', '備考', 'notes', 'memo');
  const createdAtIdx = findColIndex('登録日時', '作成日時', 'createdat', 'created');

  const extractImageUrlsFromCell = (rawCell: string): string[] => {
    if (!rawCell) return [];
    const trimmed = rawCell.trim();
    if (!trimmed || trimmed === '[添付画像あり(端末ローカル)]' || trimmed === 'なし' || trimmed === '-') {
      return [];
    }

    // Check if JSON array of CDSubImage objects or strings
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item: any) => (typeof item === 'string' ? item : item?.imageUrl || item?.url || ''))
            .map((s: string) => String(s || '').trim())
            .filter(Boolean);
        }
      } catch {}
    }

    // Split by " || " or newline if multiple images are stored in one cell
    const parts = trimmed
      .split(/\s*\|\|\s*|\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    const extracted: string[] = [];
    for (const part of parts) {
      if (part.startsWith('data:image/')) {
        extracted.push(part);
      } else if (part.startsWith('=') && part.toUpperCase().includes('IMAGE')) {
        const urlMatch = part.match(/https?:\/\/[^\s"',)]+/);
        if (urlMatch) {
          extracted.push(urlMatch[0]);
        }
      } else {
        const urlMatch = part.match(/https?:\/\/[^\s"',)]+/);
        if (urlMatch) {
          extracted.push(urlMatch[0]);
        }
      }
    }
    return extracted;
  };

  const buildSubImagesFromRow = (getValFn: (idx: number) => string, rowIndex: number): CDSubImage[] | undefined => {
    const subs: CDSubImage[] = [];
    const seen = new Set<string>();

    const addFromCol = (colIdx: number, type: SubImageType) => {
      if (colIdx < 0) return;
      const raw = getValFn(colIdx);
      if (!raw) return;

      // Also support JSON array with explicit types in otherSubImagesIdx
      if (raw.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(raw.trim());
          if (Array.isArray(parsed)) {
            parsed.forEach((item: any, idx: number) => {
              if (!item) return;
              const imgUrl = typeof item === 'string' ? item : item.imageUrl || item.url || '';
              const itemType: SubImageType =
                item && typeof item === 'object' && ['back', 'obi', 'disc', 'booklet', 'other'].includes(item.type)
                  ? item.type
                  : type;
              const itemLabel =
                item && typeof item === 'object' && item.label
                  ? String(item.label)
                  : SUB_IMAGE_DEFAULT_LABELS[itemType];
              if (imgUrl && !seen.has(`${itemType}::${imgUrl}`)) {
                seen.add(`${itemType}::${imgUrl}`);
                subs.push({
                  id: (item && item.id) || `subimg_${itemType}_${Date.now()}_${rowIndex}_${ subs.length + idx }`,
                  type: itemType,
                  label: itemLabel,
                  imageUrl: String(imgUrl).trim(),
                });
              }
            });
            return;
          }
        } catch {}
      }

      const urls = extractImageUrlsFromCell(raw);
      urls.forEach((u, uIdx) => {
        const key = `${type}::${u}`;
        if (seen.has(key)) return;
        seen.add(key);
        subs.push({
          id: `subimg_${type}_${Date.now()}_${rowIndex}_${subs.length}_${uIdx}`,
          type,
          label: SUB_IMAGE_DEFAULT_LABELS[type],
          imageUrl: u,
        });
      });
    };

    addFromCol(backCoverIdx, 'back');
    addFromCol(obiIdx, 'obi');
    addFromCol(discIdx, 'disc');
    addFromCol(bookletIdx, 'booklet');
    addFromCol(otherSubImagesIdx, 'other');

    return subs.length > 0 ? subs : undefined;
  };

  // Parse relational Tracklist Sheet if provided
  // Key: normalized catalogNumber or lowercase albumTitle -> TrackInfo[]
  const tracksByCatNo = new Map<string, TrackInfo[]>();

  if (trackHeaders && trackRows && trackRows.length > 0) {
    const tHeaderMap: Record<string, number> = {};
    trackHeaders.forEach((h, idx) => {
      const clean = String(h || '').trim().toLowerCase();
      if (clean && tHeaderMap[clean] === undefined) {
        tHeaderMap[clean] = idx;
      }
    });

    const findTrackColIndex = (...candidates: string[]): number => {
      for (const c of candidates) {
        const lower = c.toLowerCase();
        if (tHeaderMap[lower] !== undefined) return tHeaderMap[lower];
      }
      for (const c of candidates) {
        const lower = c.toLowerCase();
        for (const [h, idx] of Object.entries(tHeaderMap)) {
          if (h.includes(lower)) return idx;
        }
      }
      return -1;
    };

    const tCatIdx = findTrackColIndex('型番（規格品番）', '型番', '規格品番', 'catalog', 'catno');
    const tNumIdx = findTrackColIndex('曲順（トラック番号）', 'トラック番号', '曲順', 'トラック', 'track');
    const tTitleIdx = findTrackColIndex('曲名（トラックタイトル）', '曲名', 'トラックタイトル', 'タイトル', 'title');
    const tDurationIdx = findTrackColIndex('演奏時間（分:秒）', '演奏時間', '再生時間', '時間', 'duration', 'time');
    const tAlbumIdx = findTrackColIndex('cdタイトル', 'アルバム名', 'アルバム', 'album');
    const tArtistIdx = findTrackColIndex('トラックアーティスト/演奏者', 'トラックアーティスト', 'アーティスト', 'artist');
    const tPreviewIdx = findTrackColIndex('試聴url', 'preview', 'url');

    trackRows.forEach((trRow) => {
      if (!trRow || trRow.length === 0) return;
      const getTVal = (idx: number) => (idx >= 0 && idx < trRow.length ? String(trRow[idx] ?? '').trim() : '');

      const catNo = normalizeCatalogNumber(getTVal(tCatIdx));
      const albumName = getTVal(tAlbumIdx).toLowerCase();
      const trackTitle = getTVal(tTitleIdx);
      if (!trackTitle && !getTVal(tNumIdx)) return;

      const trackNum = parseInt(getTVal(tNumIdx), 10) || 1;
      const duration = getTVal(tDurationIdx);
      const artist = getTVal(tArtistIdx);
      const previewUrl = getTVal(tPreviewIdx);

      const trackObj: TrackInfo = {
        trackNumber: trackNum,
        title: trackTitle || `Track ${trackNum}`,
        duration: duration || undefined,
        artist: artist || undefined,
        previewUrl: previewUrl || undefined,
      };

      if (catNo) {
        const list = tracksByCatNo.get(catNo) || [];
        list.push(trackObj);
        tracksByCatNo.set(catNo, list);
      }
      if (albumName && artist) {
        const keyByAlbumArtist = `title_artist:${albumName}::${artist.toLowerCase()}`;
        const listByAlbumArtist = tracksByCatNo.get(keyByAlbumArtist) || [];
        listByAlbumArtist.push(trackObj);
        tracksByCatNo.set(keyByAlbumArtist, listByAlbumArtist);
      }
      if (albumName && !catNo) {
        const listByAlbum = tracksByCatNo.get(`title:${albumName}`) || [];
        listByAlbum.push(trackObj);
        tracksByCatNo.set(`title:${albumName}`, listByAlbum);
      }
    });

    // Sort tracks by trackNumber for each album
    tracksByCatNo.forEach((list) => {
      list.sort((a, b) => a.trackNumber - b.trackNumber);
    });
  }

  // Check if this is a Combined 1-row-per-track format (has singleTrackTitleIdx and no separate trackRows)
  const isCombinedSingleFile = (!trackRows || trackRows.length === 0) && singleTrackTitleIdx >= 0;

  const result: CDMetadata[] = [];
  const combinedAlbumMap = new Map<string, CDMetadata>();

  rows.forEach((row, rowIdx) => {
    if (!row || row.length === 0) return;

    const getVal = (colIdx: number) => {
      if (colIdx < 0 || colIdx >= row.length) return '';
      return String(row[colIdx] ?? '').trim();
    };

    const title = getVal(titleIdx);
    const rawCatalog = getVal(catIdx);
    const catalogNumber = normalizeCatalogNumber(rawCatalog);
    const artist = getVal(artistIdx);
    const rawReleaseDate = getVal(releaseIdx);
    const releaseDate = normalizeReleaseDate(rawReleaseDate);
    const rawVinylReleaseDate = getVal(vinylReleaseIdx);
    const vinylRecordReleaseDate = normalizeReleaseDate(rawVinylReleaseDate);
    const vinylRecordFormat = getVal(vinylFormatIdx);
    const vinylRecordCatalogNumber = normalizeCatalogNumber(getVal(vinylCatIdx));

    // Skip row if it doesn't have title and doesn't have catalogNumber
    if (!title && !catalogNumber) return;

    const rawCover = getVal(coverIdx);
    // Extract image URL from =IFERROR(IMAGE("..."), "..."), =IMAGE("..."), or direct URL
    let coverUrl: string | undefined = undefined;
    if (rawCover) {
      const urlMatch = rawCover.match(/https?:\/\/[^\s"',)]+/);
      if (urlMatch) {
        coverUrl = urlMatch[0];
      } else if (rawCover.startsWith('data:image/')) {
        coverUrl = rawCover;
      }
    }

    const rawTags = getVal(tagsIdx);
    const tags = rawTags
      ? rawTags.split(/[,、，]/).map((t) => t.trim()).filter(Boolean)
      : undefined;

    const rawSource = getVal(sourceIdx).toLowerCase();
    const validSource: APISource = 
      rawSource.includes('musicbrainz') ? 'musicbrainz' :
      rawSource.includes('discogs') ? 'discogs' :
      rawSource.includes('itunes') ? 'itunes' :
      rawSource.includes('spotify') ? 'spotify' :
      rawSource.includes('rakuten') || rawSource.includes('楽天') ? 'rakuten' :
      rawSource.includes('gemini') || rawSource.includes('ai') ? 'gemini' : 'ndl';

    // Handle Combined 1-row-per-track format by grouping rows into albums
    const rowSubImages = buildSubImagesFromRow(getVal, rowIdx);

    if (isCombinedSingleFile) {
      const albumKey = catalogNumber ? `cat:${catalogNumber}` : `ta:${title.toLowerCase()}_${artist.toLowerCase()}`;
      const trTitle = getVal(singleTrackTitleIdx);
      const trNum = parseInt(getVal(singleTrackNumIdx), 10) || 1;
      const trDur = getVal(singleTrackDurationIdx);

      const existingAlbum = combinedAlbumMap.get(albumKey);
      if (existingAlbum) {
        if (!existingAlbum.vinylRecordReleaseDate && vinylRecordReleaseDate) {
          existingAlbum.vinylRecordReleaseDate = vinylRecordReleaseDate;
        }
        if (!existingAlbum.vinylRecordFormat && vinylRecordFormat) {
          existingAlbum.vinylRecordFormat = vinylRecordFormat;
        }
        if (!existingAlbum.vinylRecordCatalogNumber && vinylRecordCatalogNumber) {
          existingAlbum.vinylRecordCatalogNumber = vinylRecordCatalogNumber;
        }
        if (!existingAlbum.subImages && rowSubImages) {
          existingAlbum.subImages = rowSubImages;
        }
        if (trTitle) {
          existingAlbum.tracks.push({
            trackNumber: trNum || existingAlbum.tracks.length + 1,
            title: trTitle,
            duration: trDur || undefined,
            artist: artist || undefined,
          });
        }
        return;
      }

      const initialTracks: TrackInfo[] = [];
      if (trTitle) {
        initialTracks.push({
          trackNumber: trNum,
          title: trTitle,
          duration: trDur || undefined,
          artist: artist || undefined,
        });
      }

      const newCd: CDMetadata = {
        id: `sheet_${Date.now()}_${rowIdx}_${Math.random().toString(36).slice(2, 7)}`,
        title: title || '名称未設定',
        artist: artist || '不明なアーティスト',
        catalogNumber: catalogNumber || '',
        label: getVal(labelIdx) || undefined,
        releaseDate: releaseDate || undefined,
        vinylRecordReleaseDate: vinylRecordReleaseDate || undefined,
        vinylRecordFormat: vinylRecordFormat || undefined,
        vinylRecordCatalogNumber: vinylRecordCatalogNumber || undefined,
        barcode: getVal(barcodeIdx) || undefined,
        country: getVal(countryIdx) || undefined,
        format: getVal(formatIdx) || undefined,
        coverUrl: coverUrl || undefined,
        subImages: rowSubImages,
        tags,
        tracks: initialTracks,
        source: validSource,
        notes: getVal(notesIdx) || undefined,
        createdAt: getVal(createdAtIdx) || getJSTISOString(),
        updatedAt: getJSTISOString(),
        syncedToSheets: true,
      };

      combinedAlbumMap.set(albumKey, newCd);
      result.push(newCd);
      return;
    }

    // Standard Album Row Mode:
    // Priority 1: From relational "収録曲リスト" sheet keyed by catalogNumber or title+artist or title
    let tracks: TrackInfo[] = [];
    if (catalogNumber && tracksByCatNo.has(catalogNumber)) {
      tracks = tracksByCatNo.get(catalogNumber) || [];
    } else if (title && artist && tracksByCatNo.has(`title_artist:${title.toLowerCase()}::${artist.toLowerCase()}`)) {
      tracks = tracksByCatNo.get(`title_artist:${title.toLowerCase()}::${artist.toLowerCase()}`) || [];
    } else if (title && tracksByCatNo.has(`title:${title.toLowerCase()}`)) {
      tracks = tracksByCatNo.get(`title:${title.toLowerCase()}`) || [];
    } else if (title && tracksByCatNo.has(title.toLowerCase())) {
      tracks = tracksByCatNo.get(title.toLowerCase()) || [];
    } else {
      // Priority 2: Fallback to inline track column if present
      const rawTracks = getVal(trackIdx);
      if (rawTracks && rawTracks !== 'なし' && !rawTracks.includes('詳細は「収録曲リスト」') && !/^\d+曲$/.test(rawTracks)) {
        const trackLines = rawTracks.split('\n').map((l) => l.trim()).filter(Boolean);
        trackLines.forEach((line, tIdx) => {
          const cleaned = line.replace(/^\d+[\.\:\s]+/, '');
          const parts = cleaned.split(' - ');
          tracks.push({
            trackNumber: tIdx + 1,
            title: parts[0] || line,
            artist: parts[1] || artist || '',
          });
        });
      }
    }

    const cd: CDMetadata = {
      id: `sheet_${Date.now()}_${rowIdx}_${Math.random().toString(36).slice(2, 7)}`,
      title: title || '名称未設定',
      artist: artist || '不明なアーティスト',
      catalogNumber: catalogNumber || '',
      label: getVal(labelIdx) || undefined,
      releaseDate: releaseDate || undefined,
      vinylRecordReleaseDate: vinylRecordReleaseDate || undefined,
      vinylRecordFormat: vinylRecordFormat || undefined,
      vinylRecordCatalogNumber: vinylRecordCatalogNumber || undefined,
      barcode: getVal(barcodeIdx) || undefined,
      country: getVal(countryIdx) || undefined,
      format: getVal(formatIdx) || undefined,
      coverUrl: coverUrl || undefined,
      subImages: rowSubImages,
      tags,
      tracks,
      source: validSource,
      notes: getVal(notesIdx) || undefined,
      createdAt: getVal(createdAtIdx) || getJSTISOString(),
      updatedAt: getJSTISOString(),
      syncedToSheets: true,
    };

    result.push(cd);
  });

  return result;
}
