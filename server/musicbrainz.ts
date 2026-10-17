import { CDMetadata, TrackInfo } from '../src/types/cd.js';
import { catnoBase, catnoVariants, digitsOnly, luceneQuote } from './searchUtils.js';

const MB_BASE = 'https://musicbrainz.org/ws/2';

// トラックリスト取得は1件あたり1秒以上かかる(レート制限)ため、上位のみに絞る
const MB_TRACKLIST_LIMIT = 3;

// MusicBrainz は 1リクエスト/秒 (IP単位) の制限があるため、全リクエストを直列化して間隔を空ける
const MB_MIN_INTERVAL_MS = 1100;
let mbQueue: Promise<unknown> = Promise.resolve();
let mbLastRequestAt = 0;

function userAgent(contact?: string): string {
  // MusicBrainz は連絡先入りの User-Agent を要求する。設定画面のメール / MB_CONTACT / APP_URL の順に使用。
  const c =
    contact?.trim() ||
    process.env.MB_CONTACT ||
    process.env.APP_URL ||
    'https://github.com/yyoshiya-cloud/Audio-CD-metadata-lookup-and-database';
  return `CDMetadataLookup/1.1 (${c})`;
}

async function mbFetchJson(url: string, contact?: string, timeoutMs = 10000): Promise<any | null> {
  const run = async () => {
    const wait = mbLastRequestAt + MB_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLastRequestAt = Date.now();

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': userAgent(contact), Accept: 'application/json' },
        });
        if (res.status === 503 && attempt === 0) {
          // レート制限: 少し待って1回だけ再試行
          await new Promise((r) => setTimeout(r, 1500));
          mbLastRequestAt = Date.now();
          continue;
        }
        if (!res.ok) {
          console.warn(`MusicBrainz API returned status ${res.status}`);
          return null;
        }
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  };
  // 失敗しても後続リクエストが詰まらないよう catch を挟んで連結
  const result = mbQueue.then(run, run);
  mbQueue = result.catch(() => undefined);
  return result;
}

function formatDuration(lengthMs?: number): string {
  if (!lengthMs) return '';
  const totalSec = Math.floor(lengthMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function artistCreditName(credit: any[] | undefined, fallback = 'Unknown Artist'): string {
  if (!credit || credit.length === 0) return fallback;
  // joinphrase を考慮して "A feat. B" のような表記を再現
  const s = credit
    .map((ac: any) => `${ac.name || ac.artist?.name || ''}${ac.joinphrase || ''}`)
    .join('')
    .trim();
  return s || fallback;
}

/**
 * label-info が複数ある場合、検索した型番に一致するエントリを優先して採用する。
 */
export function pickLabelInfo(
  labelInfo: any[] | undefined,
  targetCatno?: string
): { label: string; catalogNumber: string } {
  if (!labelInfo || labelInfo.length === 0) return { label: '', catalogNumber: '' };
  const target = targetCatno ? catnoBase(targetCatno) : '';
  const matched = target
    ? labelInfo.find((li) => li?.['catalog-number'] && catnoBase(li['catalog-number']) === target)
    : undefined;
  const info = matched || labelInfo.find((li) => li?.['catalog-number']) || labelInfo[0];
  return {
    label: info?.label?.name || '',
    catalogNumber: info?.['catalog-number'] || '',
  };
}

function mapRelease(
  rel: any,
  tracks: TrackInfo[],
  fallbackArtist: string,
  targetCatno?: string,
  hasFrontCover?: boolean
): CDMetadata {
  const mbid = rel.id;
  const { label, catalogNumber } = pickLabelInfo(rel['label-info'], targetCatno);
  const now = new Date().toISOString();
  return {
    id: `mb-${mbid}`,
    // 型番・JANは MusicBrainz が返した値のみ（検索条件で補完しない）
    catalogNumber,
    title: rel.title || 'Unknown Title',
    artist: artistCreditName(rel['artist-credit'], fallbackArtist),
    label,
    releaseDate: rel.date || '',
    barcode: rel.barcode || '',
    country: rel.country || 'JP',
    format: rel.media?.[0]?.format || 'CD',
    // Cover Art Archive に表紙が無いと分かっている場合はURLを返さない（不明な場合のみURLを付ける）
    coverUrl: hasFrontCover === false ? '' : `https://coverartarchive.org/release/${mbid}/front-500`,
    tracks,
    source: 'musicbrainz',
    sourceDetails: { musicbrainzId: mbid },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Lucene クエリを組み立てる（検索条件に応じた複数の段階的クエリ）。
 * 先頭ほど厳密で、結果が0件のときだけ次の緩いクエリを試す。
 */
export function buildReleaseQueries(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
}): string[] {
  const cleanBarcode = digitsOnly(query.barcode);
  if (cleanBarcode) {
    return [`barcode:${cleanBarcode}`];
  }
  if (query.catno && query.catno.trim()) {
    const variants = catnoVariants(query.catno);
    return [variants.map((v) => `catno:${luceneQuote(v)}`).join(' OR ')];
  }
  if (query.title || query.artist || query.trackTitle) {
    const strict: string[] = [];
    if (query.title) strict.push(`release:${luceneQuote(query.title.trim())}`);
    if (query.artist) strict.push(`artist:${luceneQuote(query.artist.trim())}`);
    if (query.trackTitle && !query.title) strict.push(luceneQuote(query.trackTitle.trim()));
    const queries = [strict.join(' AND ')];
    // 緩和: タイトルだけで再検索（アーティストの表記揺れ・ローマ字/日本語差を吸収）
    if (query.title && query.artist) {
      queries.push(`release:${luceneQuote(query.title.trim())}`);
    }
    return queries;
  }
  if (query.freeText) {
    return [luceneQuote(query.freeText.trim())];
  }
  return [];
}

/**
 * Search MusicBrainz API
 */
export async function searchMusicBrainz(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
  apiKeys?: { musicbrainzEmail?: string };
}): Promise<CDMetadata[]> {
  const contact = query.apiKeys?.musicbrainzEmail;
  try {
    const isTrackOnlyOrArtistTrackSearch = Boolean(
      query.trackTitle && query.trackTitle.trim() && !query.catno && !query.barcode && !query.title
    );

    if (isTrackOnlyOrArtistTrackSearch) {
      const recParts: string[] = [`recording:${luceneQuote(query.trackTitle!.trim())}`];
      if (query.artist && query.artist.trim()) {
        recParts.push(`artist:${luceneQuote(query.artist.trim())}`);
      }
      const recUrl = `${MB_BASE}/recording?query=${encodeURIComponent(recParts.join(' AND '))}&fmt=json&limit=10`;
      const recData = await mbFetchJson(recUrl, contact);
      const recordings = recData?.recordings || [];
      const seenReleaseIds = new Set<string>();
      const results: CDMetadata[] = [];

      for (const rec of recordings) {
        const recArtist = artistCreditName(rec['artist-credit'], query.artist || 'Unknown Artist');
        for (const rel of rec.releases || []) {
          const mbid = rel.id;
          if (!mbid || seenReleaseIds.has(mbid)) continue;
          seenReleaseIds.add(mbid);

          let tracks: TrackInfo[] = [];
          let hasFront: boolean | undefined;
          if (results.length < MB_TRACKLIST_LIMIT) {
            const detail = await fetchMBRelease(mbid, contact);
            tracks = detail.tracks;
            hasFront = detail.hasFront;
          }
          if (tracks.length === 0 && rec.title) {
            tracks = [{ trackNumber: 1, title: rec.title, artist: recArtist, duration: formatDuration(rec.length) }];
          }
          results.push(mapRelease(rel, tracks, recArtist, undefined, hasFront));
          if (results.length >= 8) break;
        }
        if (results.length >= 8) break;
      }
      if (results.length > 0) return results;
    }

    const lucenes = buildReleaseQueries(query);
    if (lucenes.length === 0) return [];

    let releases: any[] = [];
    for (const lq of lucenes) {
      const url = `${MB_BASE}/release?query=${encodeURIComponent(lq)}&fmt=json&limit=8`;
      const data = await mbFetchJson(url, contact);
      releases = data?.releases || [];
      if (releases.length > 0) break;
    }

    const results: CDMetadata[] = [];
    for (const rel of releases) {
      // 上位のみトラックリストを取得（直列・1req/s制限あり）。同じ取得でジャケットの有無も分かる
      let tracks: TrackInfo[] = [];
      let hasFront: boolean | undefined;
      if (results.length < MB_TRACKLIST_LIMIT) {
        const detail = await fetchMBRelease(rel.id, contact);
        tracks = detail.tracks;
        hasFront = detail.hasFront;
      }
      results.push(mapRelease(rel, tracks, 'Unknown Artist', query.catno, hasFront));
    }
    return results;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.warn('MusicBrainz API fetch timed out (10s limit)');
    } else {
      console.error('Error fetching MusicBrainz API:', err?.message || err);
    }
    return [];
  }
}

/**
 * MusicBrainz のリリース詳細からトラックリストと表紙画像の有無を取得する。
 * hasFront は `cover-art-archive` が応答に含まれる場合のみ値が入る（不明なら undefined）。
 */
async function fetchMBRelease(
  mbid: string,
  contact?: string
): Promise<{ tracks: TrackInfo[]; hasFront?: boolean }> {
  try {
    const data = await mbFetchJson(`${MB_BASE}/release/${mbid}?inc=recordings+media&fmt=json`, contact);
    if (!data) return { tracks: [] };
    const tracks: TrackInfo[] = [];
    let trackCounter = 1;
    for (const media of data.media || []) {
      for (const tr of media.tracks || []) {
        tracks.push({
          trackNumber: trackCounter,
          title: tr.title || tr.recording?.title || `Track ${trackCounter}`,
          duration: formatDuration(tr.length || tr.recording?.length),
        });
        trackCounter++;
      }
    }
    const caa = data['cover-art-archive'];
    const hasFront = caa && typeof caa.front === 'boolean' ? caa.front : undefined;
    return { tracks, hasFront };
  } catch {
    return { tracks: [] };
  }
}
