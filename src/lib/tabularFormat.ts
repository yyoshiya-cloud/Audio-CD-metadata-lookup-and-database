/**
 * 表形式（Excel / CSV / JSON 取り込み・書き出し）の共通ヘルパー。
 * 列定義、行への整形、行からCDへの解析を提供する。
 * （以前は googleSheets.ts にあった。Googleスプレッドシート連携の廃止に伴い、API通信部分を除いて独立させた）
 */
import { CDMetadata, ExportColumnConfig, APISource, TrackInfo, CDSubImage, SubImageType } from '../types/cd';
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

const MAX_CELL_CHARACTERS = 30000;

/**
 * Excel (.xlsx) 書き出し用にセルの値を整える:
 * 1. 数式インジェクション対策（先頭が = + - @ タブ 改行 のセルは ' を付ける）
 * 2. 1セル45,000文字の上限を守る
 */
function sanitizeCellValue(val: any): any {
  if (typeof val === 'string') {
    let processed = val;
    if (/^[\s]*[=+\-@\t\r]/.test(processed)) {
      processed = `'${processed}`;
    }
    if (processed.length > MAX_CELL_CHARACTERS) {
      return processed.slice(0, MAX_CELL_CHARACTERS) + '... (※セル文字数制限50,000字のため省略)';
    }
    return processed;
  }
  return val;
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

export const SUB_IMAGE_DEFAULT_LABELS: Record<SubImageType, string> = {
  back: '裏ジャケット (バックインレイ)',
  obi: '帯 (オビ)',
  disc: '盤面 (ディスク・レーベル面)',
  booklet: '歌詞カード・ブックレット',
  other: 'その他付属画像',
};

export function getSerializedSubImagesByType(cd: CDMetadata, type: SubImageType): string {
  const subs = (cd.subImages || []).filter((s) => s && s.type === type && s.imageUrl && s.imageUrl.trim());
  return subs.map((s) => s.imageUrl.trim()).join(' || ');
}

/**
 * Format CD metadata item into export row based on column config for Album Master Sheet
 */
export function formatCDToRowValues(
  cd: CDMetadata,
  columns: ExportColumnConfig[]
): any[] {
  const activeCols = columns.filter((c) => c.enabled);

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
      cellValue = cd.coverUrl || '';
    } else if (
      col.key === 'backCoverUrl' ||
      col.key === 'obiUrl' ||
      col.key === 'discUrl' ||
      col.key === 'bookletUrl' ||
      col.key === 'otherSubImagesUrl'
    ) {
      const subType = SUB_IMAGE_TYPE_MAP[col.key];
      cellValue = getSerializedSubImagesByType(cd, subType);
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
    };

    result.push(cd);
  });

  return result;
}

