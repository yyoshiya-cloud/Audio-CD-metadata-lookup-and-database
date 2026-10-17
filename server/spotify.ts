import { CDMetadata, TrackInfo } from '../src/types/cd.js';
import { digitsOnly, spotifyQuote } from './searchUtils.js';

// クライアントIDごとにトークンをキャッシュ（検索のたびに再取得しない）
const spotifyTokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Obtain Spotify Client Credentials Token
 */
async function getSpotifyAccessToken(customClientId?: string, customClientSecret?: string): Promise<string | null> {
  const clientId = customClientId || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = customClientSecret || process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
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
      console.warn('Failed to fetch Spotify access token with provided client credentials');
      return null;
    }

    const data = await res.json();
    if (data.access_token) {
      // 期限の60秒前に失効扱いにして余裕を持たせる
      const ttlSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      spotifyTokenCache.set(clientId, { token: data.access_token, expiresAt: Date.now() + Math.max(0, ttlSec - 60) * 1000 });
    }
    return data.access_token;
  } catch (err) {
    console.error('Spotify Auth error:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    if (!token) {
      // Spotify Credentials not set, return empty without breaking cross-search
      return [];
    }

    const cleanBarcode = digitsOnly(query.barcode);
    const hasTextQuery = Boolean(query.title || query.artist || query.trackTitle);

    // 検索クエリの候補（厳密 → 緩和の順）。JAN(upc) で見つからない場合はタイトル/アーティストで再検索する。
    const queries: string[] = [];
    if (cleanBarcode) queries.push(`upc:${cleanBarcode}`);
    if (hasTextQuery) {
      const parts: string[] = [];
      if (query.title) parts.push(`album:${spotifyQuote(query.title)}`);
      if (query.artist) parts.push(`artist:${spotifyQuote(query.artist)}`);
      if (query.trackTitle) parts.push(`track:${spotifyQuote(query.trackTitle)}`);
      queries.push(parts.join(' '));
    } else if (query.catno && !cleanBarcode) {
      queries.push(query.catno.trim());
    } else if (query.freeText && !cleanBarcode) {
      queries.push(query.freeText.trim());
    }
    if (queries.length === 0) return [];

    const isTrackSearch = Boolean(query.trackTitle && query.trackTitle.trim() && !query.title && !cleanBarcode && !query.catno);
    const searchType = isTrackSearch ? 'track' : 'album';

    let data: any = null;
    let hasResults = false;
    for (const q of queries) {
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${searchType}&limit=10&market=JP`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: controller.signal,
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        console.warn(`Spotify API status: ${res.status}`);
        continue;
      }
      data = await res.json();
      hasResults = (isTrackSearch ? data.tracks?.items : data.albums?.items)?.length > 0;
      if (hasResults) break;
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
  } catch (err) {
    console.error('Error searching Spotify API:', err);
    return [];
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
