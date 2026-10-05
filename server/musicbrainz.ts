import { CDMetadata, TrackInfo } from '../src/types/cd.js';

/**
 * Search MusicBrainz API
 */
export async function searchMusicBrainz(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
}): Promise<CDMetadata[]> {
  try {
    const luceneParts: string[] = [];

    if (query.barcode) {
      const cleanBarcode = query.barcode.replace(/\D/g, '');
      if (cleanBarcode) {
        luceneParts.push(`barcode:${cleanBarcode}`);
      }
    } else if (query.catno) {
      const cleanCat = query.catno.trim();
      luceneParts.push(`catno:"${cleanCat}" OR catno:"${cleanCat.replace(/[- ]/g, '')}"`);
    } else if (query.title || query.artist || query.trackTitle) {
      if (query.title) luceneParts.push(`release:"${query.title.trim()}"`);
      if (query.artist) luceneParts.push(`artist:"${query.artist.trim()}"`);
      if (query.trackTitle) luceneParts.push(`recording:"${query.trackTitle.trim()}"`);
    } else if (query.freeText) {
      luceneParts.push(`"${query.freeText.trim()}"`);
    }

    if (luceneParts.length === 0) return [];

    const mbQuery = luceneParts.join(' AND ');
    const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(mbQuery)}&fmt=json&limit=8`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'CDCatalogApp/1.0.0 (https://github.com/aistudio-applet; contact@example.com)',
          'Accept': 'application/json',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.warn(`MusicBrainz API returned status ${res.status}`);
      return [];
    }

    const data = await res.json();
    const releases = data.releases || [];

    const results: CDMetadata[] = [];

    for (const rel of releases) {
      const mbid = rel.id;
      const title = rel.title || 'Unknown Title';
      
      // Artist credit
      const artist = rel['artist-credit']
        ? rel['artist-credit'].map((ac: any) => ac.name || ac.artist?.name).filter(Boolean).join(', ')
        : 'Unknown Artist';

      // Label & Catalog Number
      let label = '';
      let catalogNumber = query.catno || '';

      if (rel['label-info'] && rel['label-info'].length > 0) {
        const info = rel['label-info'][0];
        label = info.label?.name || '';
        if (info['catalog-number']) {
          catalogNumber = info['catalog-number'];
        }
      }

      // Barcode & Release Date
      const barcode = rel.barcode || query.barcode || '';
      const releaseDate = rel.date || '';
      const country = rel.country || 'JP';

      // Cover Art Archive URL
      const coverUrl = `https://coverartarchive.org/release/${mbid}/front-500`;

      // Fetch tracklist details asynchronously for top 3 releases
      let tracks: TrackInfo[] = [];
      if (results.length < 3) {
        tracks = await fetchMBTracklist(mbid);
      }

      results.push({
        id: `mb-${mbid}`,
        catalogNumber: catalogNumber || query.catno || '',
        title,
        artist,
        label,
        releaseDate,
        barcode,
        country,
        format: rel.media?.[0]?.format || 'CD',
        coverUrl,
        tracks,
        source: 'musicbrainz',
        sourceDetails: {
          musicbrainzId: mbid,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return results;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('MusicBrainz API fetch timed out (10s limit)');
    } else {
      console.error('Error fetching MusicBrainz API:', err?.message || err);
    }
    return [];
  }
}

/**
 * Fetch tracklist for a specific MusicBrainz release ID
 */
async function fetchMBTracklist(mbid: string): Promise<TrackInfo[]> {
  try {
    const url = `https://musicbrainz.org/ws/2/release/${mbid}?inc=recordings+media&fmt=json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'CDCatalogApp/1.0.0 (https://github.com/aistudio-applet; contact@example.com)',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) return [];

    const data = await res.json();
    const mediaList = data.media || [];
    const tracks: TrackInfo[] = [];

    let trackCounter = 1;
    for (const media of mediaList) {
      for (const tr of media.tracks || []) {
        const lengthMs = tr.length || tr.recording?.length;
        let duration = '';
        if (lengthMs) {
          const totalSec = Math.floor(lengthMs / 1000);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          duration = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }

        tracks.push({
          trackNumber: trackCounter++,
          title: tr.title || tr.recording?.title || `Track ${trackCounter}`,
          duration,
        });
      }
    }

    return tracks;
  } catch (err) {
    return [];
  }
}
