import { CDMetadata, TrackInfo } from '../src/types/cd.js';

/**
 * Search Discogs API
 */
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
  const params = new URLSearchParams({
    type: 'release',
    per_page: '8',
  });

  const headers: Record<string, string> = {
    'User-Agent': 'CDMetadataManager/1.0 (+https://cd-metadata-app.local)',
    'Accept': 'application/json',
  };

  const rawToken = query.apiKeys?.discogsToken?.trim();
  if (rawToken) {
    if (rawToken.includes(':') && !rawToken.startsWith('http')) {
      const [key, secret] = rawToken.split(':');
      headers['Authorization'] = `Discogs key=${key.trim()}, secret=${secret.trim()}`;
    } else if (rawToken.includes('key=') || rawToken.includes('secret=')) {
      headers['Authorization'] = `Discogs ${rawToken}`;
    } else {
      headers['Authorization'] = `Discogs token=${rawToken}`;
      params.append('token', rawToken);
    }
  }

  const cleanBarcode = query.barcode ? query.barcode.replace(/\D/g, '') : '';

  if (catno) {
    params.append('catno', catno.trim());
  } else if (cleanBarcode) {
    params.append('barcode', cleanBarcode);
  } else if (query.title || query.artist || query.trackTitle) {
    const q = [query.artist, query.title, query.trackTitle].filter(Boolean).join(' ');
    params.append('q', q);
  } else if (query.freeText) {
    params.append('q', query.freeText.trim());
  }

  const url = `https://api.discogs.com/database/search?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers,
    });
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
  const results = data.results || [];

  const items: CDMetadata[] = [];

  for (const r of results) {
    // Discogs title format is usually "Artist - Album Title"
    let artist = 'Unknown Artist';
    let title = r.title || 'Unknown Title';

    if (r.title && r.title.includes(' - ')) {
      const parts = r.title.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }

    const catalogNumber = r.catno || catno || '';
    const releaseDate = r.year ? String(r.year) : '';
    const country = r.country || 'JP';
    const label = Array.isArray(r.label) ? r.label[0] : r.label || '';
    const coverUrl = r.cover_image || r.thumb || '';
    const format = Array.isArray(r.format) ? r.format.join(', ') : r.format || 'CD';
    const barcode = Array.isArray(r.barcode) ? r.barcode[0] : r.barcode || '';

    items.push({
      id: `discogs-${r.id}`,
      catalogNumber: catalogNumber || catno || '',
      title,
      artist,
      label,
      releaseDate,
      barcode,
      country,
      format,
      coverUrl,
      tracks: [],
      source: 'discogs',
      sourceDetails: {
        discogsId: String(r.id),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return items;
}
