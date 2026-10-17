import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback } from './geminiFallback.js';

export interface VinylLookupQuery {
  id?: string;
  title: string;
  artist: string;
  catalogNumber?: string;
  cdReleaseDate?: string;
  discogsToken?: string;
}

export interface VinylCandidate {
  releaseDate: string;
  format: string; // 'LP' | 'EP' | '7"' | '12"' | 'Vinyl'
  catalogNumber?: string;
  label?: string;
  title: string;
  artist: string;
  source: 'musicbrainz' | 'discogs' | 'ndl' | 'gemini';
  country?: string;
}

export interface VinylLookupResult {
  id?: string;
  found: boolean;
  vinylRecordReleaseDate?: string;
  vinylRecordFormat?: string;
  vinylRecordCatalogNumber?: string;
  vinylRecordLabel?: string;
  source?: string;
  candidates: VinylCandidate[];
  summary?: string;
}

/**
 * Clean album title for matching same-title LP/EP records
 * Removes CD-specific edition suffixes like "(Remaster)", "[初回限定盤]", "(CD)", "-2023 Remaster-"
 */
function cleanTitleForVinylSearch(rawTitle: string): string {
  return (rawTitle || '')
    .replace(/[\(\[（【].*?(初回|通常|限定|期間|生産|盤|仕様|リマスタ|Remaster|Deluxe|Edition|Bonus|CD| Blu-ray|DVD).*?[\)\]）】]/gi, '')
    .replace(/\s+-\s+.*?(Remaster|Edition).*$/i, '')
    .trim();
}

/**
 * Normalize a date string to YYYY-MM-DD or YYYY-MM or YYYY, and provide a comparable key
 */
function normalizeDateStr(raw: string): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const match = trimmed.match(/(\d{4})(?:[-./年](\d{1,2}))?(?:[-./月](\d{1,2}))?/);
  if (!match) return '';
  const yyyy = match[1];
  const mm = match[2] ? match[2].padStart(2, '0') : '';
  const dd = match[3] ? match[3].padStart(2, '0') : '';
  if (yyyy && mm && dd) return `${yyyy}-${mm}-${dd}`;
  if (yyyy && mm) return `${yyyy}-${mm}-01`;
  return yyyy;
}

/**
 * Compare two date strings so we prefer full dates (YYYY-MM-DD) and earliest original LP/EP release date
 */
function compareVinylCandidates(a: VinylCandidate, b: VinylCandidate): number {
  const yearA = parseInt(a.releaseDate.slice(0, 4), 10) || 9999;
  const yearB = parseInt(b.releaseDate.slice(0, 4), 10) || 9999;
  if (yearA !== yearB) return yearA - yearB;
  // Same year: prefer full YYYY-MM-DD over just YYYY
  if (a.releaseDate.length !== b.releaseDate.length) {
    return b.releaseDate.length - a.releaseDate.length;
  }
  return a.releaseDate.localeCompare(b.releaseDate);
}

/**
 * 1. Search MusicBrainz for Vinyl / LP / EP releases with the same title and artist
 */
async function searchMusicBrainzVinyl(title: string, artist: string): Promise<VinylCandidate[]> {
  try {
    const cleanTitle = cleanTitleForVinylSearch(title) || title.trim();
    const cleanArtist = (artist || '').trim();
    if (!cleanTitle) return [];

    const luceneParts: string[] = [`release:"${cleanTitle}"`];
    if (cleanArtist && cleanArtist !== 'Unknown Artist' && cleanArtist !== 'アーティスト名') {
      luceneParts.push(`artist:"${cleanArtist}"`);
    }
    luceneParts.push(`(format:"Vinyl" OR format:"12\\" Vinyl" OR format:"7\\" Vinyl" OR format:"10\\" Vinyl" OR primarytype:"EP")`);

    const mbQuery = luceneParts.join(' AND ');
    const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(mbQuery)}&fmt=json&limit=10`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CDCatalogApp/1.0.0 (https://github.com/aistudio-applet; contact@example.com)',
        Accept: 'application/json',
      },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return [];
    const data = await res.json();
    const releases = data.releases || [];

    const candidates: VinylCandidate[] = [];
    for (const rel of releases) {
      const rawDate = rel.date || '';
      const normDate = normalizeDateStr(rawDate);
      if (!normDate) continue;

      const mediaFormat = rel.media?.[0]?.format || '';
      const rgPrimary = rel['release-group']?.['primary-type'] || '';
      const rgSecondary: string[] = rel['release-group']?.['secondary-types'] || [];

      const isVinylMedia = /vinyl|12"|7"|10"|lp|ep/i.test(mediaFormat);
      const isEPGroup = rgPrimary === 'EP' || rgSecondary.includes('EP');

      if (!isVinylMedia && !isEPGroup) continue;

      let detectedFormat = 'LP';
      if (/7"|ep/i.test(mediaFormat) || isEPGroup) {
        detectedFormat = isVinylMedia ? 'EP (7" Vinyl)' : 'EP';
      } else if (/12"/i.test(mediaFormat)) {
        detectedFormat = 'LP (12" Vinyl)';
      }

      const labelInfo = rel['label-info']?.[0];
      const catNo = labelInfo?.['catalog-number'] || '';
      const labelName = labelInfo?.label?.name || '';
      const relArtist = rel['artist-credit']
        ? rel['artist-credit'].map((ac: any) => ac.name || ac.artist?.name).filter(Boolean).join(', ')
        : cleanArtist;

      candidates.push({
        releaseDate: normDate,
        format: detectedFormat,
        catalogNumber: catNo,
        label: labelName,
        title: rel.title || cleanTitle,
        artist: relArtist,
        source: 'musicbrainz',
        country: rel.country || 'JP',
      });
    }

    return candidates;
  } catch {
    return [];
  }
}

/**
 * 2. Search Discogs for Vinyl (LP / EP / 7" / 12") releases with the same title and artist
 */
async function searchDiscogsVinyl(
  title: string,
  artist: string,
  discogsToken?: string
): Promise<VinylCandidate[]> {
  try {
    const cleanTitle = cleanTitleForVinylSearch(title) || title.trim();
    const cleanArtist = (artist || '').trim();
    if (!cleanTitle) return [];

    const params = new URLSearchParams({
      type: 'release',
      format: 'Vinyl',
      release_title: cleanTitle,
      per_page: '10',
    });

    if (cleanArtist && cleanArtist !== 'Unknown Artist' && cleanArtist !== 'アーティスト名') {
      params.append('artist', cleanArtist);
    }

    const headers: Record<string, string> = {
      'User-Agent': 'CDMetadataManager/1.0 (+https://cd-metadata-app.local)',
      Accept: 'application/json',
    };

    const rawToken = (discogsToken || process.env.DISCOGS_TOKEN || '').trim();
    if (rawToken) {
      if (rawToken.includes(':') && !rawToken.startsWith('http')) {
        const [key, secret] = rawToken.split(':');
        headers['Authorization'] = `Discogs key=${key.trim()}, secret=${secret.trim()}`;
      } else {
        headers['Authorization'] = `Discogs token=${rawToken}`;
        params.append('token', rawToken);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`https://api.discogs.com/database/search?${params.toString()}`, {
      signal: controller.signal,
      headers,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return [];
    const data = await res.json();
    const results = data.results || [];

    const candidates: VinylCandidate[] = [];
    for (const r of results) {
      const yearStr = r.year ? String(r.year) : '';
      const normDate = normalizeDateStr(yearStr);
      if (!normDate) continue;

      const fmtArr: string[] = Array.isArray(r.format) ? r.format : [r.format || 'Vinyl'];
      const fmtJoined = fmtArr.join(', ');
      let detectedFormat = 'LP';
      if (fmtArr.some((f) => /EP|7"|45 RPM/i.test(f))) {
        detectedFormat = 'EP';
      } else if (fmtArr.some((f) => /LP|Album|12"|33 ⅓ RPM/i.test(f))) {
        detectedFormat = 'LP';
      }

      let itemArtist = cleanArtist;
      let itemTitle = r.title || cleanTitle;
      if (r.title && r.title.includes(' - ')) {
        const parts = r.title.split(' - ');
        itemArtist = parts[0].trim();
        itemTitle = parts.slice(1).join(' - ').trim();
      }

      candidates.push({
        releaseDate: normDate,
        format: `${detectedFormat} (${fmtJoined})`,
        catalogNumber: r.catno || '',
        label: Array.isArray(r.label) ? r.label[0] : r.label || '',
        title: itemTitle,
        artist: itemArtist,
        source: 'discogs',
        country: r.country || 'JP',
      });
    }

    return candidates;
  } catch {
    return [];
  }
}

/**
 * 3. Search NDL (国立国会図書館) SRU API for analog sound recordings (録音ディスク / LP / EP)
 */
async function searchNDLVinyl(title: string, artist: string): Promise<VinylCandidate[]> {
  try {
    const cleanTitle = cleanTitleForVinylSearch(title) || title.trim();
    const cleanArtist = (artist || '').trim();
    if (!cleanTitle) return [];

    const queryParts: string[] = [`title="${cleanTitle}"`];
    if (cleanArtist && cleanArtist !== 'Unknown Artist' && cleanArtist !== 'アーティスト名') {
      queryParts.push(`creator="${cleanArtist}"`);
    }

    const sruQuery = queryParts.join(' AND ');
    const url = `https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2&recordSchema=dcndl&maximumRecords=10&query=${encodeURIComponent(sruQuery)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CDCatalogApp/1.0 (https://github.com/aistudio-applet)',
      },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return [];
    const xml = await res.text();
    const recordMatches = xml.match(/<recordData>[\s\S]*?<\/recordData>/gi) || [];

    const candidates: VinylCandidate[] = [];
    for (const recXml of recordMatches) {
      const isAnalogHint =
        /30cm|17cm|LP|EP|アナログ|レコード|33\s*1\/3|45\s*rpm/i.test(recXml);
      if (!isAnalogHint) continue;

      const extract = (tag: string) => {
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
        const match = recXml.match(regex);
        return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim() : '';
      };

      const rawIssued = extract('dcterms:issued') || extract('dc:date') || extract('date');
      const normDate = normalizeDateStr(rawIssued);
      if (!normDate) continue;

      const detectedFormat = /17cm|EP|45\s*rpm/i.test(recXml) ? 'EP' : 'LP';
      const rawTitle = (extract('dc:title') || cleanTitle).replace(/\s*\/\s*.*$/, '').replace(/<[^>]+>/g, '').trim();
      const rawPublisher = extract('dc:publisher') || extract('publisher') || '';

      candidates.push({
        releaseDate: normDate,
        format: detectedFormat,
        label: rawPublisher,
        title: rawTitle,
        artist: cleanArtist,
        source: 'ndl',
        country: 'JP',
      });
    }

    return candidates;
  } catch {
    return [];
  }
}

/**
 * 4. Gemini AI Discography Knowledge Lookup for Exact LP/EP Release Date (YYYY-MM-DD)
 * Many MusicBrainz/Discogs records only store the year (e.g. "1982") or omit Japanese domestic LP/EP dates.
 * Gemini consolidates API candidates and supplies exact Japanese LP/EP release dates & catalog numbers.
 */
async function lookupVinylWithGemini(
  items: VinylLookupQuery[],
  apiCandidatesByIndex: Map<number, VinylCandidate[]>
): Promise<Map<number, VinylCandidate>> {
  const resultMap = new Map<number, VinylCandidate>();
  try {
    const ai = new GoogleGenAI();
    const payload = items.map((item, idx) => ({
      index: idx,
      title: item.title,
      artist: item.artist,
      cdCatalogNumber: item.catalogNumber || '',
      cdReleaseDate: item.cdReleaseDate || '',
      apiFoundVinylCandidates: (apiCandidatesByIndex.get(idx) || []).slice(0, 4),
    }));

    const prompt = `
You are an authoritative Japanese & international discographer and vinyl record archivist.
For each CD album below, determine if an analog vinyl record (LP or EP / 7-inch / 12-inch) of the SAME title by the SAME artist was released, and identify its exact original LP/EP release date (YYYY-MM-DD if known, or YYYY-MM / YYYY) and original LP/EP catalog number.

Input CDs & API candidates:
${JSON.stringify(payload, null, 2)}

Instructions:
1. If API candidates are provided in "apiFoundVinylCandidates", verify them and refine partial year-only dates (e.g. "1984") into exact Japanese/original release dates ("YYYY-MM-DD") if known in official discography.
2. Even if "apiFoundVinylCandidates" is empty, if this album or single was released on LP or EP record (either originally in the 60s/70s/80s/90s or as a modern analog vinyl edition), provide its exact LP/EP release date, format ("LP", "EP", or "LP / EP"), and vinyl catalog number.
3. If no LP or EP vinyl record exists for this title, set "hasVinyl": false.

Return ONLY valid JSON with no markdown backticks:
{
  "results": [
    {
      "index": 0,
      "hasVinyl": true,
      "releaseDate": "YYYY-MM-DD",
      "format": "LP",
      "catalogNumber": "28AH-1234",
      "label": "...",
      "note": "1982年発売のオリジナルLP盤 (規格品番: ...)"
    }
  ]
}
`;

    const response = await generateContentWithFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
      preferredModel: 'gemini-flash-latest',
    });

    const text = (response.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.results)) {
      for (const r of parsed.results) {
        if (r && r.hasVinyl && r.releaseDate) {
          const normDate = normalizeDateStr(r.releaseDate);
          if (normDate) {
            const orig = items[r.index];
            resultMap.set(r.index, {
              releaseDate: normDate,
              format: r.format || 'LP',
              catalogNumber: r.catalogNumber || '',
              label: r.label || '',
              title: orig?.title || '',
              artist: orig?.artist || '',
              source: 'gemini',
              country: 'JP',
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('Gemini vinyl lookup supplement skipped:', err);
  }
  return resultMap;
}

/**
 * Lookup LP / EP vinyl record release date for a single CD or batch of CDs across MusicBrainz, Discogs, NDL, and Gemini AI
 */
export async function lookupVinylReleaseDates(
  queries: VinylLookupQuery[]
): Promise<VinylLookupResult[]> {
  if (!queries || queries.length === 0) return [];

  const apiCandidatesByIndex = new Map<number, VinylCandidate[]>();

  // Step 1: Query MusicBrainz, Discogs, and NDL in parallel for each item (up to 4 concurrent)
  const CONCURRENCY = 3;
  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    const slice = queries.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (q, sIdx) => {
        const idx = i + sIdx;
        const [mbList, dgList, ndlList] = await Promise.all([
          searchMusicBrainzVinyl(q.title, q.artist),
          searchDiscogsVinyl(q.title, q.artist, q.discogsToken),
          searchNDLVinyl(q.title, q.artist),
        ]);

        const combined = [...mbList, ...dgList, ...ndlList];
        combined.sort(compareVinylCandidates);
        apiCandidatesByIndex.set(idx, combined);
      })
    );
  }

  // Step 2: Run Gemini discography verification/enrichment in chunks of 6 to get full YYYY-MM-DD dates
  const geminiCandidateMap = new Map<number, VinylCandidate>();
  const GEMINI_CHUNK = 6;
  for (let i = 0; i < queries.length; i += GEMINI_CHUNK) {
    const chunk = queries.slice(i, i + GEMINI_CHUNK);
    const subMap = new Map<number, VinylCandidate[]>();
    chunk.forEach((_, cIdx) => {
      subMap.set(cIdx, apiCandidatesByIndex.get(i + cIdx) || []);
    });
    const gemRes = await lookupVinylWithGemini(chunk, subMap);
    gemRes.forEach((val, cIdx) => {
      geminiCandidateMap.set(i + cIdx, val);
    });
  }

  // Step 3: Consolidate best LP/EP release date & candidate list for each item
  return queries.map((q, idx) => {
    const apiCandidates = apiCandidatesByIndex.get(idx) || [];
    const gemCandidate = geminiCandidateMap.get(idx);

    const allCandidates: VinylCandidate[] = [];
    if (gemCandidate) {
      allCandidates.push(gemCandidate);
    }
    for (const c of apiCandidates) {
      // Avoid exact duplicate date + source
      if (!allCandidates.some((existing) => existing.releaseDate === c.releaseDate && existing.format === c.format)) {
        allCandidates.push(c);
      }
    }

    // Prefer a candidate with full YYYY-MM-DD date from earliest original release year
    allCandidates.sort((a, b) => {
      // If one has full YYYY-MM-DD and the other is only YYYY of the same year, prefer YYYY-MM-DD
      const yA = parseInt(a.releaseDate.slice(0, 4), 10) || 9999;
      const yB = parseInt(b.releaseDate.slice(0, 4), 10) || 9999;
      if (Math.abs(yA - yB) <= 1 && a.releaseDate.length !== b.releaseDate.length) {
        return b.releaseDate.length - a.releaseDate.length;
      }
      return compareVinylCandidates(a, b);
    });

    const primary = allCandidates[0];
    if (!primary) {
      return {
        id: q.id,
        found: false,
        candidates: [],
        summary: '同タイトルのLP・EPレコード発売日は見つかりませんでした',
      };
    }

    const sourceLabel =
      primary.source === 'musicbrainz'
        ? 'MusicBrainz API'
        : primary.source === 'discogs'
        ? 'Discogs API'
        : primary.source === 'ndl'
        ? '国立国会図書館(NDL) API'
        : 'Discogs/MusicBrainz + Gemini統合検証';

    return {
      id: q.id,
      found: true,
      vinylRecordReleaseDate: primary.releaseDate,
      vinylRecordFormat: primary.format.startsWith('EP') ? 'EP' : 'LP',
      vinylRecordCatalogNumber: primary.catalogNumber || undefined,
      vinylRecordLabel: primary.label || undefined,
      source: sourceLabel,
      candidates: allCandidates,
      summary: `${primary.format}盤 発売日: ${primary.releaseDate}${primary.catalogNumber ? ` (規格品番: ${primary.catalogNumber})` : ''} [${sourceLabel}]`,
    };
  });
}
