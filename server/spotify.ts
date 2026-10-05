import { CDMetadata, TrackInfo } from '../src/types/cd.js';

let cachedSpotifyToken: { token: string; expiresAt: number } | null = null;

/**
 * Obtain Spotify Client Credentials Token
 */
async function getSpotifyAccessToken(customClientId?: string, customClientSecret?: string): Promise<string | null> {
  const clientId = customClientId || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = customClientSecret || process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
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
    return data.access_token;
  } catch (err) {
    console.error('Spotify Auth error:', err);
    return null;
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

    let q = '';

    if (query.barcode) {
      q = `upc:${query.barcode.trim()}`;
    } else if (query.title || query.artist || query.trackTitle) {
      const parts: string[] = [];
      if (query.title) parts.push(`album:"${query.title.trim()}"`);
      if (query.artist) parts.push(`artist:"${query.artist.trim()}"`);
      if (query.trackTitle) parts.push(`track:"${query.trackTitle.trim()}"`);
      q = parts.join(' ');
    } else if (query.catno) {
      q = query.catno.trim();
    } else if (query.freeText) {
      q = query.freeText.trim();
    }

    if (!q) return [];

    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=album&limit=8&market=JP`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`Spotify API status: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const albums = data.albums?.items || [];

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
        catalogNumber: query.catno || '',
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
