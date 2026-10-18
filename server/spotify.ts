import { CDMetadata, TrackInfo } from '../src/types/cd.js';
import { artistSimilarity, digitsOnly, spotifyQuote } from './searchUtils.js';

// クライアントIDごとにトークンをキャッシュ（検索のたびに再取得しない）
const spotifyTokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Obtain Spotify Client Credentials Token
 * 失敗時は理由が画面に出るよう、null を返さず説明付きの Error を投げる。
 */
async function getSpotifyAccessToken(customClientId?: string, customClientSecret?: string): Promise<string> {
  const clientId = customClientId || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = customClientSecret || process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify の Client ID / Client Secret が未設定です。「API利用登録」で設定してください。');
  }

  const cached = spotifyTokenCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      let detail = '';
      try {
        const err = await res.json();
        detail = err.error_description || err.error || '';
      } catch {
        // ignore
      }
      throw new Error(
        `Spotify の認証に失敗しました (HTTP ${res.status}${detail ? `: ${detail}` : ''})。Client ID / Client Secret を確認してください。`
      );
    }

    const data = await res.json();
    if (!data.access_token) {
      throw new Error('Spotify の認証応答にアクセストークンが含まれていません。');
    }
    // 期限の60秒前に失効扱いにして余裕を持たせる
    const ttlSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    spotifyTokenCache.set(clientId, { token: data.access_token, expiresAt: Date.now() + Math.max(0, ttlSec - 60) * 1000 });
    return data.access_token;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Spotify の認証がタイムアウトしました (6秒)。');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Spotify の HTTP エラーを、原因が分かる日本語メッセージにする */
export function describeSpotifyHttpError(status: number, retryAfter?: string | null): string {
  if (status === 401) return 'Spotify の認証トークンが無効です (HTTP 401)。';
  if (status === 403) {
    return 'Spotify API が拒否しました (HTTP 403)。開発モードのアプリは、アプリ所有者の Spotify Premium が有効である必要があります（2026年2月の仕様変更）。';
  }
  if (status === 429) {
    return `Spotify API のリクエスト上限に達しました (HTTP 429)。${retryAfter ? `${retryAfter}秒後に` : 'しばらく待ってから'}再試行してください。`;
  }
  return `Spotify API エラー (HTTP ${status})。`;
}

/**
 * Search Spotify Web API
 */
export async function searchSpotify(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
  apiKeys?: { spotifyClientId?: string; spotifyClientSecret?: string };
}): Promise<CDMetadata[]> {
  try {
    const token = await getSpotifyAccessToken(
      query.apiKeys?.spotifyClientId,
      query.apiKeys?.spotifyClientSecret
    );

    const cleanBarcode = digitsOnly(query.barcode);
    const hasTextQuery = Boolean(query.title || query.artist || query.trackTitle);

    // 検索クエリの候補（厳密 → 緩和の順）。
    //  1. JAN(upc)  2. フィールド指定 (album:/artist:/track:)  3. 通常のキーワード検索（Spotifyアプリの検索と同じ）
    // フィールド指定は日本語名で取りこぼすことがあるため、0件のときはキーワード検索に切り替える。
    const queries: { q: string; plain?: boolean }[] = [];
    if (cleanBarcode) queries.push({ q: `upc:${cleanBarcode}` });
    if (hasTextQuery) {
      const parts: string[] = [];
      if (query.title) parts.push(`album:${spotifyQuote(query.title)}`);
      if (query.artist) parts.push(`artist:${spotifyQuote(query.artist)}`);
      if (query.trackTitle) parts.push(`track:${spotifyQuote(query.trackTitle)}`);
      queries.push({ q: parts.join(' ') });
      const plain = [query.title, query.artist, query.trackTitle]
        .filter(Boolean)
        .map((v) => v!.replace(/["\\]/g, ' ').trim())
        .join(' ');
      if (plain) queries.push({ q: plain, plain: true });
    } else if (query.catno && !cleanBarcode) {
      queries.push({ q: query.catno.trim(), plain: true });
    } else if (query.freeText && !cleanBarcode) {
      queries.push({ q: query.freeText.trim(), plain: true });
    }
    if (queries.length === 0) return [];

    const isTrackSearch = Boolean(query.trackTitle && query.trackTitle.trim() && !query.title && !cleanBarcode && !query.catno);
    const searchType = isTrackSearch ? 'track' : 'album';

    let data: any = null;
    let hasResults = false;
    let usedPlainQuery = false;
    for (const { q, plain } of queries) {
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${searchType}&limit=10&market=JP`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: controller.signal,
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') throw new Error('Spotify API がタイムアウトしました (6秒)。');
        throw err;
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        if (res.status === 401) {
          // トークンが失効している場合に備えてキャッシュを捨てる（次回の検索で再取得）
          spotifyTokenCache.clear();
        }
        throw new Error(describeSpotifyHttpError(res.status, res.headers.get('retry-after')));
      }
      data = await res.json();
      hasResults = (isTrackSearch ? data.tracks?.items : data.albums?.items)?.length > 0;
      if (hasResults) {
        usedPlainQuery = Boolean(plain);
        break;
      }
    }
    if (!data || !hasResults) return [];

    let albums: any[] = [];
    if (isTrackSearch) {
      const trackItems = data.tracks?.items || [];
      const seenAlbumIds = new Set<string>();
      for (const tr of trackItems) {
        if (tr.album && tr.album.id && !seenAlbumIds.has(tr.album.id)) {
          seenAlbumIds.add(tr.album.id);
          albums.push(tr.album);
          if (albums.length >= 8) break;
        }
      }
    } else {
      albums = data.albums?.items || [];
    }

    // キーワード検索（フィールド指定なし）の結果は無関係なアーティストが混ざるため、
    // アーティスト名が指定されている場合は近いものだけに絞る
    if (usedPlainQuery && query.artist) {
      albums = albums.filter((alb: any) =>
        (alb.artists || []).some((a: any) => artistSimilarity(a.name, query.artist) >= 0.8)
      );
    }

    const results: CDMetadata[] = [];

    for (const alb of albums) {
      const spotifyId = alb.id;
      const title = alb.name || 'Unknown Title';
      const artist = alb.artists ? alb.artists.map((a: any) => a.name).join(', ') : 'Unknown Artist';
      const releaseDate = alb.release_date || '';
      
      // High-res image (640x640)
      const coverUrl = alb.images?.[0]?.url || alb.images?.[1]?.url || '';

      // Fetch tracks for top 3 albums
      let tracks: TrackInfo[] = [];
      if (results.length < 3 && spotifyId) {
        tracks = await fetchSpotifyAlbumTracks(spotifyId, token);
      }

      results.push({
        id: `spotify-${spotifyId}`,
        // Spotify は型番を持たないため空のまま（検索条件で補完しない）
        catalogNumber: '',
        title,
        artist,
        releaseDate,
        country: 'JP',
        format: 'CD / Streaming',
        coverUrl,
        tracks,
        source: 'spotify',
        sourceDetails: {
          spotifyId,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return results;
  } catch (err: any) {
    // 画面の「API別データ比較」にエラー理由を表示できるよう、握りつぶさずに投げ直す
    console.error('Error searching Spotify API:', err?.message || err);
    throw err;
  }
}

/**
 * Fetch tracks for a Spotify Album ID
 */
async function fetchSpotifyAlbumTracks(albumId: string, token: string): Promise<TrackInfo[]> {
  try {
    const url = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50&market=JP`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!res.ok) return [];

    const data = await res.json();
    const items = data.items || [];

    return items.map((tr: any) => {
      const ms = tr.duration_ms;
      let duration = '';
      if (ms) {
        const totalSec = Math.floor(ms / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        duration = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }

      return {
        trackNumber: tr.track_number,
        title: tr.name,
        artist: tr.artists?.map((a: any) => a.name).join(', '),
        duration,
        previewUrl: tr.preview_url,
      };
    });
  } catch (err) {
    return [];
  }
}
