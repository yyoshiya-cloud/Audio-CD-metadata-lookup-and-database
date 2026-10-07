import { APISource, CDMetadata, SearchQuery, SearchResponse, SearchResultCandidate } from '../src/types/cd.js';
import { searchNDL } from './ndl.js';
import { searchMusicBrainz } from './musicbrainz.js';
import { searchDiscogs } from './discogs.js';
import { searchITunes } from './itunes.js';
import { searchSpotify } from './spotify.js';
import { searchRakutenBooks } from './rakuten.js';
import { verifyAndConsolidateWithGemini } from './geminiSearchIntegrator.js';

/**
 * Perform multi-source cross search across MusicBrainz, Discogs, iTunes, NDL, Spotify, and Rakuten Books
 */
export async function performAggregatedSearch(query: SearchQuery): Promise<SearchResponse> {
  const startTime = Date.now();
  const allowedSources: APISource[] = ['musicbrainz', 'discogs', 'itunes', 'ndl', 'spotify', 'rakuten'];
  const selectedSources: APISource[] = query.sources && query.sources.length > 0
    ? query.sources.filter((s) => allowedSources.includes(s))
    : allowedSources;

  const rawCat = query.catalogNumber || (query as any).catno || '';
  const rawBarcode = query.barcode ? query.barcode.replace(/\D/g, '') : '';
  const normalizedQuery = {
    ...query,
    catno: rawCat.trim(),
    barcode: rawBarcode,
  };

  const isCodeFirstSearch = Boolean(
    (normalizedQuery.catno || normalizedQuery.barcode) &&
    !normalizedQuery.title &&
    !normalizedQuery.trackTitle
  );

  const sourceResults: SearchResponse['sourceResults'] = {};
  const allItems: CDMetadata[] = [];

  // Phase 1: Search CD catalog databases that support catalog numbers & barcodes
  const catalogSources = selectedSources.filter((s) => ['ndl', 'musicbrainz', 'discogs', 'rakuten'].includes(s));
  const primaryPromises: Promise<{ source: APISource; items: CDMetadata[]; error?: string }>[] = catalogSources.map((source) => {
    let p: Promise<CDMetadata[]>;
    if (source === 'musicbrainz') p = searchMusicBrainz(normalizedQuery);
    else if (source === 'ndl') p = searchNDL(normalizedQuery);
    else if (source === 'discogs') p = searchDiscogs(normalizedQuery);
    else p = searchRakutenBooks(normalizedQuery);

    return p
      .then((items): { source: APISource; items: CDMetadata[]; error?: string } => ({ source, items }))
      .catch((err): { source: APISource; items: CDMetadata[]; error?: string } => ({ source, items: [], error: err.message }));
  });

  // Digital streaming APIs (iTunes, Spotify)
  const streamingSources = selectedSources.filter((s) => ['itunes', 'spotify'].includes(s));

  if (isCodeFirstSearch) {
    // For catalog-number or barcode-first searches: Wait for CD databases first to discover exact title and artist
    const catalogResults = await Promise.all(primaryPromises);
    for (const cr of catalogResults) {
      sourceResults[cr.source] = { count: cr.items.length, items: cr.items, error: cr.error };
      allItems.push(...cr.items);
    }

    // Find the most confident title and artist from official CD catalogs
    const bestFound = allItems.find((i) => i.title && i.title !== 'Unknown Title' && i.artist && i.artist !== 'Unknown Artist');

    if (bestFound && streamingSources.length > 0) {
      // Query iTunes & Spotify using discovered real title and artist (NOT raw catalog number/barcode!)
      const enrichedQuery = {
        title: bestFound.title,
        artist: bestFound.artist,
        catno: normalizedQuery.catno,
        barcode: normalizedQuery.barcode,
      };

      const streamingPromises: Promise<{ source: APISource; items: CDMetadata[]; error?: string }>[] = streamingSources.map((source) => {
        const p = source === 'itunes' ? searchITunes(enrichedQuery) : searchSpotify(enrichedQuery);
        return p
          .then((items): { source: APISource; items: CDMetadata[]; error?: string } => ({ source, items }))
          .catch((err): { source: APISource; items: CDMetadata[]; error?: string } => ({ source, items: [], error: err.message }));
      });

      const streamingResults = await Promise.all(streamingPromises);
      for (const sr of streamingResults) {
        sourceResults[sr.source] = { count: sr.items.length, items: sr.items, error: sr.error };
        allItems.push(...sr.items);
      }
    } else {
      // Fallback to searching streaming sources directly if query has artist or title
      if (normalizedQuery.artist || normalizedQuery.title || normalizedQuery.freeText) {
        const streamingPromises: Promise<{ source: APISource; items: CDMetadata[]; error?: string }>[] = streamingSources.map((source) => {
          const p = source === 'itunes' ? searchITunes(normalizedQuery) : searchSpotify(normalizedQuery);
          return p
            .then((items): { source: APISource; items: CDMetadata[]; error?: string } => ({ source, items }))
            .catch((err): { source: APISource; items: CDMetadata[]; error?: string } => ({ source, items: [], error: err.message }));
        });
        const streamingResults = await Promise.all(streamingPromises);
        for (const sr of streamingResults) {
          sourceResults[sr.source] = { count: sr.items.length, items: sr.items, error: sr.error };
          allItems.push(...sr.items);
        }
      } else {
        for (const s of streamingSources) {
          sourceResults[s] = { count: 0, items: [], error: undefined };
        }
      }
    }
  } else {
    // Normal keyword / title / artist search: execute all simultaneously
    const streamingPromises: Promise<{ source: APISource; items: CDMetadata[]; error?: string }>[] = streamingSources.map((source) => {
      const p = source === 'itunes' ? searchITunes(normalizedQuery) : searchSpotify(normalizedQuery);
      return p
        .then((items): { source: APISource; items: CDMetadata[]; error?: string } => ({ source, items }))
        .catch((err): { source: APISource; items: CDMetadata[]; error?: string } => ({ source, items: [], error: err.message }));
    });

    const allResults = await Promise.all([...primaryPromises, ...streamingPromises]);
    for (const r of allResults) {
      sourceResults[r.source] = { count: r.items.length, items: r.items, error: r.error };
      allItems.push(...r.items);
    }
  }

  // 1. Merge and group candidate records with deterministic deduplication prioritizing exact title & catalog number
  const rawCandidates = mergeCDCandidates(allItems, query);

  // 2. Gemini API multi-source consolidation and verification
  const candidates = await verifyAndConsolidateWithGemini(rawCandidates, query);

  return {
    candidates,
    sourceResults,
    searchedSources: selectedSources,
    searchTimeMs: Date.now() - startTime,
  };
}

/**
 * Merge CD items from different sources that refer to the same CD
 */
function mergeCDCandidates(items: CDMetadata[], query: SearchQuery): SearchResultCandidate[] {
  if (items.length === 0) return [];

  const targetCatNo = normalizeCatNo(query.catalogNumber || (query as any).catno);

  // Group items intelligently:
  // 1. First, items with catalog numbers get their own bucket
  // 2. Second, streaming items (iTunes/Spotify) without catalog number are merged
  //    into matching catalog bucket if title & artist match, otherwise separate bucket.
  const groups: {
    key: string;
    catalogNumber: string;
    cleanTitle: string;
    cleanArtist: string;
    items: CDMetadata[];
  }[] = [];

  for (const item of items) {
    const itemCat = normalizeCatNo(item.catalogNumber);
    const itemCleanTitle = cleanTitleForMatching(item.title);
    const itemCleanArtist = cleanArtistForMatching(item.artist);

    // If query was a catalog number search, filter out items that have a completely different catalog number
    if (targetCatNo && itemCat && itemCat !== targetCatNo && !itemCat.includes(targetCatNo) && !targetCatNo.includes(itemCat)) {
      continue;
    }

    let matchedGroup = groups.find((g) => {
      // Rule 0: Exact barcode match
      if (item.barcode && g.items.some((gi) => gi.barcode)) {
        const itemBc = item.barcode.replace(/\D/g, '');
        const groupBc = g.items.find((gi) => gi.barcode)?.barcode?.replace(/\D/g, '');
        if (itemBc && groupBc && itemBc === groupBc) {
          return true;
        }
      }

      // Rule 1: Exact catalog number match
      if (itemCat && g.catalogNumber && (itemCat === g.catalogNumber || itemCat.replace(/[- ]/g, '') === g.catalogNumber.replace(/[- ]/g, ''))) {
        return true;
      }

      // Rule 2: Title & Artist match
      if (itemCleanTitle && g.cleanTitle && itemCleanArtist && g.cleanArtist) {
        const titleMatch = itemCleanTitle === g.cleanTitle ||
          itemCleanTitle.includes(g.cleanTitle) ||
          g.cleanTitle.includes(itemCleanTitle);
        const artistMatch = itemCleanArtist === g.cleanArtist ||
          itemCleanArtist.includes(g.cleanArtist) ||
          g.cleanArtist.includes(itemCleanArtist);

        if (titleMatch && artistMatch) {
          return true;
        }
      }

      return false;
    });

    if (matchedGroup) {
      matchedGroup.items.push(item);
      if (!matchedGroup.catalogNumber && itemCat) {
        matchedGroup.catalogNumber = itemCat;
      }
    } else {
      groups.push({
        key: itemCat ? `cat:${itemCat}` : `ta:${itemCleanArtist}_${itemCleanTitle}`,
        catalogNumber: itemCat,
        cleanTitle: itemCleanTitle,
        cleanArtist: itemCleanArtist,
        items: [item],
      });
    }
  }

  const candidates: SearchResultCandidate[] = [];

  groups.forEach(({ items: groupItems }) => {
    // Combine best fields from each source into a consolidated metadata item
    const sourcesMatched = Array.from(new Set(groupItems.map((i) => i.source)));

    // Prioritize high-resolution iTunes, Spotify, Rakuten, or MusicBrainz cover
    const coverUrl = groupItems.find((i) => i.source === 'itunes' && i.coverUrl)?.coverUrl
      || groupItems.find((i) => i.source === 'spotify' && i.coverUrl)?.coverUrl
      || groupItems.find((i) => i.source === 'rakuten' && i.coverUrl)?.coverUrl
      || groupItems.find((i) => i.source === 'musicbrainz' && i.coverUrl)?.coverUrl
      || groupItems.find((i) => i.coverUrl)?.coverUrl
      || '';

    // Prioritize catalog number from NDL, MusicBrainz, Discogs
    const rawCat = groupItems.find((i) => i.catalogNumber)?.catalogNumber
      || query.catalogNumber
      || '';
    const catalogNumber = rawCat ? String(rawCat).trim().toUpperCase() : '';

    // Prioritize tracks from iTunes or MusicBrainz or NDL
    const tracks = groupItems.find((i) => i.tracks && i.tracks.length > 0)?.tracks || [];

    // Prioritize Japanese artist/title if present (often NDL or iTunes Japan)
    const title = groupItems.find((i) => isJapanese(i.title))?.title
      || groupItems.find((i) => i.title)?.title
      || 'Unknown Title';

    const artist = groupItems.find((i) => isJapanese(i.artist))?.artist
      || groupItems.find((i) => i.artist)?.artist
      || 'Unknown Artist';

    const label = groupItems.find((i) => i.label)?.label || '';
    const releaseDate = groupItems.find((i) => i.releaseDate)?.releaseDate || '';
    const barcode = groupItems.find((i) => i.barcode)?.barcode || '';
    const format = groupItems.find((i) => i.format)?.format || 'CD';
    const genre = groupItems.find((i) => i.genre)?.genre || '';

    // Collect raw sources breakdown for comparison UI
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

    // Evaluate exact match conditions
    const targetCat = normalizeCatNo(query.catalogNumber || (query as any).catno);
    const targetTitle = cleanTitleForMatching(query.title);
    const targetBarcode = query.barcode ? query.barcode.replace(/\D/g, '') : '';

    const candCat = normalizeCatNo(catalogNumber);
    const candTitle = cleanTitleForMatching(title);
    const candBarcode = barcode ? barcode.replace(/\D/g, '') : '';

    const catMatch = Boolean(targetCat && candCat && (candCat === targetCat || candCat.replace(/[- ]/g, '') === targetCat.replace(/[- ]/g, '')));
    const titleMatch = Boolean(targetTitle && candTitle && (candTitle === targetTitle || candTitle.replace(/\s+/g, '') === targetTitle.replace(/\s+/g, '')));
    const barcodeMatch = Boolean(targetBarcode && candBarcode && targetBarcode === candBarcode);

    const exactMatchTypes: ('catalogNumber' | 'title' | 'barcode')[] = [];
    if (catMatch) exactMatchTypes.push('catalogNumber');
    if (titleMatch) exactMatchTypes.push('title');
    if (barcodeMatch) exactMatchTypes.push('barcode');
    const isExactMatch = exactMatchTypes.length > 0;

    // Score match confidence (0 - 100)
    let matchScore = 50 + sourcesMatched.length * 15;
    if (catMatch && titleMatch) {
      matchScore = 100;
    } else if (barcodeMatch) {
      matchScore = 100;
    } else if (catMatch) {
      matchScore = Math.max(95, matchScore + 25);
    } else if (titleMatch) {
      matchScore = Math.max(90, matchScore + 20);
    }
    if (tracks.length > 0) matchScore += 5;
    if (coverUrl) matchScore += 5;
    matchScore = Math.min(100, matchScore);

    const consolidatedCD: CDMetadata = {
      id: `cd-${catalogNumber || 'unk'}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
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
      source: groupItems[0].source, // Primary source
      rawSources,
      confidenceScore: matchScore,
      isExactMatch,
      exactMatchTypes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    candidates.push({
      cd: consolidatedCD,
      sourcesMatched,
      matchScore,
      isExactMatch,
      exactMatchTypes,
    });
  });

  // Sort candidates prioritizing exact match first, then matchScore descending
  candidates.sort((a, b) => {
    if (a.isExactMatch && !b.isExactMatch) return -1;
    if (!a.isExactMatch && b.isExactMatch) return 1;
    return b.matchScore - a.matchScore;
  });

  return candidates;
}

function cleanTitleForMatching(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    // Remove brackets / edition tags
    .replace(/\(.*?(remaster|edition|version|bonus|deluxe|盤|mix|live).*?\)/gi, '')
    .replace(/\[.*?(remaster|edition|version|bonus|deluxe|盤|mix|live).*?\]/gi, '')
    .replace(/【.*?】/g, '')
    .replace(/[～〜\-_\/\:\;]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function cleanArtistForMatching(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\s\-_,\.\/]/g, '')
    .trim();
}

function normalizeCatNo(str?: string): string {
  if (!str) return '';
  return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeString(str?: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[\s\-_,\.]/g, '');
}

function isJapanese(str?: string): boolean {
  if (!str) return false;
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str);
}
