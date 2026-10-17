import { CDMetadata, TrackInfo } from '../src/types/cd.js';
import { catnoVariants, cqlQuote, decodeXmlEntities, digitsOnly, isValidBarcodeLength } from './searchUtils.js';

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

    const cleanBarcode = digitsOnly(query.barcode);
    const barcodePart = cleanBarcode ? `(isbn=${cqlQuote(cleanBarcode)} OR any=${cqlQuote(cleanBarcode)})` : '';
    let catPart = '';
    if (query.catno) {
      // "SRCL-1234" / "SRCL1234" など表記揺れを OR で吸収
      const variants = catnoVariants(query.catno);
      catPart = `(${variants.flatMap((v) => [`any=${cqlQuote(v)}`, `title=${cqlQuote(v)}`]).join(' OR ')})`;
    }

    if (barcodePart || catPart) {
      // JAN と型番の両方が指定されても、NDL のレコードに両方載っているとは限らないため OR で結ぶ
      queryParts.push(barcodePart && catPart ? `(${barcodePart} OR ${catPart})` : barcodePart || catPart);
    } else if (query.title || query.artist || query.trackTitle) {
      if (query.title) queryParts.push(`title=${cqlQuote(query.title.trim())}`);
      if (query.artist) queryParts.push(`creator=${cqlQuote(query.artist.trim())}`);
      if (query.trackTitle) queryParts.push(`any=${cqlQuote(query.trackTitle.trim())}`);
    } else if (query.freeText) {
      queryParts.push(`any=${cqlQuote(query.freeText.trim())}`);
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
    return parseNDLXmlResponse(xmlText);
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
export function parseNDLXmlResponse(rawXml: string): CDMetadata[] {
  const records: CDMetadata[] = [];
  // recordData がXMLエスケープされた文字列として返る場合に備えて、一段階だけ展開する
  const xml = /&lt;(?:rdf:|dc:|dcterms:|dcndl:)/i.test(rawXml) ? decodeXmlEntities(rawXml) : rawXml;
  const recordMatches = xml.match(/<recordData>[\s\S]*?<\/recordData>/gi) || [];

  for (const recXml of recordMatches) {
    const extract = (tag: string) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const match = recXml.match(regex);
      return match ? decodeXmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')).trim() : '';
    };

    const extractAll = (tag: string) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const matches = Array.from(recXml.matchAll(regex));
      return matches.map((m) => decodeXmlEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')).trim());
    };

    const rawTitle = extract('dc:title') || extract('title') || extract('dcterms:title');
    const rawCreators = extractAll('dc:creator').concat(extractAll('creator'));
    const rawPublisher = extract('dcndl:publicationName') || extract('dc:publisher') || extract('publisher');
    const rawIssued = extract('dcterms:issued') || extract('dc:date') || extract('date');
    const rawIdentifiers = extractAll('dc:identifier').concat(extractAll('identifier')).concat(extractAll('dcndl:materialType'));
    const descriptions = extractAll('dcterms:description').concat(extractAll('dc:description'));

    if (!rawTitle) continue;

    // Clean title (remove subheadings or extra delimiters)
    const title = rawTitle.replace(/\s+\/\s+.*$/, '').replace(/<[^>]+>/g, '').trim();
    const artist = rawCreators.length > 0 ? rawCreators.join(', ').replace(/<[^>]+>/g, '').trim() : 'Unknown Artist';

    // 型番 / JAN の抽出。識別子文字列全体が型番形式のものだけを採用する
    // （部分一致だと "JP20123456" のような書誌番号を型番と誤認するため）
    let catalogNumber = '';
    let barcode = '';

    for (const idStr of rawIdentifiers) {
      const compact = idStr.replace(/[- ]/g, '');
      if (/^\d{8,14}$/.test(compact) && isValidBarcodeLength(compact)) {
        if (!barcode) barcode = compact;
      } else if (/^[A-Z]{2,6}[- ]?\d{3,6}(?:[-\/~]\d{1,6})?$/i.test(idStr.trim())) {
        if (!catalogNumber) catalogNumber = idStr.trim().toUpperCase();
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
      // 型番は NDL レコードに記載されたものだけ（検索条件で補完しない）
      catalogNumber,
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
