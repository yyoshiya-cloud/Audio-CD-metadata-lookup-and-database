import { CDMetadata } from '../src/types/cd.js';
import { catnoVariants, digitsOnly, isValidBarcodeLength } from './searchUtils.js';

/** Discogs はアーティスト名の同名区別に "(2)" のような接尾辞を付ける */
export function cleanDiscogsArtist(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, '').trim();
}

/**
 * Discogs の barcode 配列にはマトリクス番号等も混在するため、
 * JAN/EAN/UPC として妥当な桁数の数字列だけを採用する。
 */
export function pickDiscogsBarcode(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const b of list) {
    const s = String(b);
    // 数字・スペース・ハイフンだけで構成されるものに限定（"SRCL 1234 A1" のような文字列を除外）
    if (!/^[\d\s-]+$/.test(s)) continue;
    const d = digitsOnly(s);
    if (isValidBarcodeLength(d)) return d;
  }
  return '';
}

/** "SRCL-1234, SRCL-1235" のように複数入る catno は先頭を採用 */
export function pickDiscogsCatno(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const first = raw.split(',')[0].trim();
  // "none" は Discogs で型番なしを意味する
  return first.toLowerCase() === 'none' ? '' : first;
}

export async function searchDiscogs(query: {
  catno?: string;
  catalogNumber?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
  apiKeys?: { discogsToken?: string; discogsKey?: string; discogsSecret?: string };
}): Promise<CDMetadata[]> {
  const catno = query.catno || query.catalogNumber;

  const headers: Record<string, string> = {
    'User-Agent': 'CDMetadataManager/1.1 (+https://github.com/yyoshiya-cloud/Audio-CD-metadata-lookup-and-database)',
    Accept: 'application/json',
  };

  // 認証情報は Authorization ヘッダーのみで送る（URLに含めるとアクセスログに残るため）
  const rawToken = query.apiKeys?.discogsToken?.trim();
  if (rawToken) {
    if (rawToken.includes(':') && !rawToken.startsWith('http')) {
      const [key, secret] = rawToken.split(':');
      headers['Authorization'] = `Discogs key=${key.trim()}, secret=${secret.trim()}`;
    } else if (rawToken.includes('key=') || rawToken.includes('secret=')) {
      headers['Authorization'] = `Discogs ${rawToken}`;
    } else {
      headers['Authorization'] = `Discogs token=${rawToken}`;
    }
  }

  const cleanBarcode = digitsOnly(query.barcode);

  // 検索パラメータの候補を厳密な順に作り、0件のときだけ次を試す
  const attempts: Record<string, string>[] = [];
  if (catno) {
    for (const v of catnoVariants(catno).slice(0, 2)) attempts.push({ catno: v });
  } else if (cleanBarcode) {
    attempts.push({ barcode: cleanBarcode });
  } else if (query.title || query.artist || query.trackTitle) {
    const strict: Record<string, string> = {};
    if (query.artist) strict.artist = query.artist.trim();
    if (query.title) strict.release_title = query.title.trim();
    if (query.trackTitle) strict.track = query.trackTitle.trim();
    attempts.push(strict);
    // 緩和: フィールド指定が厳しすぎる場合は q による全文検索にフォールバック
    const q = [query.artist, query.title, query.trackTitle].filter(Boolean).join(' ');
    if (q) attempts.push({ q });
  } else if (query.freeText) {
    attempts.push({ q: query.freeText.trim() });
  }

  for (const extra of attempts) {
    const params = new URLSearchParams({ type: 'release', per_page: '8', ...extra });
    const results = await fetchDiscogsPage(`https://api.discogs.com/database/search?${params.toString()}`, headers);
    if (results.length > 0) return results.map(mapDiscogsResult);
  }
  return [];
}

async function fetchDiscogsPage(url: string, headers: Record<string, string>): Promise<any[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, headers });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Discogs APIへの接続がタイムアウトしました (10秒)');
    }
    throw new Error(`Discogs API接続失敗: ${err.message || err}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let errorDetail = '';
    try {
      const errJson = await res.json();
      errorDetail = errJson.message || '';
    } catch {
      // ignore
    }

    if (res.status === 401) {
      throw new Error(`Discogs認証エラー(401): トークンが無効です。${errorDetail ? ` (${errorDetail})` : ''}`);
    } else if (res.status === 429) {
      throw new Error('Discogsリクエスト制限エラー(429): レートリミットに達しました。しばらく待ってから再試行してください。');
    }
    throw new Error(`Discogs API通信エラー (HTTP ${res.status}${errorDetail ? `: ${errorDetail}` : ''})`);
  }

  const data = await res.json();
  return data.results || [];
}

export function mapDiscogsResult(r: any): CDMetadata {
  // Discogs の title は通常 "Artist - Album Title"
  let artist = 'Unknown Artist';
  let title = r.title || 'Unknown Title';
  if (r.title && r.title.includes(' - ')) {
    const parts = r.title.split(' - ');
    artist = cleanDiscogsArtist(parts[0]);
    title = parts.slice(1).join(' - ').trim();
  }

  const now = new Date().toISOString();
  return {
    id: `discogs-${r.id}`,
    // 型番は Discogs が返した値のみ（検索条件で補完しない）
    catalogNumber: pickDiscogsCatno(r.catno),
    title,
    artist,
    label: Array.isArray(r.label) ? r.label[0] : r.label || '',
    releaseDate: r.year ? String(r.year) : '',
    barcode: pickDiscogsBarcode(r.barcode),
    country: r.country || '',
    format: Array.isArray(r.format) ? r.format.join(', ') : r.format || 'CD',
    coverUrl: r.cover_image || r.thumb || '',
    tracks: [],
    source: 'discogs',
    sourceDetails: { discogsId: String(r.id) },
    createdAt: now,
    updatedAt: now,
  };
}
