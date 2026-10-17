import { CDMetadata, TrackInfo } from '../src/types/cd.js';

import { digitsOnly, isValidBarcodeLength } from './searchUtils.js';

/**
 * Search 楽天ブックスCD検索API (Rakuten Books CD Search API)
 */
export async function searchRakutenBooks(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
  apiKeys?: { rakutenAppId?: string };
}): Promise<CDMetadata[]> {
  try {
    // アプリケーションIDはユーザー設定 または 環境変数 RAKUTEN_APP_ID から取得（ソースに埋め込まない）
    const appId = query.apiKeys?.rakutenAppId || process.env.RAKUTEN_APP_ID;
    if (!appId) return [];

    const params = new URLSearchParams({
      applicationId: appId,
      format: 'json',
      hits: '8',
    });

    const cleanBarcode = digitsOnly(query.barcode);

    if (isValidBarcodeLength(cleanBarcode)) {
      params.append('jan', cleanBarcode);
    } else if (query.catno && !query.title && !query.artist && !query.trackTitle && !query.freeText) {
      // 楽天ブックスCD検索APIは型番での検索に対応していない（title に型番を渡しても一致しない）
      return [];
    } else if (query.title || query.artist || query.trackTitle) {
      if (query.title) params.append('title', query.title.trim());
      if (query.artist) params.append('artistName', query.artist.trim());
      if (query.trackTitle && !query.title) params.append('title', query.trackTitle.trim());
    } else if (query.freeText) {
      params.append('title', query.freeText.trim());
    }

    if (!['jan', 'title', 'artistName'].some((k) => params.has(k))) return [];

    const url = `https://app.rakuten.co.jp/services/api/BooksCD/Search/20170404?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.warn(`Rakuten Books API status: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const items = data.Items || [];

    const results: CDMetadata[] = [];

    for (const wrap of items) {
      const item = wrap.Item;
      if (!item) continue;

      const title = item.title || 'Unknown Title';
      const artist = item.artistName || 'Unknown Artist';
      const label = item.label || item.publisherName || '';
      const barcode = item.jan || '';
      
      // Cover artwork image (prefer large image)
      let coverUrl = item.largeImageUrl || item.mediumImageUrl || '';
      if (coverUrl) {
        coverUrl = coverUrl.replace('?_ex=200x200', '?_ex=500x500');
      }

      // Format release date e.g. "2000年03月01日" -> "2000-03-01"
      let releaseDate = item.salesDate || '';
      if (releaseDate) {
        const dateMatch = releaseDate.match(/(\d{4})年(\d{2})月(\d{2})日/);
        if (dateMatch) {
          releaseDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        }
      }

      const format = item.limitedFlag === 1 ? 'CD (初回限定盤)' : 'CD';
      const itemCode = item.itemCode || '';

      results.push({
        id: `rakuten-${itemCode || barcode || results.length}`,
        // 楽天ブックスは型番を返さないため空のまま（検索条件で補完しない）
        catalogNumber: '',
        title,
        artist,
        label,
        releaseDate,
        barcode,
        country: 'JP',
        format,
        coverUrl,
        tracks: [], // Track info from Rakuten itemCaption if available
        source: 'rakuten',
        sourceDetails: {
          rakutenItemCode: itemCode,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return results;
  } catch (err) {
    console.error('Error searching Rakuten Books API:', err);
    return [];
  }
}
