import { APISource, CDMetadata, SearchQuery, SearchResponse } from '../src/types/cd.js';
import { searchNDL } from './ndl.js';
import { searchMusicBrainz } from './musicbrainz.js';
import { searchDiscogs } from './discogs.js';
import { searchITunes } from './itunes.js';
import { searchSpotify } from './spotify.js';
import { searchRakutenBooks } from './rakuten.js';
import { verifyAndConsolidateWithGemini } from './geminiSearchIntegrator.js';
import { CATALOG_SOURCES, STREAMING_SOURCES, mergeCDCandidates, pickAnchorItem } from './searchMerge.js';
import { normalizeSearchQuery } from './searchUtils.js';
import { ENABLED_SOURCES } from '../src/config/sources.js';

type SourceOutcome = { source: APISource; items: CDMetadata[]; error?: string };

// 検索対象にできるソース。無効化中のソース（Spotify / 楽天ブックス）は src/config/sources.ts で管理しており、
// クライアントが指定しても無視される（コードは残してあり、ENABLED_SOURCES に追加すれば再び使える）。
const ALL_SOURCES: APISource[] = ENABLED_SOURCES;

// 1ソースが遅くても全体を待たせない。超過したソースは「結果なし(タイムアウト)」として扱う。
const SOURCE_DEADLINE_MS = 12000;

function runSource(source: APISource, q: any): Promise<SourceOutcome> {
  let p: Promise<CDMetadata[]>;
  switch (source) {
    case 'musicbrainz': p = searchMusicBrainz(q); break;
    case 'ndl': p = searchNDL(q); break;
    case 'discogs': p = searchDiscogs(q); break;
    case 'rakuten': p = searchRakutenBooks(q); break;
    case 'itunes': p = searchITunes(q); break;
    case 'spotify': p = searchSpotify(q); break;
    default: p = Promise.resolve([]);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SourceOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ source, items: [], error: `${source} の応答が${SOURCE_DEADLINE_MS / 1000}秒以内に返りませんでした` }),
      SOURCE_DEADLINE_MS
    );
  });
  const work = p
    .then((items): SourceOutcome => ({ source, items }))
    .catch((err): SourceOutcome => ({ source, items: [], error: err?.message || String(err) }));
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 有効なソース（src/config/sources.ts の ENABLED_SOURCES）を横断検索する。
 *
 * - 型番/JANだけの検索: 型番を直接引ける一次情報源 (NDL, MusicBrainz, Discogs, 楽天(JANのみ)) を先に検索し、
 *   特定できたタイトル・アーティストで配信サービス等を再検索する。
 * - それ以外: 全ソースを並列検索。
 */
export async function performAggregatedSearch(rawQuery: SearchQuery): Promise<SearchResponse> {
  const startTime = Date.now();
  const query = normalizeSearchQuery(rawQuery as any) as SearchQuery & { catno: string; barcode: string; catalogNumber: string };

  const selectedSources: APISource[] =
    Array.isArray(query.sources) && query.sources.length > 0
      ? query.sources.filter((s) => ALL_SOURCES.includes(s))
      : ALL_SOURCES;

  const isCodeFirstSearch = Boolean(
    (query.catno || query.barcode) && !query.title && !query.trackTitle
  );

  const sourceResults: SearchResponse['sourceResults'] = {};
  const allItems: CDMetadata[] = [];
  const collect = (outcomes: SourceOutcome[]) => {
    for (const o of outcomes) {
      sourceResults[o.source] = { count: o.items.length, items: o.items, error: o.error };
      allItems.push(...o.items);
    }
  };

  if (isCodeFirstSearch) {
    // Phase 1: 型番/JANを直接検索できるソース。楽天ブックスはJAN検索のみ対応なので JAN がある場合だけ。
    const phase1 = selectedSources.filter(
      (s) => ['ndl', 'musicbrainz', 'discogs'].includes(s) || (s === 'rakuten' && query.barcode)
    );
    collect(await Promise.all(phase1.map((s) => runSource(s, query))));

    // Phase 2: 特定したタイトル・アーティストで残りのソースを検索
    const phase2 = selectedSources.filter((s) => !phase1.includes(s));
    const anchor = pickAnchorItem(allItems, query.catno, query.barcode);
    if (phase2.length > 0) {
      if (anchor) {
        const enriched = {
          title: anchor.title,
          artist: anchor.artist,
          catno: query.catno,
          barcode: query.barcode,
          apiKeys: query.apiKeys, // ユーザー指定のAPIキーを引き継ぐ
        };
        collect(await Promise.all(phase2.map((s) => runSource(s, enriched))));
      } else if (query.artist || query.freeText) {
        collect(await Promise.all(phase2.map((s) => runSource(s, query))));
      } else {
        for (const s of phase2) sourceResults[s] = { count: 0, items: [], error: undefined };
      }
    }
  } else {
    // タイトル / アーティスト / 曲名 / フリーテキスト検索: 全ソース並列
    collect(await Promise.all(selectedSources.map((s) => runSource(s, query))));
  }

  // 1. 同一リリースの統合と決定的スコアリング（検索条件は正規化後のものを使用）
  const rawCandidates = mergeCDCandidates(allItems, query, { identifierOnly: isCodeFirstSearch });

  // 2. Gemini による検証（決定的な判定を上書きせず、表記の整理と要約のみ）
  const candidates = await verifyAndConsolidateWithGemini(rawCandidates, query);

  return {
    candidates,
    sourceResults,
    searchedSources: selectedSources,
    searchTimeMs: Date.now() - startTime,
  };
}

export { CATALOG_SOURCES, STREAMING_SOURCES, pickAnchorItem };
