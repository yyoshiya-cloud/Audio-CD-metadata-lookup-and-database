import { CDMetadata, TrackInfo } from '../src/types/cd.js';

/**
 * Search iTunes Search API
 */
export async function searchITunes(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  freeText?: string;
}): Promise<CDMetadata[]> {
  try {
    let term = '';

    if (query.title || query.artist || query.trackTitle) {
      term = [query.artist, query.title, query.trackTitle].filter(Boolean).join(' ');
    } else if (query.catno) {
      term = query.catno.trim();
    } else if (query.freeText) {
      term = query.freeText.trim();
    }

    if (!term) return [];

    const hasTrackQuery = Boolean(query.trackTitle && query.trackTitle.trim());
    const entity = hasTrackQuery && !query.title ? 'song' : 'album';
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&country=jp&limit=10`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`iTunes API returned status ${res.status}`);
      return [];
    }

    const data = await res.json();
    const rawResults = data.results || [];

    // Deduplicate by collectionId when entity=song returns multiple songs from the same album
    const seenCollectionIds = new Set<number>();
    const results: any[] = [];
    for (const item of rawResults) {
      const cid = item.collectionId;
      if (!cid || seenCollectionIds.has(cid)) continue;
      seenCollectionIds.add(cid);
      results.push(item);
      if (results.length >= 8) break;
    }

    const items: CDMetadata[] = [];

    for (const album of results) {
      const collectionId = album.collectionId;
      const title = album.collectionName || album.collectionCensoredName || album.trackName || 'Unknown Title';
      const artist = album.collectionArtistName || album.artistName || 'Unknown Artist';
      const releaseDate = album.releaseDate ? album.releaseDate.slice(0, 10) : '';
      const genre = album.primaryGenreName || '';
      
      // High-resolution artwork 600x600
      let coverUrl = album.artworkUrl100 || '';
      if (coverUrl) {
        coverUrl = coverUrl.replace('100x100bb', '600x600bb').replace('100x100', '600x600');
      }

      // Fetch tracks for top 4 results (or when trackTitle was queried so the matched song is guaranteed in tracks)
      let tracks: TrackInfo[] = [];
      if ((items.length < 4 || hasTrackQuery) && collectionId && items.length < 5) {
        tracks = await fetchITunesTracks(collectionId);
      }
      // If lookup returned empty and this came from entity=song, at least include the matched song
      if (tracks.length === 0 && album.wrapperType === 'track' && album.trackName) {
        const ms = album.trackTimeMillis;
        let duration = '';
        if (ms) {
          const totalSec = Math.floor(ms / 1000);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          duration = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }
        tracks = [
          {
            trackNumber: album.trackNumber || 1,
            title: album.trackName,
            artist: album.artistName,
            duration,
            previewUrl: album.previewUrl,
          },
        ];
      }

      items.push({
        id: `itunes-${collectionId}`,
        catalogNumber: query.catno || '',
        title,
        artist,
        label: album.copyright || '',
        releaseDate,
        genre,
        format: 'CD / Digital',
        coverUrl,
        tracks,
        source: 'itunes',
        sourceDetails: {
          itunesCollectionId: collectionId,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return items;
  } catch (err) {
    console.error('Error searching iTunes API:', err);
    return [];
  }
}

/**
 * Fetch tracklist for an iTunes collection ID
 */
export async function fetchITunesTracks(collectionId: number): Promise<TrackInfo[]> {
  try {
    const url = `https://itunes.apple.com/lookup?id=${collectionId}&entity=song&country=jp`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const results = data.results || [];

    const tracks: TrackInfo[] = [];

    results.forEach((item: any) => {
      if (item.wrapperType === 'track') {
        const ms = item.trackTimeMillis;
        let duration = '';
        if (ms) {
          const totalSec = Math.floor(ms / 1000);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          duration = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }

        tracks.push({
          trackNumber: item.trackNumber || tracks.length + 1,
          title: item.trackName || `Track ${tracks.length + 1}`,
          artist: item.artistName !== item.collectionArtistName ? item.artistName : undefined,
          duration,
          previewUrl: item.previewUrl,
        });
      }
    });

    return tracks;
  } catch (err) {
    return [];
  }
}
