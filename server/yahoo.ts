import { CDMetadata } from '../src/types/cd.js';

const YAHOO_DEFAULT_APP_ID = process.env.YAHOO_APP_ID || 'dj0zaiZpPVZ0M0V0QmhMTE5aWSZzPWNvbnN1bWVyc2VjcmV0Jng9OWI-';

/**
 * Search Yahoo! Shopping API V3 for CDs
 */
export async function searchYahooShopping(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
  apiKeys?: { yahooAppId?: string };
}): Promise<CDMetadata[]> {
  try {
    const appId = query.apiKeys?.yahooAppId || YAHOO_DEFAULT_APP_ID;

    const qParts: string[] = [];
    if (query.barcode) qParts.push(query.barcode.trim());
    if (query.catno) qParts.push(query.catno.trim());
    if (query.title) qParts.push(query.title.trim());
    if (query.artist) qParts.push(query.artist.trim());
    if (query.trackTitle) qParts.push(query.trackTitle.trim());
    if (query.freeText) qParts.push(query.freeText.trim());

    const searchQuery = qParts.join(' ');
    if (!searchQuery) return [];

    const params = new URLSearchParams({
      appid: appId,
      query: searchQuery,
      category_id: '2502', // CD, DVD, Music category
      results: '8',
      image_size: '500',
    });

    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (!res.ok) {
      console.warn(`Yahoo Shopping API status: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const hits = data.hits || [];

    const results: CDMetadata[] = [];

    for (const item of hits) {
      const name = item.name || 'Unknown CD';
      const code = item.code || '';
      const janCode = item.janCode || item.code || '';
      const coverUrl = item.image?.medium || item.image?.large || '';
      const price = item.price || 0;
      const description = item.description || '';
      const storeName = item.seller?.name || '';

      // Parse artist & title if possible (Yahoo item names often look like "アーティスト名 - タイトル (CD)")
      let artist = 'Various Artists';
      let title = name;

      if (name.includes(' - ')) {
        const parts = name.split(' - ');
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      }

      results.push({
        id: `yahoo-${code || results.length}`,
        catalogNumber: query.catno || '',
        title,
        artist,
        label: storeName,
        barcode: janCode.length >= 10 ? janCode : undefined,
        coverUrl,
        format: 'CD',
        country: 'JP',
        tracks: [],
        source: 'yahoo',
        sourceDetails: {
          yahooItemId: code,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return results;
  } catch (err) {
    console.warn('Yahoo Shopping search error:', err);
    return [];
  }
}
