import { CDMetadata, TrackInfo } from '../src/types/cd.js';

/**
 * Search 国立国会図書館 (NDL) SRU API
 */
export async function searchNDL(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
}): Promise<CDMetadata[]> {
  try {
    const queryParts: string[] = [];

    if (query.barcode) {
      const cleanBarcode = query.barcode.replace(/\D/g, '');
      if (cleanBarcode) {
        queryParts.push(`(isbn="${cleanBarcode}" OR any="${cleanBarcode}")`);
      }
    }

    if (query.catno) {
      // Normalize catalog number e.g. "SRCL-1234" or "SRCL 1234"
      const cleanCat = query.catno.trim();
      queryParts.push(`(any="${cleanCat}" OR title="${cleanCat}")`);
    } else if (query.title || query.artist || query.trackTitle) {
      if (query.title) queryParts.push(`title="${query.title.trim()}"`);
      if (query.artist) queryParts.push(`creator="${query.artist.trim()}"`);
      if (query.trackTitle) queryParts.push(`any="${query.trackTitle.trim()}"`);
    } else if (query.freeText) {
      queryParts.push(`any="${query.freeText.trim()}"`);
    }

    if (queryParts.length === 0) return [];

    // NDL SRU API
    const sruQuery = queryParts.join(' AND ');
    const url = `https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2&recordSchema=dcndl&maximumRecords=10&query=${encodeURIComponent(sruQuery)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'CDCatalogApp/1.0 (https://github.com/aistudio-applet)',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.warn(`NDL API returned status ${res.status}`);
      return [];
    }

    const xmlText = await res.text();
    return parseNDLXmlResponse(xmlText, query.catno);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('NDL API fetch timed out (12s limit)');
    } else {
      console.error('Error fetching NDL API:', err?.message || err);
    }
    return [];
  }
}

/**
 * Simple XML extractor for DCNDL SRU records
 */
function parseNDLXmlResponse(xml: string, targetCatno?: string): CDMetadata[] {
  const records: CDMetadata[] = [];
  const recordMatches = xml.match(/<recordData>[\s\S]*?<\/recordData>/gi) || [];

  for (const recXml of recordMatches) {
    const extract = (tag: string) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const match = recXml.match(regex);
      return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim() : '';
    };

    const extractAll = (tag: string) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const matches = Array.from(recXml.matchAll(regex));
      return matches.map((m) => m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim());
    };

    const rawTitle = extract('dc:title') || extract('title') || extract('dcterms:title');
    const rawCreators = extractAll('dc:creator').concat(extractAll('creator'));
    const rawPublisher = extract('dcndl:publicationName') || extract('dc:publisher') || extract('publisher');
    const rawIssued = extract('dcterms:issued') || extract('dc:date') || extract('date');
    const rawIdentifiers = extractAll('dc:identifier').concat(extractAll('identifier')).concat(extractAll('dcndl:materialType'));
    const descriptions = extractAll('dcterms:description').concat(extractAll('dc:description'));

    if (!rawTitle) continue;

    // Clean title (remove subheadings or extra delimiters)
    const title = rawTitle.replace(/\s*\/\s*.*$/, '').replace(/<[^>]+>/g, '').trim();
    const artist = rawCreators.length > 0 ? rawCreators.join(', ').replace(/<[^>]+>/g, '').trim() : 'Unknown Artist';

    // Extract catalog number or JAN code
    let catalogNumber = targetCatno || '';
    let barcode = '';

    for (const idStr of rawIdentifiers) {
      if (/^\d{12,13}$/.test(idStr.replace(/[- ]/g, ''))) {
        barcode = idStr.replace(/[- ]/g, '');
      } else if (/[A-Z]{2,5}[- ]?\d{2,6}/i.test(idStr)) {
        const catMatch = idStr.match(/[A-Z]{2,5}[- ]?\d{2,6}/i);
        if (catMatch && !catalogNumber) {
          catalogNumber = catMatch[0].toUpperCase();
        }
      }
    }

    // Extract track list from descriptions if formatted (e.g., "1. Song A 2. Song B")
    const tracks: TrackInfo[] = [];
    descriptions.forEach((desc) => {
      const trackLines = desc.split(/[\n;；,]/);
      trackLines.forEach((line) => {
        const match = line.match(/^(\d{1,2})[\.\s：:]\s*(.+)$/);
        if (match) {
          tracks.push({
            trackNumber: parseInt(match[1], 10),
            title: match[2].trim(),
          });
        }
      });
    });

    // Format date
    let releaseDate = rawIssued;
    if (releaseDate) {
      const dateMatch = releaseDate.match(/(\d{4})[-.\/]?(\d{2})?[-.\/]?(\d{2})?/);
      if (dateMatch) {
        releaseDate = [dateMatch[1], dateMatch[2], dateMatch[3]].filter(Boolean).join('-');
      }
    }

    records.push({
      id: `ndl-${records.length}-${Date.now()}`,
      catalogNumber: catalogNumber || targetCatno || '',
      title,
      artist,
      label: rawPublisher || '',
      releaseDate,
      barcode,
      country: 'JP',
      format: 'CD',
      tracks,
      source: 'ndl',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return records;
}
