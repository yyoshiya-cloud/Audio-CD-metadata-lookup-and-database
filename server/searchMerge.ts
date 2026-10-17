import type { APISource, CDMetadata, SearchQuery, SearchResultCandidate } from '../src/types/cd.js';
import {
  PLACEHOLDER_ARTIST,
  PLACEHOLDER_TITLE,
  artistSimilarity,
  barcodeKey,
  catnoBase,
  catnoCompatible,
  digitsOnly,
  isJapanese,
  isPlaceholder,
  isVariousArtists,
  titleSimilarity,
} from './searchUtils.js';

export const CATALOG_SOURCES: APISource[] = ['ndl', 'musicbrainz', 'discogs', 'rakuten'];
export const STREAMING_SOURCES: APISource[] = ['itunes', 'spotify'];

// フィールドごとの採用優先順位（CD実物の情報を持つ一次情報源を優先）
const TEXT_PRIORITY: APISource[] = ['rakuten', 'ndl', 'musicbrainz', 'discogs', 'itunes', 'spotify'];
const CATNO_PRIORITY: APISource[] = ['musicbrainz', 'discogs', 'ndl', 'rakuten'];
const LABEL_PRIORITY: APISource[] = ['musicbrainz', 'ndl', 'rakuten', 'discogs'];
const TRACK_PRIORITY: APISource[] = ['musicbrainz', 'itunes', 'spotify', 'ndl', 'rakuten', 'discogs'];
const COVER_PRIORITY: APISource[] = ['itunes', 'spotify', 'rakuten', 'musicbrainz', 'discogs', 'ndl'];
const BARCODE_PRIORITY: APISource[] = ['rakuten', 'musicbrainz', 'discogs', 'ndl'];
const FORMAT_PRIORITY: APISource[] = ['musicbrainz', 'rakuten', 'discogs', 'ndl'];
const DATE_PRIORITY: APISource[] = ['musicbrainz', 'rakuten', 'ndl', 'discogs'];

export type Relation = 'same' | 'different' | 'maybe';

function sortedByPriority(items: CDMetadata[], priority: APISource[]): CDMetadata[] {
  const rank = (s: APISource) => {
    const i = priority.indexOf(s);
    return i === -1 ? priority.length : i;
  };
  return [...items].sort((a, b) => rank(a.source) - rank(b.source));
}

function titleArtistRelated(a: CDMetadata, b: CDMetadata): boolean {
  const ts = titleSimilarity(a.title, b.title);
  if (ts < 0.9) return false;
  const aUnknown = isPlaceholder(a.artist);
  const bUnknown = isPlaceholder(b.artist);
  if (aUnknown || bUnknown) return ts >= 0.95; // アーティスト不明側はタイトルがほぼ完全一致のときのみ
  if (isVariousArtists(a.artist) || isVariousArtists(b.artist)) return true;
  return artistSimilarity(a.artist, b.artist) >= 0.8;
}

/**
 * 2件のレコードが同一リリースかを判定する。
 * 1. JAN一致 / 型番一致 → same
 * 2. 型番どうし・JANどうしが両方あって食い違う → different（別仕様の盤）
 * 3. 識別子がなければタイトル+アーティスト類似度で maybe / different
 */
export function relate(a: CDMetadata, b: CDMetadata): Relation {
  const bcA = barcodeKey(a.barcode);
  const bcB = barcodeKey(b.barcode);
  if (bcA && bcA === bcB) return 'same';
  const cA = catnoBase(a.catalogNumber);
  const cB = catnoBase(b.catalogNumber);
  if (cA && cA === cB) return 'same';
  if (cA && cB) return 'different';
  if (bcA && bcB) return 'different';
  return titleArtistRelated(a, b) ? 'maybe' : 'different';
}

interface Group {
  items: CDMetadata[];
}

function chooseGroup(item: CDMetadata, groups: Group[]): Group | undefined {
  let best: { group: Group; rank: number; sim: number } | undefined;
  for (const g of groups) {
    let sawSame = false;
    let sawMaybe = false;
    let sawDifferent = false;
    let simSum = 0;
    for (const m of g.items) {
      const r = relate(item, m);
      if (r === 'same') sawSame = true;
      else if (r === 'maybe') sawMaybe = true;
      else sawDifferent = true;
      simSum += titleSimilarity(item.title, m.title);
    }
    // 型番/JANが一致するメンバーがいれば、識別子を持たないメンバーとの食い違いは無視する
    if (sawDifferent && !sawSame) continue;
    if (!sawSame && !sawMaybe) continue;
    const rank = sawSame ? 2 : 1;
    const sim = simSum / g.items.length;
    if (!best || rank > best.rank || (rank === best.rank && sim > best.sim)) {
      best = { group: g, rank, sim };
    }
  }
  return best?.group;
}

function pickValue<T>(
  items: CDMetadata[],
  priority: APISource[],
  get: (i: CDMetadata) => T | undefined,
  valid: (v: T | undefined) => boolean,
  allowFallback = true
): T | undefined {
  for (const it of sortedByPriority(items, priority)) {
    if (!allowFallback && !priority.includes(it.source)) continue;
    const v = get(it);
    if (valid(v)) return v;
  }
  return undefined;
}

const nonEmpty = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : Boolean(v);

function pickPrimaryTextItem(items: CDMetadata[]): CDMetadata | undefined {
  const usable = items.filter((i) => !isPlaceholder(i.title));
  if (usable.length === 0) return undefined;
  const sorted = sortedByPriority(usable, TEXT_PRIORITY);
  // 日本語タイトルを持つ項目があれば、その中で優先順位が最上位のもの
  return sorted.find((i) => isJapanese(i.title)) || sorted[0];
}

function pickReleaseDate(items: CDMetadata[]): string {
  const withDate = items.filter((i) => nonEmpty(i.releaseDate));
  const catalog = sortedByPriority(
    withDate.filter((i) => !STREAMING_SOURCES.includes(i.source)),
    DATE_PRIORITY
  );
  const pool = catalog.length > 0 ? catalog : sortedByPriority(withDate, TEXT_PRIORITY);
  if (pool.length === 0) return '';
  // 年のみより年月日のほうが情報量が多いので、最も詳細な日付を採用（同点は優先順位順）
  let best = pool[0];
  for (const it of pool) {
    if ((it.releaseDate || '').length > (best.releaseDate || '').length) best = it;
  }
  return best.releaseDate || '';
}

export interface MergeOptions {
  /** 型番/JANのみで検索した場合（タイトル等の指定なし） */
  identifierOnly?: boolean;
}

/**
 * 複数ソースの結果を同一リリースごとに統合し、検索条件との一致度でスコアリングする。
 * 外部APIに依存しない純粋関数。
 */
export function mergeCDCandidates(
  items: CDMetadata[],
  query: SearchQuery,
  options: MergeOptions = {}
): SearchResultCandidate[] {
  if (items.length === 0) return [];

  const targetCatBase = catnoBase(query.catalogNumber || (query as any).catno);
  const targetBarcodeKey = barcodeKey(query.barcode);

  // --- 1. 検索した型番/JANと明確に食い違う候補は除外 -----------------------
  const filtered = items.filter((item) => {
    if (targetCatBase && !catnoCompatible(item.catalogNumber, targetCatBase)) return false;
    if (targetBarcodeKey) {
      const ib = barcodeKey(item.barcode);
      if (ib && ib !== targetBarcodeKey) {
        // 型番が一致しているなら JAN 違いの併売盤として残す
        const catSame = targetCatBase && catnoBase(item.catalogNumber) === targetCatBase;
        if (!catSame) return false;
      }
    }
    return true;
  });

  // --- 2. 同一リリースをグルーピング ---------------------------------------
  const groups: Group[] = [];
  for (const item of filtered) {
    const g = chooseGroup(item, groups);
    if (g) g.items.push(item);
    else groups.push({ items: [item] });
  }

  // --- 3. グループごとに統合 + スコアリング -------------------------------
  const candidates: SearchResultCandidate[] = groups.map(({ items: groupItems }) =>
    consolidateGroup(groupItems, query, targetCatBase, targetBarcodeKey)
  );

  // 型番/JANのみ検索で一致グループが存在する場合、一次情報源を含まず一致もしない
  // 配信サービス由来の無関係な候補（同アーティストの別アルバム等）は除外する
  let result = candidates;
  if (options.identifierOnly && (targetCatBase || targetBarcodeKey)) {
    const hasIdMatch = candidates.some((c) => c.exactMatchTypes?.some((t) => t === 'catalogNumber' || t === 'barcode'));
    if (hasIdMatch) {
      result = candidates.filter((c) => {
        const idMatch = c.exactMatchTypes?.some((t) => t === 'catalogNumber' || t === 'barcode');
        const hasCatalog = c.sourcesMatched.some((s) => CATALOG_SOURCES.includes(s));
        return idMatch || hasCatalog;
      });
    }
  }

  result.sort((a, b) => {
    if (a.isExactMatch && !b.isExactMatch) return -1;
    if (!a.isExactMatch && b.isExactMatch) return 1;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return b.sourcesMatched.length - a.sourcesMatched.length;
  });

  return result;
}

function bestTrackSimilarity(item: CDMetadata[], trackQuery: string): number {
  let best = 0;
  for (const it of item) {
    best = Math.max(best, titleSimilarity(it.title, trackQuery));
    for (const tr of it.tracks || []) {
      best = Math.max(best, titleSimilarity(tr.title, trackQuery));
      if (best === 1) return 1;
    }
  }
  return best;
}

function consolidateGroup(
  groupItems: CDMetadata[],
  query: SearchQuery,
  targetCatBase: string,
  targetBarcodeKey: string
): SearchResultCandidate {
  const sourcesMatched = Array.from(new Set(groupItems.map((i) => i.source)));

  // タイトル・アーティストは同一レコードから採用（別ソースの組み合わせによる不整合を防ぐ）
  const primary = pickPrimaryTextItem(groupItems);
  const title = primary?.title || PLACEHOLDER_TITLE;
  let artist = primary && !isPlaceholder(primary.artist) ? primary.artist : '';
  if (!artist) {
    artist =
      pickValue(groupItems, TEXT_PRIORITY, (i) => i.artist, (v) => !isPlaceholder(v as string)) || PLACEHOLDER_ARTIST;
  }

  const coverUrl = pickValue(groupItems, COVER_PRIORITY, (i) => i.coverUrl, nonEmpty) || '';

  const reportedCat =
    pickValue(groupItems, CATNO_PRIORITY, (i) => i.catalogNumber, nonEmpty, false) ||
    pickValue(groupItems, CATNO_PRIORITY, (i) => i.catalogNumber, nonEmpty) ||
    '';
  // 表示・保存用: ソースが型番を返さなかった場合のみ、検索した型番を補う（照合には使わない）
  const catalogNumber = (reportedCat || query.catalogNumber || '').toString().trim().toUpperCase();

  const barcodeRaw = pickValue(groupItems, BARCODE_PRIORITY, (i) => i.barcode, (v) => Boolean(barcodeKey(v as string)));
  const barcode = barcodeRaw ? digitsOnly(barcodeRaw) : '';

  const tracks = pickValue(groupItems, TRACK_PRIORITY, (i) => i.tracks, (v) => Array.isArray(v) && v.length > 0) || [];
  // 配信サービスの copyright 表記はレーベル名ではないため採用しない
  const label =
    pickValue(groupItems, LABEL_PRIORITY, (i) => i.label, nonEmpty, false) || '';
  const releaseDate = pickReleaseDate(groupItems);
  const format = pickValue(groupItems, FORMAT_PRIORITY, (i) => i.format, nonEmpty, false) || 'CD';
  const genre = pickValue(groupItems, ['itunes', 'spotify', 'discogs'], (i) => i.genre, nonEmpty) || '';

  const rawSources: CDMetadata['rawSources'] = {};
  groupItems.forEach((gi) => {
    rawSources[gi.source] = {
      title: gi.title,
      artist: gi.artist,
      catalogNumber: gi.catalogNumber,
      releaseDate: gi.releaseDate,
      label: gi.label,
      coverUrl: gi.coverUrl,
      trackCount: gi.tracks ? gi.tracks.length : 0,
    };
  });

  // ---- 一致判定（ソースが実際に返した値のみを根拠にする）-----------------
  const catMatch = Boolean(targetCatBase && groupItems.some((i) => catnoBase(i.catalogNumber) === targetCatBase));
  const barcodeMatch = Boolean(targetBarcodeKey && groupItems.some((i) => barcodeKey(i.barcode) === targetBarcodeKey));

  const titleQ = query.title || '';
  const artistQ = query.artist || '';
  const trackQ = query.trackTitle || '';
  const freeQ = query.freeText || '';

  const titleSim = titleQ ? Math.max(...groupItems.map((i) => titleSimilarity(i.title, titleQ))) : 0;
  const artistSim = artistQ ? Math.max(...groupItems.map((i) => artistSimilarity(i.artist, artistQ))) : 0;
  const trackSim = trackQ ? bestTrackSimilarity(groupItems, trackQ) : 0;
  const freeSim = freeQ
    ? Math.max(
        ...groupItems.map((i) =>
          Math.max(
            titleSimilarity(i.title, freeQ),
            titleSimilarity(`${i.artist} ${i.title}`, freeQ),
            titleSimilarity(`${i.title} ${i.artist}`, freeQ),
            artistSimilarity(i.artist, freeQ)
          )
        )
      )
    : 0;

  const artistOk = !artistQ || artistSim >= 0.8;
  const titleMatch = Boolean(titleQ && titleSim >= 0.99 && artistOk);
  const trackMatch = Boolean(trackQ && trackSim >= 0.95 && artistOk);

  const exactMatchTypes: ('catalogNumber' | 'title' | 'barcode')[] = [];
  if (catMatch) exactMatchTypes.push('catalogNumber');
  if (titleMatch || trackMatch) exactMatchTypes.push('title');
  if (barcodeMatch) exactMatchTypes.push('barcode');
  const isExactMatch = exactMatchTypes.length > 0;

  // ---- スコア (0-100) ---------------------------------------------------
  const weighted: { sim: number; w: number }[] = [];
  if (titleQ) weighted.push({ sim: titleSim, w: 1 });
  if (artistQ) weighted.push({ sim: artistSim, w: 0.8 });
  if (trackQ) weighted.push({ sim: trackSim, w: 1 });
  if (freeQ) weighted.push({ sim: freeSim, w: 1 });
  const relevance =
    weighted.length > 0
      ? weighted.reduce((s, x) => s + x.sim * x.w, 0) / weighted.reduce((s, x) => s + x.w, 0)
      : 0.5;

  let score = 35 + 55 * relevance;
  score += Math.min(8, (sourcesMatched.length - 1) * 4); // 複数ソースで裏付けられるほど加点
  if (tracks.length > 0) score += 2;
  if (coverUrl) score += 2;

  if (barcodeMatch) {
    score = 100;
  } else if (catMatch) {
    const titleConflict = Boolean(titleQ) && titleSim < 0.4;
    score = titleConflict ? 90 : titleQ ? (titleSim >= 0.8 ? 100 : 96) : 96;
  } else {
    if (titleMatch || trackMatch) score = Math.max(score, 90);
    score = Math.min(score, 99);
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  const now = new Date().toISOString();
  const primarySource =
    sortedByPriority(groupItems, [...CATALOG_SOURCES, ...STREAMING_SOURCES])[0]?.source || groupItems[0].source;

  const cd: CDMetadata = {
    id: `cd-${catalogNumber || 'unk'}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    catalogNumber,
    title,
    artist,
    label,
    releaseDate,
    barcode,
    coverUrl,
    country: 'JP',
    format,
    genre,
    tracks,
    source: primarySource,
    rawSources,
    confidenceScore: score,
    isExactMatch,
    exactMatchTypes,
    createdAt: now,
    updatedAt: now,
  };

  return { cd, sourcesMatched, matchScore: score, isExactMatch, exactMatchTypes };
}

/**
 * 型番/JANで検索した結果から、再検索（配信サービス等）の手がかりにする「基準レコード」を選ぶ。
 * 検索した型番・JANと一致するレコードを優先し、なければタイトル・アーティストが揃った最初のレコード。
 */
export function pickAnchorItem(items: CDMetadata[], catno: string, barcode: string): CDMetadata | undefined {
  const usable = items.filter((i) => !isPlaceholder(i.title) && !isPlaceholder(i.artist));
  const catBase = catnoBase(catno);
  const bcKey = barcodeKey(barcode);
  return (
    usable.find(
      (i) => (bcKey && barcodeKey(i.barcode) === bcKey) || (catBase && catnoBase(i.catalogNumber) === catBase)
    ) || usable[0]
  );
}
